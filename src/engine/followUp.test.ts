/**
 * Offline follow-up test: a scripted fake fetch plays the Gemini side of a
 * post-completion "more cards" request — one add_cards batch mixing a
 * grounded card, a duplicate of the existing deck, a declared outside-source
 * card, and a gate failure, then finish_request.
 */

import { describe, expect, it } from 'vitest'

import { runFollowUp } from './followUp'
import type { Card, ConceptMap, PipelineEvent } from './types'

const CONCEPT_MAP: ConceptMap = {
  objectives: ['Understand A and B'],
  concepts: [
    {
      id: 'c-a',
      name: 'Concept A',
      importance: 'high',
      difficulty: 'foundational',
      pageReferences: [1],
    },
    {
      id: 'c-b',
      name: 'Concept B',
      importance: 'medium',
      difficulty: 'intermediate',
      pageReferences: [2],
    },
  ],
  relations: [{ source: 'c-a', type: 'relates_to', target: 'c-b', pageReferences: [1] }],
  language: 'en',
  slideSetName: 'Lecture 1 Test Set',
  pageCount: 2,
  estimatedTextChars: 100,
  documentType: 'slides',
}

const EXISTING: Card = {
  uid: 'u-existing',
  modelName: 'Basic',
  fields: { Front: 'What is A?', Back: 'A is the first concept.' },
  sourcePages: [1],
  conceptIds: ['c-a'],
  relationKeys: [],
  rationale: 'Covers a core concept.',
  sourceExcerpt: 'The slide defines A.',
  qualityScore: 100,
  qualityIssues: [],
}

const rawCard = (front: string, back: string, extra: Record<string, unknown> = {}) => ({
  model_name: 'Basic',
  fields: [
    { name: 'Front', value: front },
    { name: 'Back', value: back },
  ],
  slide_topic: 'Test Topic',
  slide_number: 2,
  source_pages: [2],
  concept_ids: ['c-b'],
  relation_keys: [],
  rationale: 'Requested by the user.',
  source_excerpt: 'The slide describes B.',
  ...extra,
})

const SCRIPT = [
  {
    id: 'f-add',
    steps: [
      {
        type: 'function_call',
        id: 'call-add',
        name: 'add_cards',
        arguments: {
          cards: [
            rawCard('How does B extend A?', 'B builds on the invariants of A.'),
            // Duplicate of the existing deck card — dropped, not rejected.
            rawCard('What is A?', 'A restated.'),
            // Declared outside the document: relaxed gate, flagged.
            rawCard('Who formulated the categorical imperative?', 'Immanuel Kant.', {
              in_source: false,
              source_pages: [],
              concept_ids: [],
              source_excerpt: 'General philosophy knowledge, not in the slides.',
            }),
            // Gate failure: no rationale.
            rawCard('What color is B?', 'Blue.', { rationale: '' }),
          ],
        },
      },
    ],
  },
  {
    id: 'f-finish',
    steps: [
      {
        type: 'function_call',
        id: 'call-finish',
        name: 'finish_request',
        arguments: { summary: 'Added two cards, one outside the source.' },
      },
    ],
  },
]

interface CapturedInteraction {
  body: Record<string, unknown>
}

function makeScriptedFetch(captured: CapturedInteraction[]): typeof fetch {
  const turns = [...SCRIPT]
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (!url.includes('/v1beta/interactions')) throw new Error(`unexpected fetch: ${url}`)
    captured.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    const turn = turns.shift()
    if (!turn) throw new Error('scripted fetch exhausted')
    return new Response(
      JSON.stringify({
        id: turn.id,
        steps: turn.steps,
        usage: { total_input_tokens: 100, total_output_tokens: 50, total_thought_tokens: 10 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

describe('runFollowUp (scripted)', () => {
  it('adds requested cards additions-only: dedupes, gates, and flags outside-source', async () => {
    const captured: CapturedInteraction[] = []
    const events: PipelineEvent[] = []
    const deck = [EXISTING]

    const outcome = await runFollowUp({
      request: 'add cards on B and on Kant',
      deck,
      conceptMap: CONCEPT_MAP,
      seed: {
        interactionId: 'i-review',
        pendingInput: [
          {
            type: 'function_result',
            name: 'finish_review',
            call_id: 'call-finish-review',
            result: [{ type: 'text', text: 'Review complete.' }],
          },
        ],
      },
      model: 'gemini-3.5-flash',
      apiKey: 'test-key',
      fetchFn: makeScriptedFetch(captured),
      emit: (e) => events.push(e),
    })

    // Additions only: the deck snapshot is untouched, two cards came through.
    expect(deck).toHaveLength(1)
    expect(deck[0]).toBe(EXISTING)
    expect(outcome.added).toHaveLength(2)
    expect(outcome.note).toBe('Added two cards, one outside the source.')

    const grounded = outcome.added.find((c) => c.fields.Front === 'How does B extend A?')
    expect(grounded?.outsideSource).toBeUndefined()
    expect(grounded?.syncExcluded).toBeUndefined()

    // The outside-source card passes the relaxed gate, flagged and excluded
    // from the Anki send by default.
    const outside = outcome.added.find((c) => c.fields.Front?.includes('categorical imperative'))
    expect(outcome.outsideSourceCount).toBe(1)
    expect(outside?.outsideSource).toBe(true)
    expect(outside?.syncExcluded).toBe(true)
    expect(outside?.qualityIssues).toContain('outside_source')

    // The duplicate was dropped silently; the ungrounded card was rejected.
    const accepted = events.filter((e) => e.type === 'card_accepted')
    const rejected = events.filter(
      (e): e is Extract<PipelineEvent, { type: 'card_rejected' }> => e.type === 'card_rejected',
    )
    expect(accepted).toHaveLength(2)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reasons).toContain('missing_rationale')

    // The request chains off the pipeline's last interaction and leads with
    // its pending function results before the mission text.
    expect(captured[0].body.previous_interaction_id).toBe('i-review')
    const firstInput = captured[0].body.input as Array<Record<string, unknown>>
    expect(firstInput[0].type).toBe('function_result')
    expect(firstInput[0].call_id).toBe('call-finish-review')
    const mission = String((firstInput[1] as { text: string }).text)
    expect(mission).toContain('add cards on B and on Kant')
    expect(mission).toContain('What is A?') // existing deck listed for dedupe

    // The add_cards verdict reports the silent duplicate drop.
    const secondInput = captured[1].body.input as Array<Record<string, unknown>>
    const feedback = JSON.stringify(secondInput.find((p) => p.type === 'function_result')?.result)
    expect(feedback).toContain('Accepted 2 card(s)')
    expect(feedback).toContain('Duplicates dropped: 1')

    // The outcome seed continues the chain: finish_request is answered.
    expect(outcome.seed.interactionId).toBe('f-finish')
    expect(outcome.seed.pendingInput).toHaveLength(1)
    expect(outcome.seed.pendingInput[0]).toMatchObject({
      type: 'function_result',
      call_id: 'call-finish',
    })

    expect(outcome.usage.inputTokens).toBe(200)
    expect(outcome.usage.outputTokens).toBe(120)
  })
})
