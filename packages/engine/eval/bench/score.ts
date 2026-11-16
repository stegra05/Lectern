/**
 * The arithmetic of the exam benchmark: which cards a judge sees for a knowledge point, how
 * its verdicts are kept, and what a deck scores. Nothing here calls a model or reads a file.
 *
 * A judge decides one pair at a time, a point and a card, and its verdict is kept under a key
 * made of both texts. A card that is unchanged in the next run keeps its verdict, so two runs
 * differ only where their cards differ.
 */

import { createHash } from 'node:crypto'
import MiniSearch from 'minisearch'
import { z } from 'zod'

export const PointSchema = z.object({
  id: z.string().min(1),
  /** The paper and the question in it the point belongs to. */
  paper: z.string().min(1),
  question: z.string().min(1),
  /** The exam question in one line, so a judge knows what the point is for. */
  asks: z.string().min(1),
  /** What a student must know to earn the marks, as one statement. */
  knows: z.string().min(1),
  /** The marks this point earns. */
  marks: z.number().positive(),
  /**
   * The marks of the whole question. The points of a question may add up to more, when it
   * lets the student choose ("name three of the five"): the question then pays no more than
   * this.
   */
  questionMarks: z.number().positive(),
  /**
   * The choice the question belongs to, when the paper lets the student answer only some of a
   * set of questions ("five of these six"), and how many of them count. Null otherwise.
   */
  choice: z.string().nullable(),
  pick: z.number().int().positive().nullable(),
  /** recall: a card can hold it. apply: the student carries a method out on new input. */
  kind: z.enum(['recall', 'apply']),
  /** Where the extractor confirmed the point: the official solution, the slides, a student's
   * notes, or only what the model knows. The last kind is the one to check by hand. */
  basis: z.enum(['solution', 'slides', 'notes', 'own']),
})
export type Point = z.infer<typeof PointSchema>

/** A test set: the knowledge points of the papers a build never saw. */
export const RubricSchema = z.object({
  course: z.string().min(1),
  papers: z.array(z.string().min(1)).min(1),
  points: z.array(PointSchema).min(1),
})
export type Rubric = z.infer<typeof RubricSchema>

export interface Card {
  id: string
  question: string
  answer: string
}

/**
 * same: a student who knows the card has the point. partial: the card is on the point's
 * concept and does not give the point. no: the card is about something else.
 */
export const VERDICTS = ['same', 'partial', 'no'] as const
export type Verdict = (typeof VERDICTS)[number]
/** Every verdict given so far, by pair key. */
export type Verdicts = Record<string, Verdict>

/**
 * The key of a pair: the texts of the point and the card, not their ids. A reworded card is
 * judged anew, and a fact that several papers ask for is judged once for all of them.
 */
export function pairKey(point: Point, card: Card): string {
  return createHash('sha256')
    .update([point.knows, card.question, card.answer].join('\n'))
    .digest('hex')
    .slice(0, 20)
}

/** For every point, the `k` cards closest to it by their words, best first. */
export function shortlist(points: Point[], cards: Card[], k: number): Map<string, Card[]> {
  const index = new MiniSearch<Card>({ fields: ['question', 'answer'], idField: 'id' })
  index.addAll(cards)
  const byId = new Map(cards.map((card) => [card.id, card]))
  return new Map(
    points.map((point) => {
      const hits = index.search(point.knows, { combineWith: 'OR', prefix: true, fuzzy: 0.2 })
      return [point.id, hits.slice(0, k).map((hit) => byId.get(hit.id as string)!)]
    }),
  )
}

export interface Standing {
  point: Point
  /** The best verdict any card of the deck has for the point. */
  verdict: Verdict
  /** The card that earned it, null when no card was judged. */
  card: string | null
}

const RANK: Record<Verdict, number> = { no: 0, partial: 1, same: 2 }

/** Where each point stands in a deck: the best verdict over every judged card of the deck. */
export function standings(points: Point[], cards: Card[], verdicts: Verdicts): Standing[] {
  return points.map((point) => {
    const standing: Standing = { point, verdict: 'no', card: null }
    for (const card of cards) {
      const verdict = verdicts[pairKey(point, card)]
      if (verdict && (standing.card === null || RANK[verdict] > RANK[standing.verdict])) {
        standing.verdict = verdict
        standing.card = card.id
      }
    }
    return standing
  })
}

/** The pairs of the shortlist that no judge has decided yet, each once. */
export function open(
  points: Point[],
  short: Map<string, Card[]>,
  verdicts: Verdicts,
): { point: Point; cards: Card[] }[] {
  const asked = new Set<string>()
  return points
    .map((point) => ({
      point,
      cards: (short.get(point.id) ?? []).filter((card) => {
        const key = pairKey(point, card)
        if (key in verdicts || asked.has(key)) return false
        asked.add(key)
        return true
      }),
    }))
    .filter((entry) => entry.cards.length > 0)
}

/** What is drawn and paid as one: a choice of questions, or a question outside any choice. */
const unitOf = (s: Standing) =>
  `${s.point.paper}\n${s.point.choice ?? `question ${s.point.question}`}`

function groups<T>(list: T[], key: (item: T) => string): T[][] {
  const found = new Map<string, T[]>()
  for (const item of list) found.set(key(item), [...(found.get(key(item)) ?? []), item])
  return [...found.values()]
}

const marks = (part: Standing[]) => part.reduce((total, s) => total + s.point.marks, 0)

/** What one unit pays in full, and what the deck's points earn of it. */
interface Tally {
  possible: number
  earned: number
}

/**
 * The marks of every unit, counted as the paper pays. A question pays at most its own marks,
 * so one that asks for "two of the four" is full with two. Of a choice of questions only the
 * best `pick` count, as for a student who answers the ones they know.
 */
function tallies(list: Standing[]): Tally[] {
  return groups(list, unitOf).map((unit) => {
    const questions = groups(unit, (s) => s.point.question).map((question) => {
      const cap = question[0]!.point.questionMarks
      const held = question.filter((s) => s.verdict === 'same')
      return { possible: Math.min(cap, marks(question)), earned: Math.min(cap, marks(held)) }
    })
    const pick = unit[0]!.point.pick ?? questions.length
    const best = (values: number[]) =>
      values
        .sort((x, y) => y - x)
        .slice(0, pick)
        .reduce((total, value) => total + value, 0)
    return {
      possible: best(questions.map((q) => q.possible)),
      earned: best(questions.map((q) => q.earned)),
    }
  })
}

function share(units: Tally[]): number {
  const possible = units.reduce((total, unit) => total + unit.possible, 0)
  const earned = units.reduce((total, unit) => total + unit.earned, 0)
  return possible === 0 ? 0 : earned / possible
}

/** The share of the marks the deck's points earn. */
export function coverage(list: Standing[]): number {
  return share(tallies(list))
}

/** A small seeded generator, so an interval is the same every time it is computed. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The 95 percent interval of a figure over the exam, by drawing its units with replacement.
 * A unit is a question, or a whole choice of questions: its points stand or fall together.
 * Each unit is tallied once and drawn as a whole. `figure` gets the indexes of the drawn units.
 */
function interval(
  units: number,
  figure: (drawn: number[]) => number,
  draws = 2000,
): [number, number] {
  const random = mulberry32(20261116)
  const results: number[] = []
  for (let d = 0; d < draws; d++) {
    const drawn = Array.from({ length: units }, () => Math.floor(random() * units))
    results.push(figure(drawn))
  }
  results.sort((x, y) => x - y)
  return [results[Math.floor(draws * 0.025)]!, results[Math.ceil(draws * 0.975) - 1]!]
}

/** One verdict as a judge writes it: a point and a card by their ids. */
export const LabelSchema = z.object({
  point: z.string(),
  card: z.string(),
  verdict: z.enum(VERDICTS),
})
export type Label = z.infer<typeof LabelSchema>

/**
 * Takes a judge's labels into the kept verdicts and says how many were new. A label for a
 * point or a card the run does not have is an error, never dropped in silence.
 */
export function ingest(
  labels: Label[],
  points: Point[],
  cards: Card[],
  verdicts: Verdicts,
): number {
  const pointOf = new Map(points.map((point) => [point.id, point]))
  const cardOf = new Map(cards.map((card) => [card.id, card]))
  let added = 0
  for (const label of labels) {
    const point = pointOf.get(label.point)
    const card = cardOf.get(label.card)
    if (!point) throw new Error(`A verdict names the point ${label.point}, which the rubric lacks.`)
    if (!card) throw new Error(`A verdict names the card ${label.card}, which the run lacks.`)
    const key = pairKey(point, card)
    if (!(key in verdicts)) added++
    verdicts[key] = label.verdict
  }
  return added
}

/** Coverage with its interval. */
export function score(list: Standing[]): { coverage: number; low: number; high: number } {
  const units = tallies(list)
  const [low, high] = interval(units.length, (drawn) => share(drawn.map((i) => units[i]!)))
  return { coverage: share(units), low, high }
}

export interface Comparison {
  /** Coverage of the second deck minus coverage of the first, with its interval. */
  difference: number
  low: number
  high: number
  /** Points only the second deck holds, and points only the first holds. */
  gained: Point[]
  lost: Point[]
}

/** Two decks on the same points, compared point by point. */
export function compare(first: Standing[], second: Standing[]): Comparison {
  const a = tallies(first)
  const b = tallies(second)
  const [low, high] = interval(a.length, (drawn) => {
    return share(drawn.map((i) => b[i]!)) - share(drawn.map((i) => a[i]!))
  })
  const held = (s: Standing) => s.verdict === 'same'
  return {
    difference: share(b) - share(a),
    low,
    high,
    gained: first.filter((s, i) => !held(s) && held(second[i]!)).map((s) => s.point),
    lost: first.filter((s, i) => held(s) && !held(second[i]!)).map((s) => s.point),
  }
}
