import type {
  Answer,
  DecisionRequest,
  DecisionsPort,
  ModelPort,
  ModelRequest,
  Question,
} from '../ports.ts'

export interface ScriptedModel extends ModelPort {
  /** Every request the engine made, in order. */
  readonly requests: ModelRequest[]
}

/**
 * A model that follows a script: `reply` gets each request and returns, or resolves to, the
 * JSON the model would have sent. No network. Each call costs `cost` dollars, nothing by default.
 */
export function scriptedModel(
  reply: (request: ModelRequest) => unknown,
  cost: number | ((request: ModelRequest) => number) = 0,
): ScriptedModel {
  const requests: ModelRequest[] = []
  return {
    model: 'scripted',
    price: { input: 0, cachedInput: 0, output: 0, fast: 1 },
    requests,
    async complete(request) {
      requests.push(request)
      const data = await reply(request)
      const inputTokens = Math.ceil(
        (request.system.length + request.context.length + request.prompt.length) / 4,
      )
      const outputTokens = Math.ceil(JSON.stringify(data).length / 4)
      const costUsd = typeof cost === 'number' ? cost : cost(request)
      request.onUsage({ inputTokens, cachedInputTokens: 0, outputTokens, costUsd })
      return data
    },
  }
}

export interface ScriptedDecisions extends DecisionsPort {
  readonly requests: DecisionRequest[]
}

/**
 * A decision model that follows a script: `answer` gets each question with its request.
 * A question the script does not answer gets no verdict, as when the real model declines.
 */
export function scriptedDecisions(
  answer: (question: Question, request: DecisionRequest) => Answer | undefined,
): ScriptedDecisions {
  const requests: DecisionRequest[] = []
  return {
    model: 'scripted-decisions',
    price: { input: 0 },
    requests,
    decide(request) {
      requests.push(request)
      request.onUsage({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: 0 })
      return Promise.resolve(
        request.questions.map(
          (question) => answer(question, request) ?? { type: 'refusal' as const },
        ),
      )
    },
  }
}
