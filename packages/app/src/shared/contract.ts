/**
 * What crosses between the interface and the rest: the engine's commands and events (plain
 * JSON, the engine's one boundary, with the engine's own types) and the few things only the
 * shell can do (the key, the settings).
 */

import type {
  CardFile,
  Command,
  CourseState,
  CourseSummary,
  Decision,
  Event,
  FileKind,
  LeftOut,
  LectureState,
  PendingLecture,
  Problem,
  Run,
  Slots,
  Unreadable,
} from '@lectern/engine'

export type { Command, CourseSummary, Decision, Event, FileKind, Problem, Run, Slots, Unreadable }

export type Goal = CourseState['goal']
export type Phase = Extract<Event, { type: 'phase' }>['phase']
export const PHASES: readonly Phase[] = ['read', 'map', 'write', 'check']
export type Estimate = Extract<Event, { type: 'estimate' }>

/** One card, with every field of `design/cards/FIELDS.md`. */
export type Card = CardFile
export type Topic = LectureState['topics'][number]
export type Concept = Topic['concepts'][number]

/** A lecture as the interface holds it: the engine's state of it, with its cards loaded. */
export interface Lecture extends Omit<LectureState, 'cards'> {
  cards: Card[]
  /** The ids of its cards that are in Anki. */
  inAnki: string[]
}

/** The word limits a card form shows next to its fields. */
export type Limits = Extract<Event, { type: 'slots' }>['limits']

/**
 * A file of the last add that stayed out of the course: the engine's reasons, and `format` for
 * a slide deck, document or photo that is not a PDF.
 */
export interface LeftFile {
  path: string
  why: LeftOut['why'] | 'format'
  kind: FileKind | null
}

/** A lecture PDF that is in the course but has no cards yet. */
export type Pending = PendingLecture

/** One course as the screens read it: the engine's course state with the cards loaded. */
export interface CourseView extends Omit<CourseState, 'lectures'> {
  lectures: Lecture[]
}

export interface Settings {
  provider: 'openai'
  /** Whether a key is stored. The key itself never reaches the interface. */
  hasKey: boolean
}

export type KeyResult = { ok: true } | { ok: false; message: string; fix: string }

/** `window.lectern`, put there by the preload script. */
export interface Bridge {
  /** Runs one engine command. Resolves after its last event. */
  run(command: Command, onEvent: (event: Event) => void): Promise<void>
  settings(): Promise<Settings>
  /** Checks the key with the provider, then stores it in the system's protected storage. */
  saveKey(key: string): Promise<KeyResult>
  platform: string
}
