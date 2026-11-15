import { describe, expect, it } from 'vitest'
import { openaiDecisions, openaiModel } from '../src/adapters/openai.ts'
import { EngineError } from '../src/api.ts'

/** Nothing listens at this address, so a call fails at once and without a retry. */
const nowhere = { apiKey: 'test', baseURL: 'http://127.0.0.1:1', maxRetries: 0 }
const unreachable = new EngineError(
  'OpenAI could not be reached.',
  'Check the internet connection and build again.',
)
const onUsage = () => undefined

describe('the OpenAI adapters when OpenAI cannot be reached', () => {
  it('turn a failed connection into an error that names the fix', async () => {
    await expect(
      openaiModel(undefined, nowhere).complete({
        task: 'fill',
        system: '',
        context: '',
        images: [],
        prompt: '',
        schema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
        effort: 'low',
        onUsage,
      }),
    ).rejects.toEqual(unreachable)
    await expect(
      openaiDecisions(nowhere).decide({
        context: '',
        images: [],
        questions: [{ type: 'predicate', statement: 'Is it?' }],
        onUsage,
      }),
    ).rejects.toEqual(unreachable)
  })
})
