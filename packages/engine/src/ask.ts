/**
 * The engine's two ways to spend money, wrapped once: every model call and every decision
 * request is metered here, and the run stops when the real cost passes the cap.
 */

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

export type AskModel = <S extends z.ZodType>(
  request: Omit<ModelRequest, 'schema' | 'onUsage'>,
  schema: S,
) => Promise<z.infer<S>>
export type Decide = (request: Omit<DecisionRequest, 'onUsage'>) => Promise<Answer[]>

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
): { model: AskModel; decide: Decide } {
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
  return {
    async model(request, schema) {
      const jsonSchema = replySchema(schema)
      for (let attempt = 0; attempt < 2; attempt++) {
        const reply = await ports.model.complete({
          ...request,
          schema: jsonSchema,
          onUsage: (usage) => {
            meter.calls++
            spend(usage)
          },
        })
        const parsed = schema.safeParse(reply)
        if (parsed.success) return parsed.data
      }
      throw new EngineError(
        'The model answered twice in a form Lectern cannot read.',
        'Run the build again.',
      )
    },
    async decide(request) {
      if (request.questions.length === 0) return []
      const answers = await ports.decisions.decide({ ...request, onUsage: spend })
      meter.decisions += request.questions.length
      // A missing answer counts as no verdict, never as a yes or a no.
      return request.questions.map((_, i) => answers[i] ?? { type: 'refusal' })
    },
  }
}
