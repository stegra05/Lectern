#!/usr/bin/env node
/**
 * Past exams as weights, on a course that is already built, before the build uses them. Paid:
 * one call per paper and one per lecture.
 *
 *   node eval/exam-weight.ts <course folder> <eval folder> --input <pdf>... --held <pdf>...
 *
 * `--input` papers are read and matched to the facts of every lecture. `--held` papers are only
 * read: their questions are what the selection is tested on. Writes `questions-input.json`,
 * `questions-held.json`, `facts.json` (every fact with its worth and how many input questions
 * hit it) and `cards.txt` with one fact per line, for the judges.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { nodeStore } from '../src/adapters/node-store.ts'
import { openaiDecisions, openaiModel } from '../src/adapters/openai.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import { createAsk, type Meter } from '../src/ask.ts'
import { two } from '../src/cards/words.ts'
import { paths, readJson, type CourseFile, type Lecture } from '../src/course.ts'
import { askMatches, askQuestions, type ExamQuestion } from '../src/exams.ts'
import type { Ports } from '../src/ports.ts'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    input: { type: 'string', multiple: true },
    held: { type: 'string', multiple: true },
    cap: { type: 'string' },
  },
})
const [folder, out] = positionals.map((p) => resolve(p))
if (!folder || !out) {
  console.error('Usage: exam-weight <course folder> <eval folder> --input <pdf>... --held <pdf>...')
  process.exit(2)
}
const meter: Meter = {
  calls: 0,
  decisions: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
}
const ports = { model: openaiModel(), decisions: openaiDecisions() } as Ports
const { model: ask } = createAsk(ports, meter, Number(values.cap ?? 0.25))

async function read(files: string[] = []): Promise<ExamQuestion[]> {
  const all = await Promise.all(
    files.map(async (file) => {
      const pages = await pdfjsReader.readSlides(new Uint8Array(await readFile(file)))
      const text = pages.map((lines, i) => `[page ${i + 1}] ${lines.join(' / ')}`).join('\n')
      return askQuestions(ask, basename(file, '.pdf'), text)
    }),
  )
  return all.flat()
}

await mkdir(out, { recursive: true })
const input = await read(values.input)
const held = await read(values.held)
await writeFile(join(out, 'questions-input.json'), `${JSON.stringify(input, null, 1)}\n`)
await writeFile(join(out, 'questions-held.json'), `${JSON.stringify(held, null, 1)}\n`)
console.log(`${input.length} input questions, ${held.length} held-out questions`)

const store = nodeStore(dirname(folder))
const course = basename(folder)
const file = (await readJson<CourseFile>(store, paths.course(course)))!
const facts: {
  id: string
  lecture: number
  concept: string
  text: string
  worth: number | null
  asked: string[]
}[] = []
for (const { number } of file.lectures) {
  const lecture = (await readJson<Lecture>(store, paths.lecture(course, number)))!
  const own = lecture.topics
    .flatMap((topic) => topic.concepts)
    .flatMap((concept) => concept.facts.map((fact) => ({ concept, fact })))
    .map(({ concept, fact }, i) => ({
      id: `L${two(number)}-${i + 1}`,
      fact: { concept: concept.name, text: fact.text, slide: fact.slide, items: fact.items ?? 0 },
      worth: fact.worth ?? null,
    }))
  const matches = await askMatches(ask, `Lecture ${two(number)} ${lecture.title}`, own, input)
  for (const { id, fact, worth } of own) {
    const asked = [...matches].filter(([, ids]) => ids.includes(id)).map(([q]) => q)
    facts.push({ id, lecture: number, concept: fact.concept, text: fact.text, worth, asked })
  }
  const hit = own.filter(({ id }) => [...matches.values()].some((ids) => ids.includes(id)))
  console.log(
    `lecture ${two(number)}: ${own.length} facts, ${matches.size} questions matched, ${hit.length} facts hit, ${meter.costUsd.toFixed(3)} dollars so far`,
  )
}
await writeFile(join(out, 'facts.json'), `${JSON.stringify(facts, null, 1)}\n`)
const lines = facts.map((fact) => `${fact.id} | ${fact.concept} | ${fact.text}`)
await writeFile(join(out, 'cards.txt'), `${lines.join('\n')}\n`)
console.log(JSON.stringify({ facts: facts.length, ...meter }))
