#!/usr/bin/env node
/**
 * A deck measured against the papers its build never saw. None of the steps calls a model:
 *
 *   node eval/bench.ts rubric <course name> <folder of paper files> <rubric.json>
 *   node eval/bench.ts batches <rubric.json> <run folder> [--size 27]
 *   node eval/bench.ts report <rubric.json> <run folder>
 *   node eval/bench.ts compare <rubric.json> <run folder> <run folder>
 *
 * The rubric is the test set: the knowledge points of the held-out papers, each with its
 * marks. Extractors (`RUBRIC.md`) write one file per paper, and `rubric` checks their marks
 * and puts them together. A run folder holds `cards.json` and `cards.txt` from
 * `refdeck.ts run`.
 *
 * `batches` finds for every point the eight cards closest to it and writes the pairs no judge
 * has decided yet into `pairs/NN.json`. A judge (`JUDGE-PAIRS.md`) answers each batch into
 * `verdicts/NN.json`. Verdicts are kept in `verdicts.json` beside the rubric under the texts
 * of the pair, so a fact several papers share is judged once and a second look at a run asks
 * only about what is new. A run's score counts its shortlist and what its own judges found,
 * nothing else, so it does not move when other runs are judged. `report` gives
 * the share of the marks the deck holds with its 95 percent interval and refuses while pairs
 * are open. `compare` gives the difference between two runs on the same points. Its interval
 * says whether two decks differ on this exam; whether the code behind them does takes more
 * than one build each, since builds of the same code differ by several points (RFD 14).
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { assemble, PaperSchema } from './bench/rubric.ts'
import {
  compare,
  considered,
  ingest,
  LabelSchema,
  open,
  RubricSchema,
  score,
  shortlist,
  standings,
  type Card,
  type Label,
  type Rubric,
  type Standing,
  VERDICTS,
  type Verdicts,
} from './bench/score.ts'

/**
 * How many cards a judge sees for one point. Measured 2026-11-16: the card the judges of an
 * earlier run matched is among the eight closest for 234 of 246 reference notes, among the
 * twenty closest for 238. The judge searches the whole deck before it leaves a point unheld.
 */
const SHORTLIST = 8

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { size: { type: 'string' } },
})
const [step, rubricPath, ...runs] = positionals

async function rubric(course: string, folder: string, out: string): Promise<void> {
  const papers = []
  for (const name of await files(folder))
    papers.push(PaperSchema.parse(await json(join(folder, name))))
  const made = assemble(course, papers)
  await writeFile(out, `${JSON.stringify(made, null, 1)}\n`)
  const marks = papers.reduce((sum, paper) => sum + paper.total, 0)
  console.log(`${made.points.length} points for ${marks} marks in ${papers.length} papers`)
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

/** The JSON files of a folder in order. A folder that does not exist yet has none. */
async function files(folder: string): Promise<string[]> {
  const names = await readdir(folder).catch((error: unknown) => {
    if (missing(error)) return [] as string[]
    throw error
  })
  return names.filter((name) => name.endsWith('.json')).sort()
}

/**
 * The rubric, the run's cards, the labels of the run's own judges and every verdict kept so
 * far, the run's new ones taken in.
 */
async function load(
  run: string,
): Promise<{ rubric: Rubric; cards: Card[]; labels: Label[]; verdicts: Verdicts }> {
  const rubric = RubricSchema.parse(await json(rubricPath!))
  const cards = z
    .array(z.object({ id: z.string(), question: z.string(), answer: z.string() }))
    .parse(await json(join(run, 'cards.json')))
  if (new Set(cards.map((card) => card.id)).size !== cards.length) {
    throw new Error(`${run}: two cards of cards.json carry the same id.`)
  }
  const kept = join(dirname(resolve(rubricPath!)), 'verdicts.json')
  // Only a file that is not there yet is empty. A broken one stops the step: writing new
  // verdicts over it would lose every verdict it held.
  const verdicts: Verdicts = z.record(z.string(), z.enum(VERDICTS)).parse(
    await json(kept).catch((error: unknown) => {
      if (missing(error)) return {}
      throw new Error(`${kept} cannot be read: ${(error as Error).message}`)
    }),
  )
  const labels: Label[] = []
  for (const name of await files(join(run, 'verdicts')))
    labels.push(...z.array(LabelSchema).parse(await json(join(run, 'verdicts', name))))
  const { added, differing } = ingest(labels, rubric.points, cards, verdicts)
  if (added > 0) {
    await writeFile(kept, `${JSON.stringify(verdicts, null, 1)}\n`)
    console.log(`${added} new verdicts kept in ${kept}`)
  }
  if (differing > 0) {
    console.log(`${differing} verdicts differ from ones kept earlier, which stand.`)
  }
  return { rubric, cards, labels, verdicts }
}

async function batches(run: string, size: number): Promise<void> {
  if (!Number.isInteger(size) || size < 1) throw new Error('--size is a whole number above zero.')
  const { rubric, cards, verdicts } = await load(run)
  const short = shortlist(rubric.points, cards, SHORTLIST)
  const pairs = open(rubric.points, short, verdicts)
  await rm(join(run, 'pairs'), { recursive: true, force: true })
  await mkdir(join(run, 'pairs'), { recursive: true })
  await mkdir(join(run, 'verdicts'), { recursive: true })
  for (let start = 0; start < pairs.length; start += size) {
    const name = `${String(start / size + 1).padStart(2, '0')}.json`
    const batch = pairs.slice(start, start + size).map(({ point, cards }) => ({
      point: point.id,
      asks: point.asks,
      knows: point.knows,
      cards,
    }))
    // One point a line, nothing indented: a judge pays for every character.
    const lines = batch.map((entry) => JSON.stringify(entry)).join(',\n')
    await writeFile(join(run, 'pairs', name), `[\n${lines}\n]\n`)
  }
  const count = pairs.reduce((sum, entry) => sum + entry.cards.length, 0)
  console.log(
    `${count} open pairs on ${pairs.length} of ${rubric.points.length} points, in ${Math.ceil(pairs.length / size)} batches`,
  )
  const alone = rubric.points.filter((point) => short.get(point.id)!.length === 0)
  if (alone.length > 0) {
    console.log(`${alone.length} points share no word with any card and go unjudged as not held.`)
  }
}

/** Where every point stands in a run. Fails while the shortlist has undecided pairs. */
async function judged(run: string): Promise<Standing[]> {
  const { rubric, cards, labels, verdicts } = await load(run)
  const short = shortlist(rubric.points, cards, SHORTLIST)
  const pairs = open(rubric.points, short, verdicts)
  if (pairs.length > 0) {
    throw new Error(`${run}: ${pairs.length} points have undecided pairs. Run batches and judge.`)
  }
  return standings(rubric.points, considered(rubric.points, cards, short, labels), verdicts)
}

const percent = (share: number) => `${(100 * share).toFixed(1)}%`

/** A figure with its interval, or alone where the points span too few questions for one. */
function line(name: string, list: Standing[]): string {
  const { coverage, interval } = score(list)
  const held = list.filter((s) => s.verdict === 'same').length
  const range = interval ? ` (${percent(interval[0])} to ${percent(interval[1])})` : ''
  return `${name}: ${percent(coverage)} of the marks${range}, ${held} of ${list.length} points`
}

async function report(run: string): Promise<void> {
  const list = await judged(run)
  console.log(line('Held', list))
  const partial = list.filter((s) => s.verdict === 'partial').length
  console.log(`  concept on a card, point missing: ${partial} points`)
  console.log(`  nothing: ${list.filter((s) => s.verdict === 'no').length} points`)
  for (const kind of ['recall', 'apply'] as const) {
    const own = list.filter((s) => s.point.kind === kind)
    if (own.length > 0) console.log(line(`  ${kind}`, own))
  }
  for (const paper of new Set(list.map((s) => s.point.paper))) {
    console.log(
      line(
        `  ${paper}`,
        list.filter((s) => s.point.paper === paper),
      ),
    )
  }
  const rows = list.map((s) => ({ point: s.point.id, verdict: s.verdict, card: s.card }))
  await writeFile(join(run, 'standings.json'), `${JSON.stringify(rows, null, 1)}\n`)
}

async function compareRuns(first: string, second: string): Promise<void> {
  const a = await judged(first)
  const b = await judged(second)
  console.log(line(first, a))
  console.log(line(second, b))
  const { difference, interval, gained, lost } = compare(a, b)
  const sign = (share: number) => `${share >= 0 ? '+' : ''}${(100 * share).toFixed(1)}`
  if (interval) {
    const [low, high] = interval
    console.log(
      `Difference: ${sign(difference)} points of coverage (${sign(low)} to ${sign(high)})`,
    )
    // The interval covers which questions an exam asks, not the luck of a build, and builds
    // of the same code differ by several points (RFD 14).
    console.log(
      low > 0 || high < 0
        ? 'The interval excludes zero: these two decks differ on this exam. Builds of the same code differ too, so a change of code needs the bar of RFD 14.'
        : 'The interval holds zero: no difference shown.',
    )
  } else {
    console.log(`Difference: ${sign(difference)} points of coverage`)
    console.log('Too few questions for an interval: no difference shown.')
  }
  for (const point of gained) console.log(`  gained ${point.id}: ${point.knows}`)
  for (const point of lost) console.log(`  lost   ${point.id}: ${point.knows}`)
}

const folders = runs.map((run) => resolve(run))
if (step === 'rubric' && positionals.length === 4)
  await rubric(positionals[1]!, resolve(positionals[2]!), resolve(positionals[3]!))
else if (step === 'batches' && folders.length === 1)
  await batches(folders[0]!, Number(values.size ?? 27))
else if (step === 'report' && folders.length === 1) await report(folders[0]!)
else if (step === 'compare' && folders.length === 2) await compareRuns(folders[0]!, folders[1]!)
else {
  console.error(
    'Usage: bench rubric <course> <papers folder> <rubric.json> | batches <rubric.json> <run> [--size 27] | report <rubric.json> <run> | compare <rubric.json> <run> <run>',
  )
  process.exit(2)
}
