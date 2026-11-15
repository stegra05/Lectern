#!/usr/bin/env node
/**
 * A run measured against a reference deck in Anki. Three steps, none of which calls a model:
 *
 *   node eval/refdeck.ts reference <anki deck> <eval folder>
 *   node eval/refdeck.ts reference-files <folder of deck files> <eval folder>
 *   node eval/refdeck.ts run <course folder> <eval folder>
 *   node eval/refdeck.ts batches <eval folder> [--size 40]
 *   node eval/refdeck.ts report <eval folder>
 *
 * `reference` reads the deck through AnkiConnect into `reference.json`; `reference-files` reads
 * a deck kept as YAML files instead (`title`, and `cards` with `front` and `back` or `text`). `run`
 * reads a built course into `cards.json`, `cards.txt`, `facts.json`, `slides.txt` and `meta.json`, which
 * names the runs, the models, the goal and the card count the figures belong to. `batches` writes
 * one file per group of reference notes under `batches/` and refuses to when `labels/` already
 * holds judged batches. A judge (a person or a model) answers each into `labels/<same name>.json`.
 * `report` counts the labels and fails on a label for a note that is not in `reference.json`.
 *
 * Which judge file goes with which input:
 *   `JUDGE.md`        the cards of a build: `cards.txt` and `slides.txt` from `run`.
 *   `JUDGE-FACTS.md`  the facts of the slide reading alone: `facts.txt` from `read-slides.ts`.
 *   `JUDGE-ALL.md`    the same facts, where two or three together may answer a note.
 * The fact judges leave `stated` null, so `report` skips the sections that need it.
 *
 * The judge's two questions per reference note:
 *   match: same (a card tests the same fact), partial (the concept has cards, this fact has
 *          none), none.
 *   stated: for a note that is not `same`, whether the text of the slides states its fact:
 *          text, picture (the slide shows it and the text does not), absent.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { parse } from 'yaml'
import { nodeStore } from '../src/adapters/node-store.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import { CLOZE, htmlToText, two } from '../src/cards/words.ts'
import {
  paths,
  readCards,
  readJson,
  type CourseFile,
  type Lecture,
  type Run,
} from '../src/course.ts'
import { questionAndAnswer } from '../src/cards/question-answer.ts'
import { slideText } from '../src/slides.ts'

interface ReferenceNote {
  id: number
  deck: string
  question: string
  answer: string
  source: string
  /** How many past papers asked it, from a tag such as `ee::asked::06x`. Null without one. */
  asked: number | null
}

interface Label {
  id: number
  match: 'same' | 'partial' | 'none'
  /** The fact judges of the slide reading write `card`, or `cards` for several facts together. */
  card?: string | null
  cards?: string[]
  stated: 'text' | 'picture' | 'absent' | null
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { size: { type: 'string' } },
})
const [step, ...rest] = positionals

async function anki<T>(action: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch('http://127.0.0.1:8765', {
    method: 'POST',
    body: JSON.stringify({ action, version: 6, params }),
  })
  const { result, error } = (await response.json()) as { result: T; error: string | null }
  if (error) throw new Error(error)
  return result
}

async function reference(deck: string, out: string): Promise<void> {
  const cards = await anki<number[]>('findCards', { query: `deck:"${deck}"` })
  const info = await anki<{ note: number; deckName: string }[]>('cardsInfo', { cards })
  const deckOf = new Map(info.map((card) => [card.note, card.deckName]))
  const notes = await anki<
    { noteId: number; tags: string[]; fields: Record<string, { value: string }> }[]
  >('notesInfo', { notes: [...deckOf.keys()] })
  const list: ReferenceNote[] = notes.map((note) => {
    const field = (name: string) => note.fields[name]?.value ?? ''
    const text = field('Text')
    const asked = note.tags.map((tag) => /asked::(\d+)x$/.exec(tag)?.[1]).find(Boolean)
    return {
      id: note.noteId,
      deck: deckOf.get(note.noteId)!,
      question: htmlToText(text ? text.replace(CLOZE, '[...]') : field('Front')),
      answer: text
        ? [...text.matchAll(CLOZE)].map((m) => htmlToText(m[2]!)).join('; ')
        : htmlToText(field('Back')),
      source: htmlToText(field('Source')),
      asked: asked ? Number(asked) : null,
    }
  })
  list.sort((a, b) => a.deck.localeCompare(b.deck) || a.id - b.id)
  await writeFile(join(out, 'reference.json'), `${JSON.stringify(list, null, 1)}\n`)
  console.log(`${list.length} reference notes`)
}

async function referenceFiles(folder: string, out: string): Promise<void> {
  const list: ReferenceNote[] = []
  for (const name of (await readdir(folder)).filter((n) => n.endsWith('.yaml')).sort()) {
    const deck = parse(await readFile(join(folder, name), 'utf8')) as {
      title: string
      cards: { front?: string; back?: string; text?: string }[]
    }
    for (const card of deck.cards) {
      const text = card.text ?? ''
      list.push({
        id: list.length + 1,
        deck: deck.title,
        question: htmlToText(text ? text.replace(CLOZE, '[...]') : (card.front ?? '')),
        answer: text
          ? [...text.matchAll(CLOZE)].map((m) => htmlToText(m[2]!)).join('; ')
          : htmlToText(card.back ?? ''),
        source: '',
        asked: null,
      })
    }
  }
  await writeFile(join(out, 'reference.json'), `${JSON.stringify(list, null, 1)}\n`)
  console.log(`${list.length} reference notes`)
}

async function run(folder: string, out: string): Promise<void> {
  const store = nodeStore(dirname(folder))
  const course = basename(folder)
  const file = (await readJson<CourseFile>(store, paths.course(course)))!
  const cards: { id: string; role: string; slide: number; question: string; answer: string }[] = []
  const facts: unknown[] = []
  const slides: string[] = []
  for (const { number, file: pdf } of file.lectures) {
    const lecture = (await readJson<Lecture>(store, paths.lecture(course, number)))!
    for (const card of await readCards(store, course, number)) {
      const role = card.fields.Role ?? card.note
      cards.push({ id: card.id, role, slide: card.slide, ...questionAndAnswer(card) })
    }
    for (const concept of lecture.topics.flatMap((topic) => topic.concepts)) {
      concept.facts.forEach((fact, i) =>
        facts.push({ lecture: number, concept: concept.name, order: i + 1, ...fact }),
      )
    }
    const text = await slideText(pdfjsReader, await store.readBytes(`${course}/slides/${pdf}`))
    slides.push(`## Lecture ${two(number)}: ${lecture.title}`)
    text.forEach((lines, i) => slides.push(`[${two(number)}.${i + 1}] ${lines.join(' / ')}`))
  }
  await writeFile(join(out, 'cards.json'), `${JSON.stringify(cards, null, 1)}\n`)
  // The deck as a judge reads it: one card per line.
  const lines = cards.map((card) => `${card.id} | ${card.question} | ${card.answer}`)
  await writeFile(join(out, 'cards.txt'), `${lines.join('\n')}\n`)
  await writeFile(join(out, 'facts.json'), `${JSON.stringify(facts, null, 1)}\n`)
  await writeFile(join(out, 'slides.txt'), `${slides.join('\n')}\n`)
  // Which runs the figures of this folder measured. Two runs differ by up to 20% per lecture.
  const runs: Run[] = []
  for (const name of (await store.list(paths.runs(course))).sort()) {
    runs.push((await readJson<Run>(store, `${paths.runs(course)}/${name}`))!)
  }
  const meta = {
    course,
    runs: runs.map((r) => r.run),
    models: [...new Set(runs.map((r) => r.model))],
    goal: file.goal,
    cards: cards.length,
  }
  await writeFile(join(out, 'meta.json'), `${JSON.stringify(meta, null, 1)}\n`)
  console.log(`${cards.length} cards, ${facts.length} facts, ${file.lectures.length} lectures`)
}

async function batches(out: string, size: number): Promise<void> {
  const notes = JSON.parse(await readFile(join(out, 'reference.json'), 'utf8')) as ReferenceNote[]
  await mkdir(join(out, 'labels'), { recursive: true })
  if ((await readdir(join(out, 'labels'))).length > 0) {
    throw new Error(
      'labels/ holds judged batches, and new batches would put their labels on other notes. Use a new eval folder.',
    )
  }
  await mkdir(join(out, 'batches'), { recursive: true })
  for (let start = 0; start < notes.length; start += size) {
    const name = `${String(start / size + 1).padStart(2, '0')}.json`
    const batch = notes
      .slice(start, start + size)
      .map(({ id, question, answer, source }) => ({ id, question, answer, source }))
    await writeFile(join(out, 'batches', name), `${JSON.stringify(batch, null, 1)}\n`)
  }
  console.log(`${Math.ceil(notes.length / size)} batches of up to ${size} notes`)
}

async function report(out: string): Promise<void> {
  const notes = JSON.parse(await readFile(join(out, 'reference.json'), 'utf8')) as ReferenceNote[]
  const labels = new Map<number, Label>()
  for (const name of await readdir(join(out, 'labels'))) {
    if (!name.endsWith('.json')) continue
    for (const label of JSON.parse(await readFile(join(out, 'labels', name), 'utf8')) as Label[])
      labels.set(label.id, label)
  }
  const known = new Set(notes.map((note) => note.id))
  const unknown = [...labels.keys()].filter((id) => !known.has(id))
  if (unknown.length > 0) {
    throw new Error(`labels for notes that are not in reference.json: ${unknown.join(', ')}`)
  }
  const judged = notes.filter((note) => labels.has(note.id))
  const share = (part: number, whole: number) =>
    whole === 0 ? '-' : `${part} of ${whole} (${Math.round((100 * part) / whole)}%)`
  const count = (list: ReferenceNote[], test: (label: Label) => boolean) =>
    list.filter((note) => test(labels.get(note.id)!)).length
  console.log(`Judged: ${judged.length} of ${notes.length} reference notes`)
  for (const match of ['same', 'partial', 'none'] as const)
    console.log(
      `  ${match}: ${share(
        count(judged, (l) => l.match === match),
        judged.length,
      )}`,
    )

  const missed = judged.filter((note) => labels.get(note.id)!.match !== 'same')
  // The fact judges leave `stated` null: there is no slide text to compare with.
  if (missed.some((note) => labels.get(note.id)!.stated !== null)) {
    console.log(`Missed notes by where their fact is:`)
    for (const stated of ['text', 'picture', 'absent'] as const)
      console.log(
        `  ${stated}: ${share(
          count(missed, (l) => l.stated === stated),
          missed.length,
        )}`,
      )

    // What a deck from the slide text could reach: the notes it has, plus those the text states.
    const reachable = judged.filter((note) => {
      const label = labels.get(note.id)!
      return label.match === 'same' || label.stated === 'text'
    })
    console.log(`In the slide text at all: ${share(reachable.length, judged.length)}`)
    console.log(
      `  of those, the run has: ${share(
        count(reachable, (l) => l.match === 'same'),
        reachable.length,
      )}`,
    )
  }

  console.log('Same fact, by how often the exam asked:')
  const tiers: [string, (asked: number) => boolean][] = [
    ['0-1x', (n) => n <= 1],
    ['2-4x', (n) => n >= 2 && n <= 4],
    ['5-8x', (n) => n >= 5 && n <= 8],
    ['9+x', (n) => n >= 9],
  ]
  for (const [name, test] of tiers) {
    const tier = judged.filter((note) => note.asked !== null && test(note.asked))
    console.log(
      `  ${name}: ${share(
        count(tier, (l) => l.match === 'same'),
        tier.length,
      )}`,
    )
  }
  console.log('Same fact, by subdeck:')
  for (const deck of [...new Set(judged.map((note) => note.deck))]) {
    const own = judged.filter((note) => note.deck === deck)
    console.log(
      `  ${deck}: ${share(
        count(own, (l) => l.match === 'same'),
        own.length,
      )}`,
    )
  }
}

const out = resolve(rest.at(-1) ?? '.')
await mkdir(out, { recursive: true })
if (step === 'reference' && rest.length === 2) await reference(rest[0]!, out)
else if (step === 'reference-files' && rest.length === 2)
  await referenceFiles(resolve(rest[0]!), out)
else if (step === 'run' && rest.length === 2) await run(resolve(rest[0]!), out)
else if (step === 'batches' && rest.length === 1) await batches(out, Number(values.size ?? 40))
else if (step === 'report' && rest.length === 1) await report(out)
else {
  console.error(
    'Usage: refdeck reference <anki deck> <out> | reference-files <folder> <out> | run <course> <out> | batches <out> | report <out>',
  )
  process.exit(2)
}
