#!/usr/bin/env node
/**
 * How well the decision model sorts the files of a course folder, for setting `SORT_THRESHOLD`
 * in `src/sort.ts`. Paid: one decision request per file. It prints the file count and an
 * estimate and calls nothing until it is run again with `--yes`.
 *
 *   node eval/sort-files.ts <labelled folder> <eval folder> [--yes]
 *
 * The labelled folder holds one subfolder per label, each with PDFs, in subfolders too: a kind of `FILE_KINDS`
 * (`slides`, `exam`, `exercise`, ...) or `junk` for anything that belongs to no course. The
 * model sees each file under its own name only, never its label folder, and the name rules are
 * skipped, so what is measured is the model alone.
 *
 * Writes `sort.json` with the kind the model chose for every file and how sure it was, and
 * prints for each threshold how many files land on the right shelf, how many lectures are lost
 * and how much else gets in.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { openaiDecisions } from '../src/adapters/openai.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import { askKind, FILE_KINDS, type FileKind, sortInput } from '../src/sort.ts'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { yes: { type: 'boolean' } },
})
const [labelled, out] = positionals
if (!labelled || !out) {
  console.error('Usage: sort-files <labelled folder> <eval folder> [--yes]')
  process.exit(2)
}

type Label = FileKind | 'junk'
const LABELS: readonly Label[] = [...FILE_KINDS, 'junk']
/** Where a file should end up: the shelf of its kind, or out of the course. */
const shelf = (kind: Label | null) => (kind === 'slides' || kind === 'exam' ? kind : 'out')

const files: { label: Label; path: string; bytes: Uint8Array; pages: string[][] }[] = []
for (const label of await readdir(resolve(labelled))) {
  if (!(LABELS as readonly string[]).includes(label)) continue
  const dir = join(resolve(labelled), label)
  // Files may sit in subfolders of their label, so two files of the same name can both be there.
  const names = (await readdir(dir, { recursive: true })).filter((n) => /\.pdf$/i.test(n))
  for (const name of names.sort()) {
    const bytes = new Uint8Array(await readFile(join(dir, name)))
    const pages = await pdfjsReader.readSlides(bytes).catch(() => null)
    if (pages?.length) files.push({ label: label as Label, path: basename(name), bytes, pages })
  }
}
if (files.length === 0) {
  console.error(`No PDFs in subfolders named ${LABELS.join(', ')}.`)
  process.exit(2)
}

const decisions = openaiDecisions()
// About four characters a token; a scan sends a picture, counted high.
const tokens = files.reduce(
  (sum, f) =>
    sum + sortInput(f.path, f.pages).length / 4 + 300 + (f.pages.flat().length ? 0 : 1500),
  0,
)
const estimateUsd = (tokens * decisions.price.input) / 1e6
const counts = LABELS.map((l) => `${files.filter((f) => f.label === l).length} ${l}`)
console.log(
  `${files.length} files (${counts.filter((c) => !c.startsWith('0 ')).join(', ')}): ${files.length} decision requests, about ${estimateUsd.toFixed(3)} dollars.`,
)
if (!values.yes) {
  console.log('Nothing was called. Run it again with --yes to sort the files.')
  process.exit(0)
}

let costUsd = 0
const results: { label: Label; file: string; kind: FileKind | null; probability: number }[] = []
for (const file of files) {
  const answer = await askKind({ decisions, pdf: pdfjsReader }, file, (u) => {
    costUsd += u.costUsd
  })
  const choice = answer?.type === 'choice' ? answer : null
  results.push({
    label: file.label,
    file: file.path,
    kind: FILE_KINDS.find((kind) => kind === choice?.choice) ?? null,
    probability: choice?.probability ?? 0,
  })
}
await mkdir(resolve(out), { recursive: true })
await writeFile(join(resolve(out), 'sort.json'), `${JSON.stringify(results, null, 2)}\n`)

console.log(`Spent ${costUsd.toFixed(4)} dollars.`)
console.log('threshold  right shelf  lectures lost  exams lost  let in')
for (const threshold of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
  let right = 0
  let lecturesLost = 0
  let examsLost = 0
  let letIn = 0
  for (const { label, kind, probability } of results) {
    const got = shelf(probability >= threshold ? kind : null)
    const want = shelf(label)
    if (got === want) right++
    else if (want === 'slides') lecturesLost++
    else if (want === 'exam') examsLost++
    if (want === 'out' && got !== 'out') letIn++
  }
  console.log(
    `${threshold.toFixed(1).padStart(9)}  ${`${right}/${results.length}`.padStart(11)}  ${String(lecturesLost).padStart(13)}  ${String(examsLost).padStart(10)}  ${String(letIn).padStart(6)}`,
  )
}
