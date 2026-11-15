#!/usr/bin/env node
/**
 * The slide-by-slide reading alone, on a course folder, for measuring it before anything is
 * built on it. Paid: one model call per slide. It prints the slide count and an estimate and
 * calls nothing until it is run again with `--yes`.
 *
 *   node eval/read-slides.ts <course folder> <eval folder> [--cap dollars] [--parallel n] [--yes]
 *
 * Writes `slide-facts.json` and `facts.txt` with one fact per line, for `JUDGE-FACTS.md` and
 * `JUDGE-ALL.md`. The names differ from the files `refdeck.ts run` writes, so a folder can
 * hold both measurements.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { openaiDecisions, openaiModel } from '../src/adapters/openai.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import { createAsk, type Meter } from '../src/ask.ts'
import { two } from '../src/cards/words.ts'
import { estimate, LOW_TEXT_CHARS } from '../src/cost.ts'
import { inCourseOrder } from '../src/course.ts'
import { slidesBlock } from '../src/mapper.ts'
import type { Ports } from '../src/ports.ts'
import { CONCEPT } from '../src/presets.ts'
import { askSlide } from '../src/mapper.ts'
import { slideText } from '../src/slides.ts'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    cap: { type: 'string' },
    parallel: { type: 'string' },
    yes: { type: 'boolean' },
  },
})
const [course, out] = positionals.map((p) => resolve(p))
if (!course || !out) {
  console.error('Usage: read-slides <course folder> <eval folder> [--cap dollars] [--yes]')
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
const model = openaiModel()
const ports = { model, decisions: openaiDecisions() } as Ports
const cap = Number(values.cap ?? 0.25)
const { model: ask } = createAsk(ports, meter, cap)

const facts: { id: string; lecture: number; slide: number; concept: string; text: string }[] = []
const files = inCourseOrder(
  (await readdir(join(course, 'slides'))).filter((f) => f.endsWith('.pdf')),
)

// Before the first paid call: how many slides, and what the estimate of a build says.
const sizes = []
for (const file of files) {
  const bytes = new Uint8Array(await readFile(join(course, 'slides', file)))
  const text = await slideText(pdfjsReader, bytes)
  sizes.push({
    chars: text.flat().join(' ').length,
    slides: text.length,
    images: text.filter((lines) => lines.join(' ').length < LOW_TEXT_CHARS).length,
  })
}
const slides = sizes.reduce((sum, size) => sum + size.slides, 0)
const { costUsd } = estimate(sizes, 'good', { model: model.price, decisions: { input: 0 } })
console.log(
  `${slides} slides in ${files.length} lectures: ${slides} paid calls. A whole build of this course is estimated at ${costUsd.toFixed(2)} dollars; reading alone costs less. Cap: ${cap.toFixed(2)} dollars.`,
)
if (!values.yes) {
  console.log('Nothing was called. Run it again with --yes to read the slides.')
  process.exit(0)
}
const started = Date.now()
for (const [l, file] of files.entries()) {
  const bytes = new Uint8Array(await readFile(join(course, 'slides', file)))
  const text = await slideText(pdfjsReader, bytes)
  const images = await pdfjsReader.renderSlides(
    bytes,
    text.map((_, i) => i + 1),
  )
  const context = slidesBlock(`Lecture file: ${file}`, text, [])
  const perSlide: Awaited<ReturnType<typeof askSlide>>[] = []
  // The first slide goes ahead and fills the cache with the lecture; the rest read it from there.
  const read = async (i: number) => {
    const slide = { number: i + 1, lines: text[i]!, image: images[i]! }
    perSlide[i] = await askSlide(ask, context, slide, CONCEPT.mapRules)
  }
  await read(0)
  let next = 1
  const workers = Array.from({ length: Number(values.parallel ?? 6) }, async () => {
    while (next < text.length) await read(next++)
  })
  await Promise.all(workers)
  perSlide.forEach((list, i) =>
    list.forEach((fact, n) =>
      facts.push({
        id: `S${two(l + 1)}.${i + 1}-${n + 1}`,
        lecture: l + 1,
        slide: i + 1,
        concept: fact.concept,
        text: fact.text,
      }),
    ),
  )
  console.log(
    `${file}: ${text.length} slides, ${perSlide.flat().length} facts, ${meter.costUsd.toFixed(3)} dollars so far`,
  )
}
await mkdir(out, { recursive: true })
await writeFile(join(out, 'slide-facts.json'), `${JSON.stringify(facts, null, 1)}\n`)
const lines = facts.map((fact) => `${fact.id} | ${fact.concept} | ${fact.text}`)
await writeFile(join(out, 'facts.txt'), `${lines.join('\n')}\n`)
console.log(
  JSON.stringify({
    facts: facts.length,
    ...meter,
    seconds: Math.round((Date.now() - started) / 1000),
  }),
)
