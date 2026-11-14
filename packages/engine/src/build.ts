/**
 * The build command. Four course-wide phases, as the run screen shows them:
 * read all lectures, map topics and concepts, write cards, check cards.
 * Only lectures that are not in `course.json` yet are built. Nothing is written until every
 * phase is through, and files of earlier lectures are never touched.
 */

import { z } from 'zod'
import type { BuildCommand, Emit } from './api.ts'
import { assemble, type CardFile } from './cards/assemble.ts'
import { cardId } from './cards/id.ts'
import { CARDS_PER_CONCEPT, GOAL_LABEL, type Draft, type Role } from './cards/roles.ts'
import { validateDraft } from './cards/validate.ts'
import { htmlToText, slideRange, slug, two, wordingKey } from './cards/words.ts'
import {
  assignNumbers,
  inCourseOrder,
  paths,
  readCards,
  readJson,
  writeJson,
  type Concept,
  type CourseFile,
  type Decision,
  type Lecture,
  type Run,
} from './course.ts'
import { EngineError } from './errors.ts'
import type { Ports, Task } from './ports.ts'
import {
  MapSchema,
  replySchema,
  mapPrompt,
  RewriteSchema,
  rewritePrompt,
  SYSTEM,
  WriteSchema,
  writePrompt,
} from './prompts.ts'
import { settleMap, type Settled } from './tree.ts'

/** How often rejected cards go back to the model before they are dropped. */
const REWRITE_ROUNDS = 2
/** Model calls that run at the same time in the write and check phases. */
const PARALLEL = 4

type Phase = 'read' | 'map' | 'write' | 'check'

/** A lecture on its way through the build. */
interface NewLecture extends Lecture {
  sha256: string
  /** Text lines per slide. */
  text: string[][]
  covered: Settled['covered']
}

/** One drafted card with its fixed identity and the problems of its latest check. */
interface Item {
  id: string
  lecture: NewLecture
  concept: Concept
  draft: Draft
  problems: string[]
}

export async function build(ports: Ports, command: BuildCommand, emit: Emit): Promise<void> {
  const { store } = ports
  const course = command.course
  const startedAt = ports.now()
  const existing = await readJson<CourseFile>(store, paths.course(course))
  const goal = command.goal ?? existing?.goal ?? 'good'

  const files = inCourseOrder(await store.list(paths.slides(course)))
  if (files.length === 0) {
    throw new EngineError(
      `No PDF found in ${paths.slides(course)}.`,
      'Put one PDF per lecture into the slides folder of the course.',
    )
  }
  const known = new Set(existing?.lectures.map((l) => l.file))
  const fresh = files.filter((f) => !known.has(f))
  if (fresh.length === 0) {
    emit({ type: 'built', lectures: [], cards: 0, dropped: 0, costUsd: 0, durationMs: 0 })
    return
  }

  const meter = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
  const ask = async <S extends z.ZodType>(
    task: Task,
    prompt: string,
    schema: S,
  ): Promise<z.infer<S>> => {
    const jsonSchema = replySchema(schema)
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await ports.model.complete({ task, system: SYSTEM, prompt, schema: jsonSchema })
      meter.calls++
      meter.inputTokens += reply.usage.inputTokens
      meter.outputTokens += reply.usage.outputTokens
      meter.costUsd += reply.usage.costUsd
      const parsed = schema.safeParse(reply.data)
      if (parsed.success) return parsed.data
    }
    throw new EngineError(
      'The model answered twice in a form Lectern cannot read.',
      'Run the build again.',
    )
  }

  const phaseMs = { read: 0, map: 0, write: 0, check: 0 }
  const phase = async <T>(name: Phase, total: number, work: () => Promise<T>): Promise<T> => {
    emit({ type: 'phase', phase: name, status: 'started', total })
    const start = ports.now()
    const result = await work()
    phaseMs[name] = ports.now() - start
    emit({ type: 'phase', phase: name, status: 'done', total })
    return result
  }

  // What the course already holds: concepts by id, and the wording of every card.
  const earlier = new Map<string, number>()
  const earlierNames: string[] = []
  const wordings = new Set<string>()
  for (const { number } of existing?.lectures ?? []) {
    const lecture = await readJson<Lecture>(store, paths.lecture(course, number))
    for (const concept of lecture?.topics.flatMap((t) => t.concepts) ?? []) {
      earlier.set(concept.id, number)
      earlierNames.push(concept.name)
    }
    for (const card of await readCards(store, course, number)) wordings.add(wordingOf(card))
  }

  // 1. Read all lectures.
  const numbers = assignNumbers(existing?.lectures.map((l) => l.number) ?? [], fresh)
  const read = await phase('read', fresh.length, async () => {
    const out: { number: number; file: string; sha256: string; text: string[][] }[] = []
    for (const [i, file] of fresh.entries()) {
      const bytes = await store.readBytes(`${paths.slides(course)}/${file}`)
      out.push({
        number: numbers[i]!,
        file,
        sha256: await sha256(bytes),
        text: await ports.pdf.readSlides(bytes),
      })
      emit({ type: 'progress', phase: 'read', done: i + 1, total: fresh.length })
    }
    return out
  })

  // 2. Map topics and concepts. One lecture after the other, so each knows the ones before.
  const lectures = await phase('map', read.length, async () => {
    const out: NewLecture[] = []
    for (const [i, lecture] of read.entries()) {
      const emptySlides = lecture.text.flatMap((lines, s) => (lines.length === 0 ? [s + 1] : []))
      const ctx = {
        slideCount: lecture.text.length,
        emptySlides,
        earlier,
        fallbackTitle:
          lecture.file.replace(/\.pdf$/i, '').replace(/^[\d\s._-]+/, '') ||
          `Lecture ${lecture.number}`,
      }
      let settled = settleMap({ title: '', topics: [], leftOut: [] }, ctx)
      if (emptySlides.length < lecture.text.length) {
        const input = { file: lecture.file, slides: lecture.text, earlier: earlierNames }
        settled = settleMap(await ask('map', mapPrompt(input), MapSchema), ctx)
        if (settled.problems.length > 0) {
          const again = mapPrompt({ ...input, problems: settled.problems })
          settled = settleMap(await ask('map', again, MapSchema), ctx)
        }
      }
      for (const concept of settled.topics.flatMap((t) => t.concepts)) {
        earlier.set(concept.id, lecture.number)
        earlierNames.push(concept.name)
      }
      out.push({
        number: lecture.number,
        title: settled.title,
        file: lecture.file,
        slides: lecture.text.length,
        topics: settled.topics,
        leftOut: settled.leftOut,
        sha256: lecture.sha256,
        text: lecture.text,
        covered: settled.covered,
      })
      emit({ type: 'progress', phase: 'map', done: i + 1, total: read.length })
    }
    return out
  })

  // 3. Write cards: one call per topic, and once more for concepts that got none.
  const jobs = lectures.flatMap((lecture) => lecture.topics.map((topic) => ({ lecture, topic })))
  const cap = CARDS_PER_CONCEPT[goal]
  const drafted = await phase('write', jobs.length, async () => {
    let done = 0
    return pool(jobs, async ({ lecture, topic }) => {
      const byConcept = new Map<string, Draft[]>(topic.concepts.map((c) => [c.id, []]))
      for (let attempt = 0; attempt < 2; attempt++) {
        const missing = topic.concepts.filter((c) => byConcept.get(c.id)!.length === 0)
        if (missing.length === 0) break
        const prompt = writePrompt({
          lecture,
          topic,
          concepts: missing,
          slides: lecture.text,
          goal,
        })
        for (const draft of (await ask('write', prompt, WriteSchema)).cards) {
          const name = draft.concept.trim().toLowerCase()
          const concept = missing.find((c) => c.name.toLowerCase() === name || c.id === slug(name))
          const drafts = concept && byConcept.get(concept.id)!
          if (drafts && drafts.length < cap) drafts.push(draft)
        }
      }
      emit({ type: 'progress', phase: 'write', done: ++done, total: jobs.length })
      return byConcept
    })
  })

  // Identity is fixed here, in tree order, before any check or rewrite.
  const items: Item[] = []
  for (const [j, { lecture, topic }] of jobs.entries()) {
    for (const concept of topic.concepts) {
      const counters = new Map<string, number>()
      for (const draft of drafted[j]!.get(concept.id)!) {
        const n = (counters.get(draft.role) ?? 0) + 1
        counters.set(draft.role, n)
        const id = cardId(lecture.number, concept.id, draft.role as Role, n)
        items.push({ id, lecture, concept, draft, problems: [] })
      }
    }
  }

  // 4. Check cards. Rejected drafts go back with their problems, then are dropped.
  const accepted: CardFile[] = []
  const dropped = await phase('check', items.length, async () => {
    let pending = items
    for (let round = 0; ; round++) {
      const rejected: Item[] = []
      for (const item of pending) {
        const text = item.lecture.text
        item.problems = validateDraft(item.draft, {
          slides: item.concept.slides,
          slideText: (slide) => text[slide - 1]?.join('\n'),
        })
        if (item.problems.length === 0) {
          const card = assemble(item.draft, {
            id: item.id,
            lecture: item.lecture,
            concept: item.concept,
            slideLines: text[item.draft.slide - 1]!,
          })
          if (wordings.has(wordingOf(card))) {
            item.problems = [
              'another card already asks this; ask about a different fact of the concept',
            ]
          } else {
            wordings.add(wordingOf(card))
            accepted.push(card)
          }
        }
        if (item.problems.length > 0) rejected.push(item)
      }
      emit({ type: 'progress', phase: 'check', done: accepted.length, total: items.length })
      pending = rejected
      if (rejected.length === 0 || round === REWRITE_ROUNDS) return rejected

      const groups = lectures
        .map((lecture) => ({
          lecture,
          rejected: rejected.filter((item) => item.lecture === lecture),
        }))
        .filter((group) => group.rejected.length > 0)
      await pool(groups, async ({ lecture, rejected }) => {
        const prompt = rewritePrompt({ lecture, rejected, slides: lecture.text })
        for (const { id, ...slots } of (await ask('rewrite', prompt, RewriteSchema)).cards) {
          const item = rejected.find((r) => r.id === id)
          if (item) item.draft = { ...item.draft, ...slots }
        }
      })
    }
  })

  // Save. `course.json` goes last: a lecture counts as built once it is listed there.
  const decisions: Decision[] = (await readJson<Decision[]>(store, paths.decisions(course))) ?? []
  if (!existing) {
    const text = `Goal "${GOAL_LABEL[goal]}": up to ${cap} cards per concept.`
    decisions.push({ lecture: null, kind: 'goal', text })
  }
  const summary = []
  for (const lecture of lectures) {
    const cards = accepted.filter((card) => card.lecture === lecture.number)
    for (const card of cards) {
      await writeJson(store, `${paths.cards(course, lecture.number)}/${card.id}.json`, card)
    }
    const { number, title, file, slides, topics, leftOut } = lecture
    const tree: Lecture = { number, title, file, slides, topics, leftOut }
    await writeJson(store, paths.lecture(course, number), tree)
    const lost = dropped.filter((item) => item.lecture === lecture).length
    decisions.push(...decide(lecture, cards, lost))
    const concepts = lecture.topics.flatMap((t) => t.concepts).length
    summary.push({ number: lecture.number, title: lecture.title, concepts, cards: cards.length })
  }
  await writeJson(store, paths.decisions(course), decisions)

  const durationMs = ports.now() - startedAt
  const run: Run = {
    run: (await store.list(paths.runs(course))).length + 1,
    startedAt: new Date(startedAt).toISOString(),
    model: ports.model.model,
    goal,
    lectures: lectures.map((l) => l.number),
    cards: accepted.length,
    dropped: dropped.length,
    ...meter,
    durationMs,
    phaseMs,
  }
  await writeJson(store, `${paths.runs(course)}/${String(run.run).padStart(3, '0')}.json`, run)

  const listed = lectures.map((l) => ({
    number: l.number,
    title: l.title,
    file: l.file,
    sha256: l.sha256,
    slides: l.slides,
  }))
  await writeJson(store, paths.course(course), {
    format: 1,
    name: existing?.name ?? course.split('/').at(-1)!,
    goal,
    lectures: [...(existing?.lectures ?? []), ...listed].sort((a, b) => a.number - b.number),
  } satisfies CourseFile)

  emit({
    type: 'built',
    lectures: summary,
    cards: accepted.length,
    dropped: dropped.length,
    costUsd: meter.costUsd,
    durationMs,
  })
}

/** The decisions of one lecture, written by code from what happened. */
function decide(lecture: NewLecture, cards: CardFile[], dropped: number): Decision[] {
  const name = `${two(lecture.number)} ${lecture.title}`
  const out: Decision[] = []
  const add = (kind: Decision['kind'], text: string) =>
    out.push({ lecture: lecture.number, kind, text })

  const byReason = new Map<string, number[]>()
  for (const { slide, reason } of lecture.leftOut) {
    byReason.set(reason, [...(byReason.get(reason) ?? []), slide])
  }
  for (const [reason, slides] of byReason) {
    add('left-out', `No cards for ${slideRange(slides)} in ${name}: ${reason.replace(/\.$/, '')}.`)
  }
  for (const concept of lecture.covered) {
    add(
      'already-covered',
      `No new cards for "${concept.name}" in ${name}: lecture ${two(concept.lecture)} covers it.`,
    )
  }
  const bare = lecture.topics
    .flatMap((t) => t.concepts)
    .filter((concept) => !cards.some((card) => card.concept === concept.id))
  if (bare.length > 0) {
    const names = bare.map((c) => `"${c.name}"`).join(', ')
    add('no-card', `No card in ${name} for ${names}: no draft passed the checks.`)
  }
  if (dropped > 0) {
    const what = dropped === 1 ? '1 card' : `${dropped} cards`
    add(
      'dropped',
      `${what} dropped in ${name}: still failing the checks after ${REWRITE_ROUNDS} rewrites.`,
    )
  }
  return out
}

/** The wording of a card's question, for spotting the same question twice. */
function wordingOf(card: CardFile): string {
  return wordingKey(htmlToText(card.fields.Front ?? card.fields.Text ?? ''))
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Runs `work` over all items, a few at a time, and keeps the order of the results. */
async function pool<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await work(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker))
  return results
}
