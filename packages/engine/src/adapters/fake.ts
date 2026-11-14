import type { ModelPort, ModelRequest } from '../ports.ts'

export interface ScriptedModel extends ModelPort {
  /** Every request the engine made, in order. */
  readonly requests: ModelRequest[]
}

/**
 * A model that follows a script: `reply` gets each request and returns the JSON the model
 * would have sent. No network, no cost. Token counts are rough estimates from the text length.
 */
export function scriptedModel(reply: (request: ModelRequest) => unknown): ScriptedModel {
  const requests: ModelRequest[] = []
  return {
    model: 'scripted',
    requests,
    complete(request) {
      requests.push(request)
      const data = reply(request)
      const inputTokens = Math.ceil((request.system.length + request.prompt.length) / 4)
      const outputTokens = Math.ceil(JSON.stringify(data).length / 4)
      return Promise.resolve({ data, usage: { inputTokens, outputTokens, costUsd: 0 } })
    },
  }
}
