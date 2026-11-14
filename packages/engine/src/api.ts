/**
 * The one boundary between an interface and the engine: commands in, events out, both plain
 * JSON. Today the caller is the command line or a test; later the app's channel or HTTP.
 */

import { z } from 'zod'
import { build } from './build.ts'
import { GOALS } from './cards/roles.ts'
import { EngineError } from './errors.ts'
import { outline } from './outline.ts'
import type { Ports } from './ports.ts'

const CommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('build'),
    /** The course folder inside the store. */
    course: z.string().min(1),
    /** Asked once per course. Kept in `course.json`; `good` when never given. */
    goal: z.enum(GOALS).optional(),
  }),
  z.object({ type: z.literal('outline'), course: z.string().min(1) }),
])

export type Command = z.infer<typeof CommandSchema>
export type BuildCommand = Extract<Command, { type: 'build' }>

export type Event =
  | {
      type: 'phase'
      phase: 'read' | 'map' | 'write' | 'check'
      status: 'started' | 'done'
      total: number
    }
  | { type: 'progress'; phase: 'read' | 'map' | 'write' | 'check'; done: number; total: number }
  | {
      type: 'built'
      /** The lectures this build added. Empty when nothing was new. */
      lectures: { number: number; title: string; concepts: number; cards: number }[]
      cards: number
      dropped: number
      costUsd: number
      durationMs: number
    }
  | { type: 'outline'; markdown: string }
  | { type: 'failed'; message: string; fix: string }

export type Emit = (event: Event) => void

export interface Engine {
  /** Runs one command. Resolves after the last event; a failure is an event, not a throw. */
  run(command: unknown, emit: Emit): Promise<void>
}

export function createEngine(ports: Ports): Engine {
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
        if (parsed.data.type === 'build') await build(ports, parsed.data, emit)
        else emit({ type: 'outline', markdown: await outline(ports.store, parsed.data.course) })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const fix = error instanceof EngineError ? error.fix : 'Run the command again.'
        emit({ type: 'failed', message, fix })
      }
    },
  }
}

export { EngineError } from './errors.ts'
export type { Ports, ModelPort, ModelRequest, PdfPort, Store, Usage } from './ports.ts'
export type { CardFile } from './cards/assemble.ts'
export type { CourseFile, Decision, Lecture, Run } from './course.ts'
