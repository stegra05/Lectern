/**
 * The course folder: its shapes and how they are read and written.
 *
 *   <course>/slides/*.pdf                 input, one PDF per lecture
 *   <course>/course.json                  CourseFile
 *   <course>/lectures/02/lecture.json     Lecture
 *   <course>/lectures/02/cards/<id>.json  CardFile
 *   <course>/decisions.json               Decision[]
 *   <course>/runs/001.json                Run
 */

import type { CardFile } from './cards/assemble.ts'
import type { Goal } from './cards/roles.ts'
import { two } from './cards/words.ts'
import type { Store } from './ports.ts'

export interface Concept {
  id: string
  name: string
  slides: number[]
}

export interface Topic {
  name: string
  concepts: Concept[]
}

export interface LeftOut {
  slide: number
  reason: string
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
  kind: 'goal' | 'left-out' | 'already-covered' | 'no-card' | 'dropped'
  text: string
}

export interface Run {
  run: number
  startedAt: string
  model: string
  goal: Goal
  lectures: number[]
  cards: number
  dropped: number
  calls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  durationMs: number
  phaseMs: Record<'read' | 'map' | 'write' | 'check', number>
}

export const paths = {
  course: (course: string) => `${course}/course.json`,
  slides: (course: string) => `${course}/slides`,
  lecture: (course: string, n: number) => `${course}/lectures/${two(n)}/lecture.json`,
  cards: (course: string, n: number) => `${course}/lectures/${two(n)}/cards`,
  decisions: (course: string) => `${course}/decisions.json`,
  runs: (course: string) => `${course}/runs`,
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
  const dir = paths.cards(course, lecture)
  const names = (await store.list(dir)).filter((n) => n.endsWith('.json')).sort()
  const cards = await Promise.all(names.map((n) => readJson<CardFile>(store, `${dir}/${n}`)))
  return cards.filter((c) => c !== null)
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
