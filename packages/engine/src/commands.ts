/**
 * What crosses the engine's one boundary: the commands it takes and the events it emits, both
 * plain data. `api.ts` runs them; the modules that do the work only need these shapes.
 */

import { z } from 'zod'
import { GOALS, ROLES } from './cards/roles.ts'
import { OWN_ROLES, type Problem, type Slots } from './cards/slots.ts'
import type { ShownCard } from './cards/fields.ts'
import type { ProviderError, Unreadable } from './errors.ts'
import type { Added, CourseState, CourseSummary, Shelf } from './library.ts'

/** The course folder inside the store. */
const course = z.string().min(1)
/** Asked once per course. Kept in `course.json`; `good` when never given. */
const goal = z.enum(GOALS).optional()

const lecture = z.number().int().positive()
/** A card as a form holds it: the slots of its role in plain text. */
const slotsSchema = z.object({
  role: z.enum(ROLES),
  front: z.string(),
  answers: z.array(z.object({ text: z.string(), key: z.string() })),
  labels: z.array(z.string()),
  hidden: z.array(z.string()),
  at: z.array(z.number().int()),
  extra: z.string(),
  code: z.string(),
})

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('build'),
    course,
    goal,
    /** A spending limit in dollars for this build. Without it: three times the estimate. */
    capUsd: z.number().positive().optional(),
  }),
  /** What a build of the new lectures would cost. Reads the PDFs, calls no model. */
  z.object({ type: z.literal('estimate'), course, goal }),
  /** Every course in the library. */
  z.object({ type: z.literal('courses') }),
  /** One course as the interface shows it: its lectures, what was decided, what it cost. */
  z.object({ type: z.literal('course'), course }),
  /** The cards of one lecture, each with its slots and its fields. */
  z.object({ type: z.literal('cards'), course, lecture: z.number().int().positive() }),
  /** A new, empty course. The reply names its folder. */
  z.object({ type: z.literal('create'), name: z.string().trim().min(1), goal }),
  /** One slide as a picture, for the thumbnail beside a card. */
  z.object({
    type: z.literal('slide'),
    course,
    lecture: z.number().int().positive(),
    slide: z.number().int().positive(),
  }),
  /**
   * Adds PDFs to the course, each as its file name, or its path inside a folder the student
   * added, and its bytes. Lecture slides are what the next `build` builds; past exam papers are
   * what it turns into cards first. With `to`, every file goes there; without it, each file is
   * sorted by its kind, and what is neither stays out.
   */
  z.object({
    type: z.literal('add'),
    course,
    files: z.array(z.object({ name: z.string().min(1), data: z.instanceof(Uint8Array) })).min(1),
    to: z.enum(['slides', 'exams']).optional(),
  }),
  /** Moves a file without cards between lecture slides and past exams. */
  z.object({
    type: z.literal('move'),
    course,
    file: z.string().min(1),
    to: z.enum(['slides', 'exams']),
  }),
  /** Sends the cards that are not in Anki yet. */
  z.object({ type: z.literal('send'), course }),
  /** A card as a form holds it. Without `card`: empty slots for a card of the student's own. */
  z.object({
    type: z.literal('slots'),
    course,
    lecture,
    card: z.string().optional(),
    role: z.enum(OWN_ROLES).optional(),
  }),
  /** Changes the wording of a card, in Anki too when it is there. */
  z.object({ type: z.literal('edit'), course, lecture, card: z.string(), slots: slotsSchema }),
  /** Removes a card, from Anki too when it is there. */
  z.object({ type: z.literal('remove'), course, lecture, card: z.string() }),
  /** A card of the student's own on a concept of the lecture. */
  z.object({ type: z.literal('write'), course, lecture, concept: z.string(), slots: slotsSchema }),
])

export type Command = z.infer<typeof CommandSchema>
export type BuildCommand = Extract<Command, { type: 'build' }>
export type EstimateCommand = Extract<Command, { type: 'estimate' }>

type Phase = 'read' | 'map' | 'write' | 'check'

export type Event =
  | { type: 'phase'; phase: Phase; status: 'started' | 'done'; total: number }
  /** `lecture` names the lecture a step just finished for, where a step belongs to one. */
  | { type: 'progress'; phase: Phase; done: number; total: number; lecture?: number }
  /** Before the first paid call of a build, and the whole answer to `estimate`. */
  | {
      type: 'estimate'
      lectures: number
      slides: number
      cards: number
      costUsd: number
      /** What to show the student: euros, rounded up to a coarse step. */
      costEur: number
      capUsd: number
      /** New lecture PDFs and past papers that cannot be read: the build leaves them out. */
      unreadable: { file: string; why: Unreadable }[]
    }
  | {
      type: 'built'
      /** The lectures this build added. Empty when nothing was new. */
      lectures: { number: number; title: string; concepts: number; cards: number }[]
      cards: number
      dropped: number
      costUsd: number
      durationMs: number
    }
  | { type: 'courses'; courses: CourseSummary[] }
  | { type: 'course'; course: CourseState }
  /** `sent` are the ids of the cards that are in Anki. */
  | { type: 'cards'; lecture: number; cards: ShownCard[]; sent: string[] }
  /** A PNG in base64. */
  | { type: 'slide'; lecture: number; slide: number; png: string }
  | { type: 'created'; course: string }
  /** What came in, under the names it now has in the course, and what stayed out. */
  | ({ type: 'added'; course: string } & Added)
  | { type: 'moved'; course: string; file: string; to: Shelf }
  /** After each card that reached Anki. `lecture` is the lecture being sent. */
  | { type: 'sending'; lecture: number; done: number; total: number }
  /** `deck` is the course's deck in Anki, with one subdeck per lecture. */
  | { type: 'sent'; deck: string; cards: number; lectures: number[] }
  /** `limits` are the word limits a form shows. `card` is missing for a card not written yet. */
  | {
      type: 'slots'
      card?: string
      slots: Slots
      limits: { front: number; answer: number; extra: number; gapSentence: number }
    }
  | { type: 'edited'; card: ShownCard }
  | { type: 'removed'; card: string }
  | { type: 'written'; card: ShownCard }
  /** The card was not taken. Each problem names the field of the form it is about. */
  | { type: 'refused'; problems: Problem[] }
  /** `reason` is set when a model provider failed, so an interface can word the fix its own way. */
  | { type: 'failed'; message: string; fix: string; reason?: ProviderError['reason'] }

export type Emit = (event: Event) => void
