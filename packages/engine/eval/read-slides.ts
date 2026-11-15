#!/usr/bin/env node
/**
 * The slide-by-slide reading alone, on a course folder, for measuring it before anything is
 * built on it. Paid: one model call per slide.
 *
 *   node eval/read-slides.ts <course folder> <eval folder> [--cap dollars] [--effort low|medium]
 *
 * Writes `facts.json` and, for the judges of `refdeck.ts`, `cards.txt` with one fact per line.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { openaiDecisions, openaiModel } from '../src/adapters/openai.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import { createAsk, type Meter } from '../src/ask.ts'
import { two } from '../src/cards/words.ts'
import { inCourseOrder } from '../src/course.ts'
import { slidesBlock } from '../src/mapper.ts'
import type { Ports } from '../src/ports.ts'
import { PRESETS } from '../src/presets.ts'
import { askSlide } from '../src/mapper.ts'
import { slideText } from '../src/slides.ts'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { cap: { type: 'string' }, parallel: { type: 'string' } },
})
const [course, out] = positionals.map((p) => resolve(p))
if (!course || !out) {
  console.error('Usage: read-slides <course folder> <eval folder> [--cap dollars]')
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

const facts: { id: string; lecture: number; slide: number; concept: string; text: string }[] = []
const files = inCourseOrder(
  (await readdir(join(course, 'slides'))).filter((f) => f.endsWith('.pdf')),
)
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
    perSlide[i] = await askSlide(ask, context, slide, PRESETS.concept.mapRules)
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
await writeFile(join(out, 'facts.json'), `${JSON.stringify(facts, null, 1)}\n`)
const lines = facts.map((fact) => `${fact.id} | ${fact.concept} | ${fact.text}`)
await writeFile(join(out, 'cards.txt'), `${lines.join('\n')}\n`)
console.log(
  JSON.stringify({
    facts: facts.length,
    ...meter,
    seconds: Math.round((Date.now() - started) / 1000),
  }),
)
