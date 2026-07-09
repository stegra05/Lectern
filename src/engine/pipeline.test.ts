/**
 * Offline pipeline test: a scripted fake fetch plays the Gemini side of the
 * conversation, exercising upload → mapping → generation loop → agentic
 * review loop (update/remove/add/finish_review) end to end.
 */

import { describe, expect, it } from 'vitest'

import { runPipeline } from './pipeline'
import type { PipelineEvent } from './types'

// --- Scripted Gemini ---------------------------------------------------------

const CONCEPT_MAP = {
  objectives: ['Understand A and B'],
  concepts: [
    {
      id: 'c-a',
      name: 'Concept A',
      importance: 'high',
      difficulty: 'foundational',
      page_references: [1],
    },
    {
      id: 'c-b',
      name: 'Concept B',
      importance: 'medium',
      difficulty: 'intermediate',
      page_references: [2],
    },
  ],
  relations: [{ source: 'c-a', type: 'relates_to', target: 'c-b', page_references: [1] }],
  language: 'en',
  slide_set_name: 'Lecture 1 Test Set',
  page_count: 2,
  estimated_text_chars: 100,
  document_type: 'slides',
}

const card = (front: string, back: string, pages: number[], conceptIds: string[]) => ({
  model_name: 'Basic',
  fields: [
    { name: 'Front', value: front },
    { name: 'Back', value: back },
  ],
  slide_topic: 'Test Topic',
  slide_number: pages[0],
  source_pages: pages,
  concept_ids: conceptIds,
  relation_keys: [],
  rationale: 'Covers a core concept.',
  source_excerpt: 'The slide defines this concept in detail.',
})

const GENERATED_CARDS = [
  card('What is A?', 'A is the first concept.', [1], ['c-a']),
  card('What is B?', 'B is the second concept.', [2], ['c-b']),
  card('Compare A and B.', 'A is foundational, B builds on it.', [1, 2], ['c-a', 'c-b']),
  card('Where does A apply?', 'A applies when the input is fresh.', [1], ['c-a']),
]

interface ScriptedTurn {
  id: string
  steps?: Array<Record<string, unknown>>
  output_text?: string
}

const interactionResponse = (turn: ScriptedTurn): Record<string, unknown> => ({
  id: turn.id,
  steps: turn.steps ?? [],
  output_text: turn.output_text,
  usage: { total_input_tokens: 100, total_output_tokens: 50, total_thought_tokens: 10 },
})

const SCRIPT: ScriptedTurn[] = [
  // 1 — mapping: structured concept map.
  { id: 'i-map', output_text: JSON.stringify(CONCEPT_MAP) },
  // 2 — generation: one submit_cards batch that exactly fills the cap.
  {
    id: 'i-gen',
    steps: [
      {
        type: 'function_call',
        id: 'call-submit',
        name: 'submit_cards',
        arguments: { cards: GENERATED_CARDS },
      },
    ],
  },
  // 3 — review: edit the deck (rewrite c1, drop c2, add one gap-filler).
  {
    id: 'i-review',
    steps: [
      {
        type: 'function_call',
        id: 'call-update',
        name: 'update_card',
        arguments: {
          card_id: 'c1',
          card: card('What defines concept A?', 'A is defined by its invariants.', [1], ['c-a']),
        },
      },
      {
        type: 'function_call',
        id: 'call-remove',
        name: 'remove_cards',
        arguments: { card_ids: ['c2'], reason: 'redundant with the comparison card' },
      },
      {
        type: 'function_call',
        id: 'call-add',
        name: 'add_cards',
        arguments: {
          cards: [card('Why does A precede B?', 'B builds on the invariants of A.', [2], ['c-b'])],
        },
      },
    ],
  },
  // 4 — review wrap-up.
  {
    id: 'i-finish',
    steps: [
      {
        type: 'function_call',
        id: 'call-finish',
        name: 'finish_review',
        arguments: { summary: 'Deck is sound.' },
      },
    ],
  },
]

interface CapturedInteraction {
  body: Record<string, unknown>
  headers: Record<string, string>
}

function makeScriptedFetch(script: ScriptedTurn[], captured: CapturedInteraction[]): typeof fetch {
  const turns = [...script]
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const json = (body: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...headers },
      })

    if (url.includes('/upload/v1beta/files') && !url.includes('upload-session')) {
      return json({}, { 'x-goog-upload-url': 'https://gemini.test/upload-session' })
    }
    if (url.includes('upload-session')) {
      return json({
        file: {
          name: 'files/test',
          uri: 'https://gemini.test/files/test',
          mime_type: 'application/pdf',
          state: 'ACTIVE',
        },
      })
    }
    if (url.includes('/v1beta/interactions')) {
      captured.push({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        headers: Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>),
        ),
      })
      const turn = turns.shift()
      if (!turn) throw new Error('scripted fetch exhausted')
      return json(interactionResponse(turn))
    }
    throw new Error(`unexpected fetch: ${url}`)
  }
}

// --- The test ----------------------------------------------------------------

describe('runPipeline (scripted)', () => {
  it('runs mapping, generation, and the agentic review loop end to end', async () => {
    const captured: CapturedInteraction[] = []
    const events: PipelineEvent[] = []

    const outcome = await runPipeline({
      pdfBytes: new Uint8Array([1, 2, 3]),
      pdfInfo: { pageCount: 2, textChars: 100, imageCount: 0 },
      fileName: 'test.pdf',
      userTargetCards: 4,
      model: 'gemini-3.5-flash',
      apiKey: 'test-key',
      fetchFn: makeScriptedFetch(SCRIPT, captured),
      emit: (e) => events.push(e),
    })

    // Generation filled the cap, review then reshaped the deck: 4 − 1 + 1 = 4.
    expect(outcome.terminationReason).toBe('max_cap_reached')
    expect(outcome.cards).toHaveLength(4)

    const fronts = outcome.cards.map((c) => c.fields.Front)
    expect(fronts).toContain('What defines concept A?') // updated in place
    expect(fronts).not.toContain('What is A?') // old content replaced
    expect(fronts).not.toContain('What is B?') // removed
    expect(fronts).toContain('Why does A precede B?') // added

    // update_card keeps the card's identity.
    const updated = outcome.cards.find((c) => c.fields.Front === 'What defines concept A?')
    const originalAccepted = events.find(
      (e): e is Extract<PipelineEvent, { type: 'card_accepted' }> =>
        e.type === 'card_accepted' && e.card.fields.Front === 'What is A?',
    )
    expect(updated?.uid).toBe(originalAccepted?.card.uid)

    // The review outcome reaches the UI as one cards_replaced with the note.
    const replaced = events.find(
      (e): e is Extract<PipelineEvent, { type: 'cards_replaced' }> => e.type === 'cards_replaced',
    )
    expect(replaced?.cards).toHaveLength(4)
    expect(replaced?.reflectionNote).toBe('Deck is sound.')

    // Wire protocol: four interactions with the pinned API revision.
    expect(captured).toHaveLength(4)
    for (const c of captured) expect(c.headers['Api-Revision']).toBe('2026-05-20')

    // Thinking levels per phase: mapping high, generating low, reflecting medium.
    const levelOf = (i: number) =>
      (captured[i].body.generation_config as Record<string, unknown>).thinking_level
    expect(levelOf(0)).toBe('high')
    expect(levelOf(1)).toBe('low')
    expect(levelOf(2)).toBe('medium')

    // The review turn answers the dangling submit_cards call before the mission.
    const reviewInput = captured[2].body.input as Array<Record<string, unknown>>
    expect(reviewInput[0].type).toBe('function_result')
    expect(reviewInput[0].call_id).toBe('call-submit')
    expect(String((reviewInput[1] as { text: string }).text)).toContain('Deck under review')

    // The finished pipeline hands over a clean continuation seed: the last
    // interaction id, with the dangling finish_review call answered.
    expect(outcome.followUp.interactionId).toBe('i-finish')
    expect(outcome.followUp.pendingInput).toMatchObject([
      { type: 'function_result', call_id: 'call-finish' },
    ])

    // Edit verdicts flow back as one function_result per tool call.
    const finishInput = captured[3].body.input as Array<Record<string, unknown>>
    const resultTexts = finishInput
      .filter((p) => p.type === 'function_result')
      .map((p) => JSON.stringify(p.result))
    expect(resultTexts.some((t) => t.includes('updated c1'))).toBe(true)
    expect(resultTexts.some((t) => t.includes('removed c2'))).toBe(true)
    expect(resultTexts.some((t) => t.includes('added c5'))).toBe(true)
  })
})
