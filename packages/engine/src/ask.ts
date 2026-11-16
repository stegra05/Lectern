/**
 * The engine's two ways to spend money, wrapped once: every model call and every decision
 * request is metered and limited here, and the run stops when the real cost passes the cap.
 */

import PQueue from 'p-queue'
import { z } from 'zod'
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
): {
  model: AskModel
  decide: Decide
  /** Stops new calls after a failure outside a call, and waits for the calls still running. */
  stop: (error: unknown) => Promise<void>
} {
  const spend = (usage: Usage) => {
    meter.inputTokens += usage.inputTokens
    meter.cachedInputTokens += usage.cachedInputTokens
    meter.outputTokens += usage.outputTokens
    meter.costUsd += usage.costUsd
    if (meter.costUsd > capUsd) {
      throw new EngineError(
        `The run was stopped at ${meter.costUsd.toFixed(2)} dollars, above its cap of ${capUsd.toFixed(2)} dollars.`,
        'The lectures finished before the stop are saved. Build again to make the rest.',
      )
    }
  }
  // One queue for the whole build. After the first failure, a cap passed included, no call
  // starts, so a stopped run stops spending; calls already waiting fail with the same error.
  const queue = new PQueue({ concurrency: PARALLEL })
  let stopped: { error: unknown } | undefined
  const limited = async <R>(call: () => Promise<R>, priority = 0): Promise<R> => {
    try {
      return await queue.add(
        () => {
          if (stopped) throw stopped.error
          return call()
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
        priority,
      )
      meter.decisions += request.questions.length
      // A missing answer counts as no verdict, never as a yes or a no.
      return request.questions.map((_, i) => answers[i] ?? { type: 'refusal' })
    },
  }
}
