import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { anthropicModel } from '../src/adapters/anthropic.ts'
import { replySchema } from '../src/prompts.ts'

/**
 * Talks to the real API and costs a fraction of a cent, so it only runs on request:
 *   LECTERN_LIVE=1 ANTHROPIC_API_KEY=... pnpm test
 */
describe.skipIf(!process.env.LECTERN_LIVE)('Anthropic adapter, live', () => {
  it('returns JSON that follows the schema, with usage and cost', async () => {
    const schema = z.object({
      cards: z.array(z.object({ front: z.string(), answers: z.array(z.string()) })),
    })
    const model = anthropicModel()
    const reply = await model.complete({
      task: 'write',
      system: 'You fill flashcard slots. Plain text only.',
      prompt:
        'Slide: "Risk (Knight 1921): an outcome whose probability can be calculated." Write one card.',
      schema: replySchema(schema),
    })
    const data = schema.parse(reply.data)
    expect(data.cards.length).toBeGreaterThan(0)
    expect(reply.usage.inputTokens).toBeGreaterThan(0)
    expect(reply.usage.outputTokens).toBeGreaterThan(0)
    expect(reply.usage.costUsd).toBeGreaterThan(0)
    expect(model.model).toBe('claude-haiku-5-5')
  }, 60_000)
})
