/**
 * The one boundary between an interface and the engine: commands in, events out, both plain
 * JSON. Today the caller is the command line or a test; later the app's channel or HTTP.
 */

import { z } from 'zod'
import { build, estimateCourse } from './build.ts'
import { GOALS, ROLES } from './cards/roles.ts'
import { OWN_ROLES, type Problem, type Slots } from './cards/slots.ts'
import { restyle, send } from './deliver.ts'
import { edit, remove, slots, write } from './edit.ts'
import { DESIGNS } from './designs.ts'
import { CALIBRATIONS, PROFILE_KINDS, type Calibrations, type ProfileKind } from './decide.ts'
import type { CardFile } from './cards/assemble.ts'
import { EngineError } from './errors.ts'
import {
  addSlides,
  createCourse,
  listCourses,
  readCourse,
  readLectureCards,
  renderSlide,
  type CourseState,
  type CourseSummary,
} from './library.ts'
import { outline } from './outline.ts'
import type { Ports } from './ports.ts'
import { PRESET_IDS } from './presets.ts'

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
  extra: z.string(),
  code: z.string(),
})

const CommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('build'),
    course,
    goal,
    /** The student's correction of the kind of course. Without it the engine decides. */
    profile: z.enum(PROFILE_KINDS).optional(),
    /** Write with this preset instead of the one the kind of course picks. For trying a draft. */
    preset: z.enum(PRESET_IDS).optional(),
    /** A spending limit in dollars for this build. Without it: three times the estimate. */
    capUsd: z.number().positive().optional(),
  }),
  /** What a build of the new lectures would cost. Reads the PDFs, calls no model. */
  z.object({ type: z.literal('estimate'), course, goal }),
  z.object({ type: z.literal('outline'), course }),
  /** Every course in the library. */
  z.object({ type: z.literal('courses') }),
  /** One course as the interface shows it: its lectures, what was decided, what it cost. */
  z.object({ type: z.literal('course'), course }),
  /** The cards of one lecture, with all their fields. */
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
  /** Adds PDFs to the course, each as its file name and its bytes in base64. The next `build` builds them. */
  z.object({
    type: z.literal('add'),
    course,
    files: z.array(z.object({ name: z.string().min(1), data: z.string().min(1) })).min(1),
  }),
  /** Sends the cards that are not in Anki yet, as notes in the given card design. */
  z.object({ type: z.literal('send'), course, design: z.enum(DESIGNS) }),
  /** Gives the cards already in Anki the look of the design. Changes nothing before a first send. */
  z.object({ type: z.literal('restyle'), design: z.enum(DESIGNS) }),
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
      capUsd: number
    }
  /** The kind of course, for the student's one line to confirm. Confidence is null when they set it. */
  | { type: 'profile'; kind: ProfileKind; confidence: number | null }
  | {
      type: 'built'
      /** The lectures this build added. Empty when nothing was new. */
      lectures: { number: number; title: string; concepts: number; cards: number }[]
      cards: number
      dropped: number
      /** Cards an uncalibrated check has a remark on. They are kept. */
      flagged: number
      costUsd: number
      durationMs: number
    }
  | { type: 'outline'; markdown: string }
  | { type: 'courses'; courses: CourseSummary[] }
  | { type: 'course'; course: CourseState }
  | { type: 'cards'; lecture: number; cards: CardFile[] }
  /** A PNG in base64. */
  | { type: 'slide'; lecture: number; slide: number; png: string }
  | { type: 'created'; course: string }
  /** The file names as they now are in the course. */
  | { type: 'added'; course: string; files: string[] }
  /** After each card that reached Anki. `lecture` is the lecture being sent. */
  | { type: 'sending'; lecture: number; done: number; total: number }
  /** `deck` is the course's deck in Anki, with one subdeck per lecture. */
  | { type: 'sent'; deck: string; cards: number; lectures: number[] }
  /** The note types in Anki that took the design. Empty when Lectern has none there. */
  | { type: 'restyled'; noteTypes: string[] }
  /** `limits` are the word limits a form shows. `card` is missing for a card not written yet. */
  | {
      type: 'slots'
      card?: string
      slots: Slots
      limits: { front: number; answer: number; extra: number; gapSentence: number }
    }
  | { type: 'edited'; card: CardFile }
  | { type: 'removed'; card: string }
  | { type: 'written'; card: CardFile }
  /** The card was not taken. Each problem names the field of the form it is about. */
  | { type: 'refused'; problems: Problem[] }
  | { type: 'failed'; message: string; fix: string }

export type Emit = (event: Event) => void

export interface Engine {
  /** Runs one command. Resolves after the last event; a failure is an event, not a throw. */
  run(command: unknown, emit: Emit): Promise<void>
}

export interface Options {
  /** Which checks have been measured on labelled data. Unmeasured checks only flag. */
  calibrations?: Partial<Calibrations>
}

export function createEngine(ports: Ports, options: Options = {}): Engine {
  const calibrations = { ...CALIBRATIONS, ...options.calibrations }
  return {
    async run(command, emit) {
      try {
        const parsed = CommandSchema.safeParse(command)
        if (!parsed.success) {
          throw new EngineError(
            'Lectern did not understand this command.',
            z.prettifyError(parsed.error),
          )
        }
        const known = parsed.data
        const { store } = ports
        switch (known.type) {
          case 'build':
            return await build(ports, calibrations, known, emit)
          case 'estimate':
            return await estimateCourse(ports, known, emit)
          case 'outline':
            return emit({ type: 'outline', markdown: await outline(store, known.course) })
          case 'courses':
            return emit({ type: 'courses', courses: await listCourses(store) })
          case 'course':
            return emit({ type: 'course', course: await readCourse(ports, known.course) })
          case 'cards':
            return emit({
              type: 'cards',
              lecture: known.lecture,
              cards: await readLectureCards(store, known.course, known.lecture),
            })
          case 'slide': {
            const { png } = await renderSlide(ports, known.course, known.lecture, known.slide)
            return emit({ type: 'slide', lecture: known.lecture, slide: known.slide, png })
          }
          case 'create':
            return emit({
              type: 'created',
              course: await createCourse(store, known.name, known.goal ?? 'good'),
            })
          case 'add':
            return emit({
              type: 'added',
              course: known.course,
              files: await addSlides(store, known.course, known.files),
            })
          case 'send':
            return await send(ports, known, emit)
          case 'restyle':
            return await restyle(ports, known.design, emit)
          case 'slots':
            return await slots(ports, known, emit)
          case 'edit':
            return await edit(ports, known, emit)
          case 'remove':
            return await remove(ports, known, emit)
          case 'write':
            return await write(ports, known, emit)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const fix = error instanceof EngineError ? error.fix : 'Run the command again.'
        emit({ type: 'failed', message, fix })
      }
    },
  }
}

export { EngineError } from './errors.ts'
export type * from './ports.ts'
export type { Design } from './designs.ts'
export type { CardFile } from './cards/assemble.ts'
export type { Problem, Slots } from './cards/slots.ts'
export type { CourseFile, Decision, Lecture, Run } from './course.ts'
export type { Calibrations } from './decide.ts'
export type { CourseState, CourseSummary, LectureState, PendingLecture } from './library.ts'
