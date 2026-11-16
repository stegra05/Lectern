/**
 * The one boundary between an interface and the engine: commands in, events out, both plain
 * JSON. Today the caller is the command line or a test; later the app's channel or HTTP.
 */

import PQueue from 'p-queue'
import { z } from 'zod'
import { build, estimateCourse } from './build.ts'
import { CommandSchema, type Command, type Emit } from './commands.ts'
import { send, sentCards } from './deliver.ts'
import { withFields } from './cards/fields.ts'
import { edit, remove, slots, write } from './edit.ts'
import { EngineError, fileFailure, ProviderError } from './errors.ts'
import {
  addFiles,
  moveFile,
  createCourse,
  deleteCourse,
  setGoal,
  listCourses,
  readCourse,
  readLectureCards,
  renderSlide,
} from './library.ts'
import type { Ports } from './ports.ts'

export interface Engine {
  /**
   * Runs one command. Resolves after the last event; a failure is an event, not a throw. A build
   * or a send stops when `signal` aborts, at the next point where what it did so far is saved.
   */
  run(command: unknown, emit: Emit, signal?: AbortSignal): Promise<void>
}

/** The commands that write to a course. Every other command only reads, and never waits. */
const WRITES: ReadonlySet<string> = new Set([
  'build',
  'add',
  'move',
  'send',
  'edit',
  'remove',
  'write',
  'goal',
  'delete',
] satisfies Command['type'][])

/**
 * One queue per course, so the commands that write to it run one after the other: each reads a
 * file, waits on PDFs, Anki or the models, and writes the whole file back. The queues belong to
 * no one engine, since the app and the tests make a new engine for every command.
 */
const queues = new Map<string, PQueue>()
/** The courses whose cards are being made. A build takes minutes, so nothing waits behind it. */
const building = new Set<string>()

/** The course a command writes to, or null when it only reads. Its shape is checked as it runs. */
function writesTo(command: unknown): string | null {
  const { type, course } = (command ?? {}) as { type?: unknown; course?: unknown }
  return typeof type === 'string' && WRITES.has(type) && typeof course === 'string' ? course : null
}

export function createEngine(ports: Ports): Engine {
  const engine = direct(ports)
  return {
    async run(command, emit, signal) {
      const course = writesTo(command)
      if (course === null) return engine.run(command, emit, signal)
      if (building.has(course)) {
        return emit({
          type: 'failed',
          message: 'Lectern is making the cards of this course.',
          fix: 'Wait until they are made, then try again.',
        })
      }
      const isBuild = (command as { type: string }).type === 'build'
      if (isBuild) building.add(course)
      let queue = queues.get(course)
      if (!queue) queues.set(course, (queue = new PQueue({ concurrency: 1 })))
      try {
        await queue.add(() => engine.run(command, emit, signal))
      } finally {
        if (isBuild) building.delete(course)
      }
    },
  }
}

/** Runs a command at once, whatever else runs on its course. */
function direct(ports: Ports): Engine {
  return {
    async run(command, emit, signal) {
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
            return await build(ports, known, emit, signal)
          case 'estimate':
            return await estimateCourse(ports, known, emit)
          case 'courses':
            return emit({ type: 'courses', courses: await listCourses(store) })
          case 'course':
            return emit({ type: 'course', course: await readCourse(ports, known.course) })
          case 'cards': {
            const cards = await readLectureCards(store, known.course, known.lecture)
            const inAnki = await sentCards(store, known.course)
            return emit({
              type: 'cards',
              lecture: known.lecture,
              cards: cards.map(withFields),
              sent: cards.map((card) => card.id).filter((id) => inAnki.has(id)),
            })
          }
          case 'slide': {
            const { png } = await renderSlide(ports, known.course, known.lecture, known.slide)
            return emit({ type: 'slide', lecture: known.lecture, slide: known.slide, png })
          }
          case 'create':
            return emit({
              type: 'created',
              course: await createCourse(store, known.name, known.goal ?? 'good'),
            })
          case 'goal':
            await setGoal(store, known.course, known.goal)
            return emit({ type: 'goal', course: known.course, goal: known.goal })
          case 'delete':
            await deleteCourse(store, known.course)
            return emit({ type: 'deleted', course: known.course })
          case 'add':
            return emit({
              type: 'added',
              course: known.course,
              ...(await addFiles(ports, known.course, known.files, known.to)),
            })
          case 'move':
            await moveFile(store, known.course, known.file, known.to)
            return emit({ type: 'moved', course: known.course, file: known.file, to: known.to })
          case 'send':
            return await send(ports, known, emit, signal)
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
        const known = error instanceof EngineError ? error : fileFailure(error)
        if (known) {
          const reason = known instanceof ProviderError ? known.reason : undefined
          return emit({
            type: 'failed',
            message: known.message,
            fix: known.fix,
            ...(reason && { reason }),
          })
        }
        const message = error instanceof Error ? error.message : String(error)
        emit({
          type: 'failed',
          message,
          fix: 'Try again. If it keeps failing, start Lectern again.',
        })
      }
    },
  }
}

export type { BuildCommand, Command, Emit, EstimateCommand, Event } from './commands.ts'
export { EngineError, type Unreadable } from './errors.ts'
export type * from './ports.ts'
export type { Card } from './cards/card.ts'
export type { ShownCard } from './cards/fields.ts'
export type { Problem, Slots } from './cards/slots.ts'
export type { CourseFile, Decision, Lecture, Run } from './course.ts'
export type {
  CourseState,
  CourseSummary,
  LectureState,
  PaperState,
  Added,
  LeftOut,
  PendingLecture,
  Shelf,
} from './library.ts'
export type { FileKind } from './sort.ts'
