import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { openaiDecisions, openaiModel } from '../src/adapters/openai.ts'
import { replySchema } from '../src/ask.ts'
import type { Usage } from '../src/ports.ts'

/**
 * Talks to the real API and costs a fraction of a cent, so it only runs on request:
 *   LECTERN_LIVE=1 OPENAI_API_KEY=... pnpm test
 */
describe.skipIf(!process.env.LECTERN_LIVE)('OpenAI adapters, live', () => {
  const slide =
    'Lecture 01 Risk\nSlides:\n[1] Risk (Knight 1921) / An outcome whose probability can be calculated or known'

  it('the model returns JSON that follows the schema, with usage and cost', async () => {
    const schema = z.object({ question: z.string(), answer: z.string(), extra: z.string() })
    const model = openaiModel()
    const usages: Usage[] = []
    const reply = await model.complete({
      task: 'fill',
      system: 'You fill flashcard forms. Plain text only.',
      context: slide,
      images: [],
      prompt:
        'Fill the form for one flashcard.\nConcept: risk\nFact to test: Risk is an outcome whose probability can be calculated. (slide 1)',
      schema: replySchema(schema),
      effort: 'low',
      onUsage: (usage) => usages.push(usage),
    })
    expect(schema.parse(reply).question.length).toBeGreaterThan(0)
    expect(usages[0]!.inputTokens).toBeGreaterThan(0)
    expect(usages[0]!.outputTokens).toBeGreaterThan(0)
    expect(usages[0]!.costUsd).toBeGreaterThan(0)
  }, 60_000)

  it('the decision model answers a predicate and a choice about one shared input', async () => {
    const usages: Usage[] = []
    const answers = await openaiDecisions().decide({
      onUsage: (usage) => usages.push(usage),
      context: slide,
      images: [],
      questions: [
        {
          type: 'predicate',
          statement:
            'This slide supports this flashcard. Question: What is risk? Answer: A calculable outcome.',
        },
        {
          type: 'choice',
          ask: 'What kind of slide is slide 1?',
          choices: ['title', 'agenda', 'content'],
        },
      ],
    })
    expect(answers).toHaveLength(2)
    expect(answers[0]).toMatchObject({ type: 'predicate' })
    expect(answers[1]).toMatchObject({ type: 'choice', choice: 'content' })
    expect(usages[0]!.costUsd).toBeGreaterThan(0)
  }, 60_000)
})
