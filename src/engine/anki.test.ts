import { describe, expect, it, vi } from 'vitest'

import {
  AnkiApiError,
  AnkiClient,
  AnkiTransportError,
  cardToNote,
  checkConnection,
  previewSync,
  resolveModelNames,
  syncCards,
} from './anki'
import type { Card, Settings, SyncProgress } from './types'

const BASE_URL = 'http://localhost:8765'

// --- Mock fetch harness ------------------------------------------------------

interface Envelope {
  action: string
  version: number
  params?: Record<string, unknown>
}

type MockReply =
  | { result: unknown }
  | { apiError: string }
  | { networkError: string }
  | { httpStatus: number }
  | { rawBody: string }

type MockHandler = (
  action: string,
  params: Record<string, unknown> | undefined,
  callIndex: number,
) => MockReply

interface MockFetch {
  fetchFn: typeof fetch
  calls: Envelope[]
  requests: { url: string; method?: string }[]
}

function makeFetch(handler: MockHandler): MockFetch {
  const calls: Envelope[] = []
  const requests: { url: string; method?: string }[] = []
  const fetchFn: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method })
    const envelope = JSON.parse(String(init?.body)) as Envelope
    calls.push(envelope)
    const reply = handler(envelope.action, envelope.params, calls.length - 1)
    if ('networkError' in reply) throw new TypeError(reply.networkError)
    if ('httpStatus' in reply) return new Response('boom', { status: reply.httpStatus })
    if ('rawBody' in reply) return new Response(reply.rawBody, { status: 200 })
    if ('apiError' in reply) {
      return new Response(JSON.stringify({ result: null, error: reply.apiError }), {
        status: 200,
      })
    }
    return new Response(JSON.stringify({ result: reply.result, error: null }), {
      status: 200,
    })
  }
  return { fetchFn, calls, requests }
}

/** Dispatch by action; `nth` counts calls per action (0-based). */
function routes(
  table: Record<string, (params: Record<string, unknown> | undefined, nth: number) => MockReply>,
): MockHandler {
  const counts = new Map<string, number>()
  return (action, params) => {
    const route = table[action]
    if (!route) return { apiError: `unrouted action in test: ${action}` }
    const nth = counts.get(action) ?? 0
    counts.set(action, nth + 1)
    return route(params, nth)
  }
}

const makeClient = (fetchFn: typeof fetch): AnkiClient =>
  new AnkiClient(BASE_URL, fetchFn, { initialRetryDelayMs: 0 })

// --- Fixtures ------------------------------------------------------------------

const makeSettings = (overrides: Partial<Settings> = {}): Settings => ({
  model: 'gemini-3.5-flash',
  ankiUrl: BASE_URL,
  basicModelName: 'Basic',
  clozeModelName: 'Cloze',
  tagTemplate: '{{deck}}::{{slide_set}}::{{topic}}',
  defaultTag: 'lectern',
  enableDefaultTag: true,
  ...overrides,
})

const makeCard = (overrides: Partial<Card> = {}): Card => ({
  uid: 'card-1',
  modelName: 'Basic',
  fields: { Front: 'What is X?', Back: 'X is Y.' },
  sourcePages: [1],
  conceptIds: [],
  relationKeys: [],
  qualityScore: 80,
  qualityIssues: [],
  ...overrides,
})

const tagsFor = (): string[] => ['lectern', 'bio']

// --- Envelope shape ---------------------------------------------------------------

describe('AnkiClient envelope', () => {
  it('POSTs {action, version: 6, params} to the base URL', async () => {
    const { fetchFn, calls, requests } = makeFetch(() => ({ result: ['Front', 'Back'] }))
    const client = makeClient(fetchFn)

    await expect(client.modelFieldNames('Basic')).resolves.toEqual(['Front', 'Back'])

    expect(requests[0]).toEqual({ url: BASE_URL, method: 'POST' })
    expect(calls[0]).toEqual({
      action: 'modelFieldNames',
      version: 6,
      params: { modelName: 'Basic' },
    })
  })

  it('omits params entirely for parameterless actions', async () => {
    const { fetchFn, calls } = makeFetch(() => ({ result: [] }))
    const client = makeClient(fetchFn)

    await client.deckNames()

    expect(calls[0]).toEqual({ action: 'deckNames', version: 6 })
    expect('params' in calls[0]).toBe(false)
  })

  it('wraps addNote / updateNoteFields / deleteNotes params like the Python wrapper', async () => {
    const { fetchFn, calls } = makeFetch(
      routes({
        addNote: () => ({ result: 1501 }),
        updateNoteFields: () => ({ result: null }),
        deleteNotes: () => ({ result: null }),
      }),
    )
    const client = makeClient(fetchFn)
    const note = cardToNote(makeCard(), {
      deckName: 'Deck',
      modelName: 'Basic',
      tags: ['t'],
    })

    await expect(client.addNote(note)).resolves.toBe(1501)
    await client.updateNoteFields(1501, { Front: 'Q2' })
    await client.deleteNotes([1501, 1502])

    expect(calls[0].params).toEqual({ note })
    expect(calls[1].params).toEqual({ note: { id: 1501, fields: { Front: 'Q2' } } })
    expect(calls[2].params).toEqual({ notes: [1501, 1502] })
  })
})

// --- Result unwrapping and error taxonomy -----------------------------------------

describe('AnkiClient errors and retry', () => {
  it('unwraps {result, error: null}', async () => {
    const { fetchFn } = makeFetch(() => ({ result: ['Uni::Bio', 'Default'] }))
    const client = makeClient(fetchFn)

    await expect(client.deckNames()).resolves.toEqual(['Uni::Bio', 'Default'])
  })

  it('fails fast on API errors (no retry)', async () => {
    const { fetchFn, calls } = makeFetch(() => ({ apiError: 'deck was not found' }))
    const client = makeClient(fetchFn)

    const err = await client.deckNames().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AnkiApiError)
    expect((err as AnkiApiError).message).toContain('deckNames')
    expect((err as AnkiApiError).message).toContain('deck was not found')
    expect(calls).toHaveLength(1)
  })

  it('retries transport errors and recovers', async () => {
    const { fetchFn, calls } = makeFetch((_action, _params, callIndex) =>
      callIndex < 2 ? { networkError: 'fetch failed' } : { result: ['Default'] },
    )
    const client = makeClient(fetchFn)

    await expect(client.deckNames()).resolves.toEqual(['Default'])
    expect(calls).toHaveLength(3)
  })

  it('gives up after 3 retries (4 attempts) and throws AnkiTransportError', async () => {
    const { fetchFn, calls } = makeFetch(() => ({ networkError: 'connection refused' }))
    const client = makeClient(fetchFn)

    const err = await client.deckNames().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AnkiTransportError)
    expect((err as AnkiTransportError).message).toContain(BASE_URL)
    expect(calls).toHaveLength(4)
  })

  it('treats HTTP error statuses as transport errors (retried)', async () => {
    const { fetchFn, calls } = makeFetch((_action, _params, callIndex) =>
      callIndex === 0 ? { httpStatus: 500 } : { result: [] },
    )
    const client = makeClient(fetchFn)

    await expect(client.deckNames()).resolves.toEqual([])
    expect(calls).toHaveLength(2)
  })

  it('treats non-JSON bodies as transport errors', async () => {
    const { fetchFn } = makeFetch(() => ({ rawBody: '<html>not json</html>' }))
    const client = makeClient(fetchFn)

    await expect(client.deckNames()).rejects.toBeInstanceOf(AnkiTransportError)
  })

  it('version() is a single probe — no retry on transport failure', async () => {
    const { fetchFn, calls } = makeFetch(() => ({ networkError: 'refused' }))
    const client = makeClient(fetchFn)

    await expect(client.version()).rejects.toBeInstanceOf(AnkiTransportError)
    expect(calls).toHaveLength(1)
  })
})

// --- checkConnection ------------------------------------------------------------

describe('checkConnection', () => {
  it('reports ok with the version', async () => {
    const { fetchFn } = makeFetch(() => ({ result: 6 }))

    await expect(checkConnection(makeClient(fetchFn))).resolves.toEqual({
      ok: true,
      version: 6,
    })
  })

  it('rejects versions below the minimum', async () => {
    const { fetchFn } = makeFetch(() => ({ result: 5 }))

    const status = await checkConnection(makeClient(fetchFn))
    expect(status.ok).toBe(false)
    expect(status.version).toBe(5)
    expect(status.error).toContain('too old')
  })

  it('reports the transport error when Anki is unreachable', async () => {
    const { fetchFn } = makeFetch(() => ({ networkError: 'connection refused' }))

    const status = await checkConnection(makeClient(fetchFn))
    expect(status.ok).toBe(false)
    expect(status.version).toBeUndefined()
    expect(status.error).toContain('Failed to reach AnkiConnect')
  })
})

// --- resolveModelNames ------------------------------------------------------------

describe('resolveModelNames', () => {
  it('prefers configured names when they exist (no field lookups)', async () => {
    const { fetchFn, calls } = makeFetch(
      routes({ modelNames: () => ({ result: ['Basic', 'Cloze', 'Einfach'] }) }),
    )

    const resolved = await resolveModelNames(makeClient(fetchFn), makeSettings())

    expect(resolved).toEqual({ basic: 'Basic', cloze: 'Cloze' })
    expect(calls.some((c) => c.action === 'modelFieldNames')).toBe(false)
  })

  it('detects localized built-ins by field signature (German Einfach/Lückentext)', async () => {
    const fieldsByModel: Record<string, string[]> = {
      Einfach: ['Vorderseite', 'Rückseite'],
      Lückentext: ['Text', 'Extra'],
      Geographie: ['Land', 'Hauptstadt'],
    }
    const { fetchFn } = makeFetch(
      routes({
        modelNames: () => ({ result: Object.keys(fieldsByModel) }),
        modelFieldNames: (params) => ({
          result: fieldsByModel[String(params?.modelName)] ?? [],
        }),
      }),
    )

    const resolved = await resolveModelNames(makeClient(fetchFn), makeSettings())

    expect(resolved).toEqual({ basic: 'Einfach', cloze: 'Lückentext' })
  })

  it('prefers the canonical Basic model over other signature matches', async () => {
    const fieldsByModel: Record<string, string[]> = {
      MyBasic: ['Front', 'Back', 'Source'],
      Basic: ['Front', 'Back'],
    }
    const { fetchFn } = makeFetch(
      routes({
        modelNames: () => ({ result: Object.keys(fieldsByModel) }),
        modelFieldNames: (params) => ({
          result: fieldsByModel[String(params?.modelName)] ?? [],
        }),
      }),
    )
    const settings = makeSettings({ basicModelName: 'Grundlagen', clozeModelName: 'Lücke' })

    const resolved = await resolveModelNames(makeClient(fetchFn), settings)

    expect(resolved.basic).toBe('Basic')
    // Nothing cloze-shaped exists → absolute fallback.
    expect(resolved.cloze).toBe('Cloze')
  })

  it('falls back to Basic/Cloze when nothing matches', async () => {
    const { fetchFn } = makeFetch(
      routes({
        modelNames: () => ({ result: ['Vocab'] }),
        modelFieldNames: () => ({ result: ['Word', 'Definition'] }),
      }),
    )
    const settings = makeSettings({ basicModelName: 'Missing', clozeModelName: 'AlsoMissing' })

    await expect(resolveModelNames(makeClient(fetchFn), settings)).resolves.toEqual({
      basic: 'Basic',
      cloze: 'Cloze',
    })
  })

  it('passes configured names through when Anki is unreachable', async () => {
    const { fetchFn } = makeFetch(() => ({ networkError: 'refused' }))
    const client = makeClient(fetchFn)
    const settings = makeSettings({ basicModelName: 'Einfach', clozeModelName: 'Lückentext' })

    await expect(resolveModelNames(client, settings)).resolves.toEqual({
      basic: 'Einfach',
      cloze: 'Lückentext',
    })
  })

  it('resolves fresh on every call, so note-type changes in Anki are picked up', async () => {
    const modelSets = [['Vocab'], ['Vocab', 'Basic', 'Cloze']]
    const { fetchFn, calls } = makeFetch(
      routes({
        modelNames: (_params, nth) => ({ result: modelSets[Math.min(nth, 1)] }),
        modelFieldNames: () => ({ result: ['Word', 'Definition'] }),
      }),
    )
    const client = makeClient(fetchFn)

    await resolveModelNames(client, makeSettings())
    const callsAfterFirst = calls.length

    // The collection gained real Basic/Cloze models; a second resolution sees them.
    await expect(resolveModelNames(client, makeSettings())).resolves.toEqual({
      basic: 'Basic',
      cloze: 'Cloze',
    })
    expect(calls.length).toBeGreaterThan(callsAfterFirst)
  })
})

// --- cardToNote ------------------------------------------------------------------

describe('cardToNote', () => {
  it('maps Basic cards to Front/Back and preserves extra fields', () => {
    const card = makeCard({
      fields: { Front: 'What is ATP?', Back: 'Energy currency.', Source: 'p. 12' },
    })

    const note = cardToNote(card, {
      deckName: 'Uni::Bio',
      modelName: 'Einfach',
      tags: ['lectern', 'bio'],
    })

    expect(note).toEqual({
      deckName: 'Uni::Bio',
      modelName: 'Einfach',
      fields: { Front: 'What is ATP?', Back: 'Energy currency.', Source: 'p. 12' },
      tags: ['lectern', 'bio'],
      options: { allowDuplicate: false },
    })
  })

  it('maps Cloze cards to Text / Back Extra', () => {
    const card = makeCard({
      modelName: 'Cloze',
      fields: { Text: '{{c1::ATP}} is the energy currency.', 'Back Extra': 'See p. 12' },
    })

    const note = cardToNote(card, { deckName: 'D', modelName: 'Cloze', tags: [] })

    expect(note.fields).toEqual({
      Text: '{{c1::ATP}} is the energy currency.',
      'Back Extra': 'See p. 12',
    })
    expect(note.options).toEqual({ allowDuplicate: false })
  })

  it('recovers Cloze content stored under Front/Back', () => {
    const card = makeCard({
      modelName: 'Cloze',
      fields: { Front: '{{c1::Mitochondria}} produce ATP.', Back: 'Cell biology' },
    })

    const note = cardToNote(card, { deckName: 'D', modelName: 'Cloze', tags: [] })

    expect(note.fields).toEqual({
      Text: '{{c1::Mitochondria}} produce ATP.',
      'Back Extra': 'Cell biology',
    })
  })
})

// --- previewSync ------------------------------------------------------------------

describe('previewSync', () => {
  it('counts updates (ankiNoteId set), creates, and duplicates via canAddNotes', async () => {
    const cards: Card[] = [
      makeCard({ uid: 'u1', ankiNoteId: 111 }),
      makeCard({ uid: 'u2', fields: { Front: 'Q2', Back: 'A2' } }),
      makeCard({ uid: 'u3', modelName: 'Cloze', fields: { Text: '{{c1::dup}}' } }),
    ]
    let canAddNotesParams: Record<string, unknown> | undefined
    const { fetchFn } = makeFetch(
      routes({
        modelNames: () => ({ result: ['Basic', 'Cloze'] }),
        deckNames: () => ({ result: ['Default', 'Uni::Bio'] }),
        canAddNotes: (params) => {
          canAddNotesParams = params
          return { result: [true, false] }
        },
      }),
    )

    const preview = await previewSync(
      makeClient(fetchFn),
      cards,
      'Uni::Bio',
      makeSettings(),
      tagsFor,
    )

    expect(preview).toEqual({ toCreate: 2, toUpdate: 1, duplicates: 1 })
    const notes = canAddNotesParams?.notes as {
      deckName: string
      modelName: string
      tags: string[]
      options: { allowDuplicate: boolean }
    }[]
    expect(notes).toHaveLength(2)
    expect(notes[0]).toMatchObject({
      deckName: 'Uni::Bio',
      modelName: 'Basic',
      tags: ['lectern', 'bio'],
      options: { allowDuplicate: false },
    })
    expect(notes[1].modelName).toBe('Cloze')
  })

  it('probes with an existing deck when the target deck does not exist yet', async () => {
    let probedDeck = ''
    const { fetchFn } = makeFetch(
      routes({
        modelNames: () => ({ result: ['Basic', 'Cloze'] }),
        deckNames: () => ({ result: ['Default'] }),
        canAddNotes: (params) => {
          const notes = params?.notes as { deckName: string }[]
          probedDeck = notes[0].deckName
          return { result: [true] }
        },
      }),
    )

    const preview = await previewSync(
      makeClient(fetchFn),
      [makeCard()],
      'Brand::New',
      makeSettings(),
      tagsFor,
    )

    expect(preview).toEqual({ toCreate: 1, toUpdate: 0, duplicates: 0 })
    expect(probedDeck).toBe('Default')
  })

  it('is a pure count when every card is an update (no canAddNotes call)', async () => {
    const { fetchFn, calls } = makeFetch(routes({}))

    const preview = await previewSync(
      makeClient(fetchFn),
      [makeCard({ ankiNoteId: 1 }), makeCard({ uid: 'c2', ankiNoteId: 2 })],
      'Deck',
      makeSettings(),
      tagsFor,
    )

    expect(preview).toEqual({ toCreate: 0, toUpdate: 2, duplicates: 0 })
    expect(calls).toHaveLength(0)
  })
})

// --- syncCards ------------------------------------------------------------------

describe('syncCards', () => {
  it('creates/updates per card, collects failures without aborting, reports progress', async () => {
    const cards: Card[] = [
      makeCard({ uid: 'u1', fields: { Front: 'Q1', Back: 'A1' } }),
      makeCard({ uid: 'u2', fields: { Front: 'Q2 dup', Back: 'A2' } }),
      makeCard({ uid: 'u3', ankiNoteId: 777, fields: { Front: 'Q3', Back: 'A3 v2' } }),
    ]
    const { fetchFn, calls } = makeFetch(
      routes({
        modelNames: () => ({ result: ['Basic', 'Cloze'] }),
        createDeck: () => ({ result: 42 }),
        addNote: (_params, nth) =>
          nth === 0
            ? { result: 1501 }
            : { apiError: 'cannot create note because it is a duplicate' },
        updateNoteFields: () => ({ result: null }),
      }),
    )
    const onProgress = vi.fn<(p: SyncProgress) => void>()

    const result = await syncCards(
      makeClient(fetchFn),
      cards,
      'Uni::Bio',
      makeSettings(),
      tagsFor,
      onProgress,
    )

    expect(result.created).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({ uid: 'u2', front: 'Q2 dup' })
    expect(result.failures[0].error).toContain('duplicate')
    expect(result.noteIds).toEqual(
      new Map([
        ['u1', 1501],
        ['u3', 777],
      ]),
    )

    // Progress after every card, including the failing one.
    expect(onProgress.mock.calls.map(([p]) => p)).toEqual([
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ])

    // Deck is created before any note operation.
    const actionOrder = calls.map((c) => c.action)
    expect(actionOrder.indexOf('createDeck')).toBeLessThan(actionOrder.indexOf('addNote'))

    // The update call targets the existing note id with mapped fields.
    const updateCall = calls.find((c) => c.action === 'updateNoteFields')
    expect(updateCall?.params).toEqual({
      note: { id: 777, fields: { Front: 'Q3', Back: 'A3 v2' } },
    })
  })

  it('continues syncing even when createDeck fails', async () => {
    const { fetchFn } = makeFetch(
      routes({
        modelNames: () => ({ result: ['Basic', 'Cloze'] }),
        createDeck: () => ({ apiError: 'collection unavailable' }),
        addNote: () => ({ result: 9001 }),
      }),
    )

    const result = await syncCards(
      makeClient(fetchFn),
      [makeCard()],
      'Deck',
      makeSettings(),
      tagsFor,
      () => {},
    )

    expect(result.created).toBe(1)
    expect(result.failures).toHaveLength(0)
    expect(result.noteIds.get('card-1')).toBe(9001)
  })

  it('collects transport failures per card after retries are exhausted', async () => {
    const { fetchFn } = makeFetch(
      routes({
        modelNames: () => ({ result: ['Basic', 'Cloze'] }),
        createDeck: () => ({ result: 42 }),
        addNote: (_params, nth) =>
          nth < 4 ? { networkError: 'connection dropped' } : { result: 1502 },
      }),
    )
    const progress: SyncProgress[] = []

    const result = await syncCards(
      makeClient(fetchFn),
      [makeCard({ uid: 'u1' }), makeCard({ uid: 'u2', fields: { Front: 'Q2', Back: 'A2' } })],
      'Deck',
      makeSettings(),
      tagsFor,
      (p) => progress.push(p),
    )

    // Card 1 burns all 4 attempts and fails; card 2 succeeds.
    expect(result.created).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].uid).toBe('u1')
    expect(result.failures[0].error).toContain('Failed to reach AnkiConnect')
    expect(progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
  })
})
