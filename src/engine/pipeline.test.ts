/**
 * Offline pipeline test: a scripted fake fetch plays the Gemini side of the
 * conversation, exercising upload → mapping → generation loop → agentic
 * review loop (update/remove/add/finish_review) end to end.
 */

import { describe, expect, it } from 'vitest'

import { adoptExistingCards, runPipeline } from './pipeline'
import type { Card, PipelineEvent } from './types'

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
      model: 'gemini-3.6-flash',
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

// --- Extend runs ---------------------------------------------------------------

/** A card as it comes back from Anki at the start of an extend run. */
const inherited = (uid: string, front: string, pages: number[]): Card => ({
  uid,
  modelName: 'Basic',
  fields: { Front: front, Back: 'Answered in an earlier run.' },
  slideTopic: 'Test Topic',
  sourcePages: pages,
  conceptIds: [],
  relationKeys: [],
  qualityScore: 100,
  qualityIssues: [],
  ankiNoteId: Number(uid.replace(/\D/g, '')),
  fromAnki: true,
})

describe('adoptExistingCards', () => {
  const from = (setName: string | undefined, pages: number[]): Card => ({
    ...inherited('anki-1', 'Q?', pages),
    sourceSetName: setName,
  })

  it('keeps the pages of cards made from this document', () => {
    const result = adoptExistingCards(
      [from('ML Lecture 2', [12, 13])],
      'Machine Learning Lecture 2',
    )
    expect(result.cards[0].sourcePages).toEqual([12, 13])
    expect(result.otherDocuments).toBe(0)
  })

  it("strips the pages of another lecture's cards, but keeps the cards", () => {
    const result = adoptExistingCards([from('ML Lecture 4', [12, 13])], 'ML Lecture 2')
    expect(result.cards).toHaveLength(1)
    expect(result.cards[0].sourcePages).toEqual([])
    expect(result.cards[0].slideNumber).toBeUndefined()
    expect(result.otherDocuments).toBe(1)
  })

  it('gives a card with no recorded document the benefit of the doubt', () => {
    const result = adoptExistingCards([from(undefined, [5])], 'ML Lecture 2')
    expect(result.cards[0].sourcePages).toEqual([5])
    expect(result.otherDocuments).toBe(0)
  })

  it('leaves the caller’s array untouched', () => {
    const original = from('Other Lecture 9', [7])
    adoptExistingCards([original], 'ML Lecture 2')
    expect(original.sourcePages).toEqual([7])
  })
})

const EXTEND_SCRIPT: ScriptedTurn[] = [
  { id: 'i-map', output_text: JSON.stringify(CONCEPT_MAP) },
  // The model submits one genuinely new card and one that repeats what the
  // deck already holds, then calls it done.
  {
    id: 'i-gen',
    steps: [
      {
        type: 'function_call',
        id: 'call-submit',
        name: 'submit_cards',
        arguments: {
          cards: [
            card('Where does A apply?', 'A applies when the input is fresh.', [1], ['c-a']),
            card('What is A?', 'A is the first concept.', [1], ['c-a']),
          ],
        },
      },
      {
        type: 'function_call',
        id: 'call-finish-gen',
        name: 'finish_generation',
        arguments: { coverage_assessment: 'The gaps left by the earlier run are filled.' },
      },
    ],
  },
  // Review: reach past the one reviewable card for what would be the second
  // deck entry — an inherited card, if inherited cards had ids at all.
  {
    id: 'i-review',
    steps: [
      {
        type: 'function_call',
        id: 'call-remove',
        name: 'remove_cards',
        arguments: { card_ids: ['c2'], reason: 'looks redundant' },
      },
    ],
  },
  {
    id: 'i-finish',
    steps: [
      {
        type: 'function_call',
        id: 'call-finish',
        name: 'finish_review',
        arguments: { summary: 'Additions look sound.' },
      },
    ],
  },
]

describe('runPipeline (extend run)', () => {
  it('builds on the deck already in Anki instead of repeating it', async () => {
    const captured: CapturedInteraction[] = []
    const events: PipelineEvent[] = []
    const existing = [
      inherited('anki-1', 'What is A?', [1]),
      inherited('anki-2', 'What is B?', [2]),
    ]

    const outcome = await runPipeline({
      pdfBytes: new Uint8Array([1, 2, 3]),
      pdfInfo: { pageCount: 2, textChars: 100, imageCount: 0 },
      fileName: 'test.pdf',
      userTargetCards: 1,
      existingCards: existing,
      model: 'gemini-3.6-flash',
      apiKey: 'test-key',
      fetchFn: makeScriptedFetch(EXTEND_SCRIPT, captured),
      emit: (e) => events.push(e),
    })

    // The inherited cards are still there, and only the new card was added.
    expect(outcome.cards.slice(0, 2)).toEqual(existing)
    expect(outcome.cards).toHaveLength(3)
    expect(outcome.cards.map((c) => c.fields.Front)).toEqual([
      'What is A?',
      'What is B?',
      'Where does A apply?',
    ])

    // The repeat was caught by the dedupe set, not accepted a second time.
    const accepted = events.filter((e) => e.type === 'card_accepted')
    expect(accepted).toHaveLength(1)

    // Their pages seed the ledger before a single card is generated.
    const firstCoverage = events.find(
      (e): e is Extract<PipelineEvent, { type: 'coverage' }> => e.type === 'coverage',
    )
    expect(firstCoverage?.coverage.coveredPages).toEqual([1, 2])

    // Progress counts this run's output, not the inherited deck.
    const progress = events.filter(
      (e): e is Extract<PipelineEvent, { type: 'progress' }> => e.type === 'progress',
    )
    expect(progress.at(-1)).toMatchObject({ produced: 1, cap: 1 })

    // The generation brief names what the deck already teaches.
    const missionText = JSON.stringify(captured[1].body.input)
    expect(missionText).toContain('already holds 2 card(s)')
    expect(missionText).toContain('Test Topic (2)')

    // The review never sees the inherited cards: they are absent from the
    // listing, and no card_id resolves to one, so no tool can reach them.
    const reviewText = JSON.stringify(captured[2].body.input)
    expect(reviewText).not.toContain('What is B?')
    expect(reviewText).toContain('\\"card_id\\":\\"c1\\"')
    expect(reviewText).not.toContain('\\"card_id\\":\\"c2\\"')
    expect(reviewText).toContain('2 further card(s) from earlier runs')
    expect(JSON.stringify(captured[3].body.input)).toContain('unknown_card_id')
    expect(outcome.cards.filter((c) => c.fromAnki)).toEqual(existing)

    // The summary separates what was added from what the deck now holds.
    expect(outcome.terminationReason).toBe('coverage_sufficient_model_done')
    const done = events.find(
      (e): e is Extract<PipelineEvent, { type: 'done' }> => e.type === 'done',
    )
    expect(done?.summary).toContain('1 new cards (3 in the deck)')
  })
})

/** The inherited deck already covers every page, so breadth is spent before
 *  the run starts — the only honest budget left is depth. */
const DEPTH_SCRIPT: ScriptedTurn[] = [
  { id: 'i-map', output_text: JSON.stringify(CONCEPT_MAP) },
  // The model reads full coverage and tries to leave immediately.
  {
    id: 'i-gen-1',
    steps: [
      {
        type: 'function_call',
        id: 'call-finish-early',
        name: 'finish_generation',
        arguments: { coverage_assessment: 'Everything is already covered.' },
      },
    ],
  },
  // Turned around, it adds a card that teaches a relation instead.
  {
    id: 'i-gen-2',
    steps: [
      {
        type: 'function_call',
        id: 'call-submit',
        name: 'submit_cards',
        arguments: {
          cards: [card('How does A shape B?', 'B inherits A’s invariants.', [1, 2], ['c-b'])],
        },
      },
      {
        type: 'function_call',
        id: 'call-finish',
        name: 'finish_generation',
        arguments: { coverage_assessment: 'Added the missing relation.' },
      },
    ],
  },
  {
    id: 'i-review',
    steps: [
      {
        type: 'function_call',
        id: 'call-finish-review',
        name: 'finish_review',
        arguments: { summary: 'Sound.' },
      },
    ],
  },
]

describe('runPipeline (extend run, already covered)', () => {
  it('sends the model after depth instead of letting it finish empty-handed', async () => {
    const captured: CapturedInteraction[] = []
    const events: PipelineEvent[] = []

    const outcome = await runPipeline({
      pdfBytes: new Uint8Array([1, 2, 3]),
      pdfInfo: { pageCount: 2, textChars: 100, imageCount: 0 },
      fileName: 'test.pdf',
      userTargetCards: 1,
      existingCards: [
        inherited('anki-1', 'What is A?', [1]),
        inherited('anki-2', 'What is B?', [2]),
      ],
      model: 'gemini-3.6-flash',
      apiKey: 'test-key',
      fetchFn: makeScriptedFetch(DEPTH_SCRIPT, captured),
      emit: (e) => events.push(e),
    })

    // The mission brief names depth as the budget, not breadth.
    const missionText = JSON.stringify(captured[1].body.input)
    expect(missionText).toContain('covers the document end to end')
    expect(missionText).toContain('DEPTH LEDGER')

    // The early finish was refused, with a reason the model can act on.
    const refusal = JSON.stringify(captured[2].body.input)
    expect(refusal).toContain('your budget is for depth')
    expect(refusal).toContain('added 0 of 1 card(s)')

    // And the run ends having actually added something.
    expect(outcome.cards).toHaveLength(3)
    expect(outcome.cards.at(-1)?.fields.Front).toBe('How does A shape B?')
  })
})
