import Anthropic from '@anthropic-ai/sdk'
import { EngineError } from '../errors.ts'
import type { ModelPort } from '../ports.ts'

const MODEL = 'claude-haiku-5-5'
const MAX_TOKENS = 32000

/** Dollars per million tokens. The long card prices the whole request above 100k prompt tokens. */
const PRICE = {
  short: { input: 0.1, output: 0.5 },
  long: { input: 0.5, output: 2.5 },
  longFrom: 100_000,
}

/**
 * Claude Haiku 5.5 through the Messages API. The reply is held to the JSON schema by the API
 * itself (structured output), so no tool call and no text parsing tricks are needed.
 * Credentials come from the environment (`ANTHROPIC_API_KEY`) unless a key is passed.
 */
export function anthropicModel(options: { apiKey?: string } = {}): ModelPort {
  let client: Anthropic | undefined
  return {
    model: MODEL,
    async complete(request) {
      client ??= new Anthropic(options)
      const message = await client.messages
        .stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: request.system,
          messages: [{ role: 'user', content: request.prompt }],
          output_config: {
            effort: 'medium',
            format: { type: 'json_schema', schema: request.schema },
          },
        })
        .finalMessage()
        .catch((error: unknown) => {
          throw explain(error)
        })

      if (message.stop_reason === 'refusal') {
        throw new EngineError(
          'The model declined to work on these slides.',
          'Try the build again, or leave this lecture out.',
        )
      }
      if (message.stop_reason === 'max_tokens') {
        throw new EngineError(
          'The model ran out of room before it finished.',
          'Split the lecture into smaller PDFs.',
        )
      }
      // Thinking blocks may come first, so the answer is found by type, not by position.
      const text = message.content.find((block) => block.type === 'text')?.text ?? ''
      const u = message.usage
      const inputTokens =
        u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
      const price = inputTokens > PRICE.longFrom ? PRICE.long : PRICE.short
      return {
        data: JSON.parse(text) as unknown,
        usage: {
          inputTokens,
          outputTokens: u.output_tokens,
          costUsd: (inputTokens * price.input + u.output_tokens * price.output) / 1_000_000,
        },
      }
    },
  }
}

function explain(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) {
    return new EngineError('Anthropic rejected the API key.', 'Check the key in ANTHROPIC_API_KEY.')
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new EngineError(
      'Anthropic is limiting requests for this key.',
      'Wait a minute and build again.',
    )
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new EngineError(
      'Anthropic could not be reached.',
      'Check the internet connection and build again.',
    )
  }
  if (error instanceof Anthropic.APIError) {
    return new EngineError(
      `Anthropic answered with an error: ${error.message}`,
      'Build again in a few minutes.',
    )
  }
  return error instanceof Error ? error : new Error(String(error))
}
