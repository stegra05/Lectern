/**
 * The course folder: its shapes and how they are read and written.
 *
 *   <course>/slides/*.pdf              input, one PDF per lecture
 *   <course>/course.json               CourseFile
 *   <course>/lectures/02/lecture.json  Lecture: the tree, and what was left out
 *   <course>/lectures/02/cards.yaml    CardFile[], one readable file per lecture
 *   <course>/decisions.json            Decision[]
 *   <course>/runs/001.json             Run
 *   <course>/anki.json                 which Anki note each sent card became
 */

import { parse, stringify } from 'yaml'
import type { CardFile } from './cards/assemble.ts'
import type { Goal } from './cards/roles.ts'
import type { FactKind, ProfileKind } from './decide.ts'
import { two } from './cards/words.ts'
import type { Store } from './ports.ts'

/** One thing a card can test, as the lecture states it. */
export interface Fact {
  text: string
  slide: number
  kind: FactKind
  /** How many items the fact lists, when it is a list to recite. */
  items?: number
}

export interface Concept {
  /** The same id in every lecture that teaches the concept. */
  id: string
  /** The one name the course uses for it. */
  name: string
  /** The slides of its facts. */
  slides: number[]
  /** A student who only wants to pass must still know it. */
  core: boolean
  /** Set when an earlier lecture introduced the concept: that lecture's number. */
  since?: number
  /** In the order the lecture weighs them. The goal decides how many get a card. */
  facts: Fact[]
  /** What an uncalibrated check noticed. Shown, never acted on. */
  flags?: string[]
}

export interface Topic {
  name: string
  concepts: Concept[]
}

export interface LeftOut {
  slide: number
  reason: string
}

/** A card that still failed the checks after the rewrites. */
export interface Dropped {
  concept: string
  role: string
  front: string
  problems: string[]
}

export interface Lecture {
  number: number
  title: string
  /** File name inside `slides/`. */
  file: string
  /** Number of slides in the PDF. */
  slides: number
  topics: Topic[]
  leftOut: LeftOut[]
  dropped: Dropped[]
}

export interface CourseFile {
  format: 1
  name: string
  goal: Goal
  /** The kind of lecture, which picks the preset. Set by the first build. Confidence is null when the student set it. */
  profile?: { kind: ProfileKind; confidence: number | null }
  lectures: { number: number; title: string; file: string; sha256: string; slides: number }[]
}

export interface Decision {
  /** The lecture the decision is about, or null for the whole course. */
  lecture: number | null
  kind: 'goal' | 'profile' | 'left-out' | 'outside-core' | 'recurring' | 'no-card' | 'dropped'
  text: string
}

export interface Run {
  run: number
  startedAt: string
  model: string
  decisionModel: string
  /** The preset the cards were written with. */
  preset: string
  goal: Goal
  lectures: number[]
  cards: number
  dropped: number
  /** Calls to the writing model. */
  calls: number
  /** Closed questions answered by the decision model. */
  decisions: number
  inputTokens: number
  /** The share of the input the provider served from its cache. */
  cachedInputTokens: number
  outputTokens: number
  estimateUsd: number
  costUsd: number
  durationMs: number
  phaseMs: Record<'read' | 'map' | 'write' | 'check', number>
}

export const paths = {
  course: (course: string) => `${course}/course.json`,
  slides: (course: string) => `${course}/slides`,
  lecture: (course: string, n: number) => `${course}/lectures/${two(n)}/lecture.json`,
  cards: (course: string, n: number) => `${course}/lectures/${two(n)}/cards.yaml`,
  decisions: (course: string) => `${course}/decisions.json`,
  runs: (course: string) => `${course}/runs`,
  anki: (course: string) => `${course}/anki.json`,
}

export async function readJson<T>(store: Store, path: string): Promise<T | null> {
  const text = await store.read(path)
  return text === null ? null : (JSON.parse(text) as T)
}

export function writeJson(store: Store, path: string, value: unknown): Promise<void> {
  return store.write(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function readCards(
  store: Store,
  course: string,
  lecture: number,
): Promise<CardFile[]> {
  const text = await store.read(paths.cards(course, lecture))
  return text === null ? [] : ((parse(text) as CardFile[] | null) ?? [])
}

/** Long lines stay whole, so a card field reads as one line. */
export function writeCards(
  store: Store,
  course: string,
  lecture: number,
  cards: CardFile[],
): Promise<void> {
  return store.write(paths.cards(course, lecture), stringify(cards, { lineWidth: 0 }))
}

/** A lecture's name guessed from its file name, until the map gives the real one. */
export function titleFromFile(file: string, number: number): string {
  const name = file
    .replace(/\.pdf$/i, '')
    .replace(/^[\d\s._-]+/, '')
    .replace(/_+/g, ' ')
  return name || `Lecture ${number}`
}

/** Lecture PDFs in course order: by file name, numbers compared as numbers. */
export function inCourseOrder(files: string[]): string[] {
  return files
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

/**
 * Lecture numbers for new files. A lecture keeps its number forever, so a new file takes the
 * leading number of its name when that is free, and otherwise the next number after the highest.
 */
export function assignNumbers(taken: number[], files: string[]): number[] {
  const used = new Set(taken)
  return files.map((file) => {
    const leading = Number(/^\d{1,3}/.exec(file)?.[0] ?? 0)
    const number = leading > 0 && !used.has(leading) ? leading : Math.max(0, ...used) + 1
    used.add(number)
    return number
  })
}
