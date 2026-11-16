/**
 * The engine's two ways to spend money, wrapped once: every model call and every decision
 * request is metered and limited here. A call starts only when what was spent, what the calls
 * under way are expected to cost and its own expected cost stay within the cap.
 */

import PQueue from 'p-queue'
import { z } from 'zod'
import { decisionReservation, modelReservation } from './cost.ts'
import { EngineError } from './errors.ts'
import type { Answer, DecisionRequest, ModelRequest, Ports, Usage } from './ports.ts'

export interface Meter {
  calls: number
  decisions: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  costUsd: number
}

/**
 * A model call. Of the calls waiting for a free place, the one with the highest `priority`
 * goes first (default 0).
 */
export type AskModel = <S extends z.ZodType>(
  request: Omit<ModelRequest, 'schema' | 'onUsage'>,
  schema: S,
  priority?: number,
) => Promise<z.infer<S>>
export type Decide = (
  request: Omit<DecisionRequest, 'onUsage'>,
  priority?: number,
) => Promise<Answer[]>

/** Model calls and decision requests of one build that run at the same time. */
export const PARALLEL = 32

/** The JSON Schema a model port receives: closed objects, every property required. */
export function replySchema(schema: z.ZodType): Record<string, unknown> {
  const out: Record<string, unknown> = z.toJSONSchema(schema)
  delete out.$schema
  return out
}

export function createAsk(
  ports: Ports,
  meter: Meter,
  capUsd: number,
  /** Aborted when the student stops the build: no call starts after it. */
  signal?: AbortSignal,
): {
  model: AskModel
  decide: Decide
  /** Stops new calls after a failure outside a call, and waits for the calls still running. */
  stop: (error: unknown) => Promise<void>
} {
  const capped = (why: string) =>
    new EngineError(
      `The run was stopped at ${meter.costUsd.toFixed(2)} dollars, ${why} its cap of ${capUsd.toFixed(2)} dollars.`,
      'The lectures finished before the stop are saved. Build again to make the rest.',
    )
  const spend = (usage: Usage) => {
    meter.inputTokens += usage.inputTokens
    meter.cachedInputTokens += usage.cachedInputTokens
    meter.outputTokens += usage.outputTokens
    meter.costUsd += usage.costUsd
    // Reached only when calls cost more than they reserved.
    if (meter.costUsd > capUsd) throw capped('above')
  }
  // One queue for the whole build. After the first failure, a cap passed included, no call
  // starts, so a stopped run stops spending; calls already waiting fail with the same error.
  const queue = new PQueue({ concurrency: PARALLEL })
  let stopped: { error: unknown } | undefined
  // What the calls under way are expected to cost, held against the cap until each one ends.
  let reserved = 0
  const limited = async <R>(
    call: () => Promise<R>,
    reservation: number,
    priority = 0,
  ): Promise<R> => {
    try {
      return await queue.add(
        async () => {
          if (stopped) throw stopped.error
          if (signal?.aborted) {
            throw new EngineError(
              'The build was stopped.',
              'The lectures finished before the stop are saved. Build again to make the rest.',
            )
          }
          if (meter.costUsd + reserved + reservation > capUsd) {
            throw capped('as the next call could take it past')
          }
          reserved += reservation
          try {
            return await call()
          } finally {
            // Settled: the real cost is in the meter by now, failed calls included.
            reserved -= reservation
          }
        },
        { priority },
      )
    } catch (error) {
      stopped ??= { error }
      throw error
    }
  }
  return {
    async stop(error) {
      stopped ??= { error }
      await queue.onIdle()
    },
    async model(request, schema, priority) {
      const jsonSchema = replySchema(schema)
      const reservation = modelReservation(request, ports.model.price)
      for (let attempt = 0; attempt < 2; attempt++) {
        const reply = await limited(
          () =>
            ports.model.complete({
              ...request,
              schema: jsonSchema,
              onUsage: (usage) => {
                meter.calls++
                spend(usage)
              },
            }),
          reservation,
          priority,
        )
        const parsed = schema.safeParse(reply)
        if (parsed.success) return parsed.data
      }
      throw new EngineError(
        'The model answered twice in a form Lectern cannot read.',
        'Run the build again.',
      )
    },
    async decide(request, priority) {
      if (request.questions.length === 0) return []
      const answers = await limited(
        () => ports.decisions.decide({ ...request, onUsage: spend }),
        decisionReservation(request, ports.decisions.price),
        priority,
      )
      meter.decisions += request.questions.length
      // A missing answer counts as no verdict, never as a yes or a no.
      return request.questions.map((_, i) => answers[i] ?? { type: 'refusal' })
    },
  }
}
