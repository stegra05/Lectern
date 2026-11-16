/**
 * The course folder: its shapes and how they are read and written.
 *
 *   <course>/slides/*.pdf              input, one PDF per lecture
 *   <course>/exams/*.pdf               input, past exam papers
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
import type { FactKind } from './decide.ts'
import { two } from './cards/words.ts'
import { EngineError } from './errors.ts'
import type { Store } from './ports.ts'

/** One thing a card can test, as the lecture states it. */
export interface Fact {
  text: string
  slide: number
  kind: FactKind
  /** How many items the fact lists, when it is a list to recite. */
  items?: number
  /** How much it is worth learning, from 0 to 3 (`WORTH_LEVELS`). Absent without a verdict. */
  worth?: number
  /** Set when the fact answers a question of past exams rather than coming from a slide. */
  exam?: ExamFact
}

/** Where a fact that answers a past exam question comes from. */
export interface ExamFact {
  /** The question in the words the papers use most. */
  question: string
  /** How many past papers asked it. */
  papers: number
  /** False when the slides do not hold the answer and the model wrote it from what it knows. */
  fromSlides: boolean
}

export interface Concept {
  /** The same id in every lecture that teaches the concept. */
  id: string
  /** The one name the course uses for it. */
  name: string
  /** The slides of its facts. */
  slides: number[]
  /** Set when an earlier lecture introduced the concept: that lecture's number. */
  since?: number
  /** In the order the map listed them. Their worth and the goal decide which get a card. */
  facts: Fact[]
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
  lectures: { number: number; title: string; file: string; sha256: string; slides: number }[]
}

export interface Decision {
  /** The lecture the decision is about, or null for the whole course. */
  lecture: number | null
  kind: 'goal' | 'exams' | 'left-out' | 'beyond-goal' | 'recurring' | 'no-card' | 'dropped'
  text: string
}

export interface Run {
  run: number
  startedAt: string
  model: string
  decisionModel: string
  /** Set when the build stopped before it finished. The run then records what it had spent. */
  failed?: true
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
  /** What the run cost as the student is shown it, by the same conversion as the estimate. */
  costEur: number
  durationMs: number
  phaseMs: Record<'read' | 'map' | 'write' | 'check', number>
  /** Where the time went, step by step: see `StepTime`. */
  steps: Record<string, StepTime>
}

/**
 * The time of one step of a build, summed over every lecture it ran for; steps of different
 * lectures overlap. A call's time includes its wait for a free place among the build's calls,
 * so `callMs` over `ms` is how many calls were under way or waiting at once.
 */
export interface StepTime {
  ms: number
  /** Model calls and decision requests made in the step. */
  calls: number
  /** Their durations added up, waits included. */
  callMs: number
  slowestMs: number
}

export const paths = {
  course: (course: string) => `${course}/course.json`,
  slides: (course: string) => `${course}/slides`,
  exams: (course: string) => `${course}/exams`,
  examsFile: (course: string) => `${course}/exams.json`,
  lecture: (course: string, n: number) => `${course}/lectures/${two(n)}/lecture.json`,
  cards: (course: string, n: number) => `${course}/lectures/${two(n)}/cards.yaml`,
  decisions: (course: string) => `${course}/decisions.json`,
  runs: (course: string) => `${course}/runs`,
  anki: (course: string) => `${course}/anki.json`,
}

/** A course file that no longer parses, cut short by a crash or edited by hand. */
export function damaged(path: string): EngineError {
  return new EngineError(
    `The file ${path} in your course library is damaged and cannot be read.`,
    'Restore the file from a backup, then open the course again.',
  )
}

export async function readJson<T>(store: Store, path: string): Promise<T | null> {
  const text = await store.read(path)
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch {
    throw damaged(path)
  }
}

export function writeJson(store: Store, path: string, value: unknown): Promise<void> {
  return store.write(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function readCards(
  store: Store,
  course: string,
  lecture: number,
): Promise<CardFile[]> {
  const path = paths.cards(course, lecture)
  const text = await store.read(path)
  if (text === null) return []
  try {
    return (parse(text) as CardFile[] | null) ?? []
  } catch {
    throw damaged(path)
  }
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

/** The fingerprint of a file's content: two files with the same one are the same file. */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
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
    const leading = Number(/^\d{1,3}(?!\d|[-./]\d)/.exec(file)?.[0] ?? 0)
    const number = leading > 0 && !used.has(leading) ? leading : Math.max(0, ...used) + 1
    used.add(number)
    return number
  })
}
