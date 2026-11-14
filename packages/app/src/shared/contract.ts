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
  LectureState,
  PendingLecture,
  Run,
} from '@lectern/engine'

export type { Command, CourseSummary, Decision, Event, Run }

export type Goal = CourseState['goal']
export type Phase = Extract<Event, { type: 'phase' }>['phase']
export const PHASES: readonly Phase[] = ['read', 'map', 'write', 'check']
export type Estimate = Extract<Event, { type: 'estimate' }>

/** One card, with every field of `design/v3/cards/FIELDS.md`. */
export type Card = CardFile
export type Topic = LectureState['topics'][number]
export type Concept = Topic['concepts'][number]

/** A lecture as the interface holds it: the engine's state of it, with its cards loaded. */
export interface Lecture extends Omit<LectureState, 'cards'> {
  cards: Card[]
}

/** A lecture PDF that is in the course but has no cards yet. */
export type Pending = PendingLecture

/** One course as the screens read it: the engine's course state with the cards loaded. */
export interface CourseView extends Omit<CourseState, 'lectures'> {
  lectures: Lecture[]
}

export const DESIGNS = ['native', 'structure', 'lamp', 'colours', 'afterglow', 'vitrine'] as const
export type Design = (typeof DESIGNS)[number]

export interface Settings {
  provider: 'openai'
  /** Whether a key is stored. The key itself never reaches the interface. */
  hasKey: boolean
  design: Design
}

export type KeyResult = { ok: true } | { ok: false; message: string; fix: string }

/** `window.lectern`, put there by the preload script. */
export interface Bridge {
  /** Runs one engine command. Resolves after its last event. */
  run(command: Command, onEvent: (event: Event) => void): Promise<void>
  settings(): Promise<Settings>
  setDesign(design: Design): Promise<Settings>
  /** Checks the key with the provider, then stores it in the system's protected storage. */
  saveKey(key: string): Promise<KeyResult>
  platform: string
}
