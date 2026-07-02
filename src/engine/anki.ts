/**
 * AnkiConnect integration — TypeScript port of the original Lectern's
 * `lectern/anki_connector.py` + `lectern/utils/note_export.py` and the sync
 * flow from `gui/backend/routers/anki.py`, adapted to the engine contract in
 * `types.ts`.
 *
 * Design rules:
 * - All HTTP goes through an injected `fetchFn` (`typeof fetch`). The app
 *   passes Tauri's CORS-free fetch; tests pass mocks. The global fetch is
 *   never referenced directly.
 * - Transport failures (network, timeout, HTTP status, non-JSON body) raise
 *   `AnkiTransportError` and are retried with exponential backoff
 *   (0.5s → 4s cap, 3 retries). API-level errors ({error: ...} in the
 *   envelope) raise `AnkiApiError` and fail fast.
 */

import type {
  Card,
  Settings,
  SyncFailure,
  SyncPreview,
  SyncProgress,
  SyncResult,
} from './types'

// --- Constants (mirroring anki_connector.py) --------------------------------

export const MIN_ANKICONNECT_VERSION = 6
export const MAX_RETRIES = 3
export const INITIAL_RETRY_DELAY_MS = 500
export const MAX_RETRY_DELAY_MS = 4000
/** Timeout for the lightweight health probe (`version`). */
export const HEALTH_TIMEOUT_MS = 5000
/** Timeout for regular collection operations. */
export const OP_TIMEOUT_MS = 15_000

// --- Errors ------------------------------------------------------------------

export class AnkiConnectError extends Error {
  readonly retriable: boolean

  constructor(message: string, retriable: boolean) {
    super(message)
    this.name = new.target.name
    this.retriable = retriable
  }
}

/** Connection-level failure (network, timeout, HTTP status, non-JSON). Retriable. */
export class AnkiTransportError extends AnkiConnectError {
  constructor(message: string) {
    super(message, true)
  }
}

/** Error returned by the AnkiConnect API itself. Not retriable. */
export class AnkiApiError extends AnkiConnectError {
  constructor(message: string) {
    super(message, false)
  }
}

// --- Wire types ---------------------------------------------------------------

/** The note payload AnkiConnect expects for addNote / canAddNotes. */
export interface AnkiNote {
  deckName: string
  modelName: string
  fields: Record<string, string>
  tags: string[]
  options: { allowDuplicate: boolean }
}

/** Shape of a notesInfo entry (loosely validated, like the Python port). */
export interface AnkiNoteInfo {
  noteId?: number
  modelName?: string
  tags?: string[]
  fields?: Record<string, { value: string; order: number } | undefined>
  [key: string]: unknown
}

interface InvokeOptions {
  timeoutMs?: number
  /** Set false for single-probe calls (health checks). Defaults to true. */
  retry?: boolean
}

/** Test seam: retry pacing can be tightened without touching semantics. */
export interface AnkiClientOptions {
  maxRetries?: number
  initialRetryDelayMs?: number
  maxRetryDelayMs?: number
}

// --- Helpers ------------------------------------------------------------------

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => String(v)) : []

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// --- Client -------------------------------------------------------------------

export class AnkiClient {
  readonly baseUrl: string
  private readonly fetchFn: typeof fetch
  private readonly maxRetries: number
  private readonly initialRetryDelayMs: number
  private readonly maxRetryDelayMs: number

  constructor(baseUrl: string, fetchFn: typeof fetch, options: AnkiClientOptions = {}) {
    this.baseUrl = baseUrl
    this.fetchFn = fetchFn
    this.maxRetries = options.maxRetries ?? MAX_RETRIES
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? INITIAL_RETRY_DELAY_MS
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? MAX_RETRY_DELAY_MS
  }

  /** Single request: envelope {action, version: 6, params?}, unwrap {result, error}. */
  private async invokeOnce(
    action: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const payload: { action: string; version: 6; params?: unknown } =
      params === undefined ? { action, version: 6 } : { action, version: 6, params }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    // Call through a local so `this` is undefined (native fetch rejects other
    // receivers in browser contexts).
    const fetchFn = this.fetchFn

    let response: Response
    try {
      response = await fetchFn(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } catch (err) {
      throw new AnkiTransportError(
        `Failed to reach AnkiConnect at ${this.baseUrl}: ${errorMessage(err)}`,
      )
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      throw new AnkiTransportError(
        `AnkiConnect returned HTTP error ${response.status}`,
      )
    }

    let data: unknown
    try {
      data = await response.json()
    } catch (err) {
      throw new AnkiTransportError(
        `AnkiConnect returned non-JSON response: ${errorMessage(err)}`,
      )
    }

    if (!isRecord(data)) {
      throw new AnkiTransportError(
        `AnkiConnect returned an unexpected response shape for ${action}`,
      )
    }
    if (data.error !== null && data.error !== undefined) {
      throw new AnkiApiError(`AnkiConnect error for ${action}: ${String(data.error)}`)
    }
    return data.result
  }

  /** invokeOnce + exponential-backoff retry on transport errors only. */
  private async invoke(
    action: string,
    params?: unknown,
    options: InvokeOptions = {},
  ): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? OP_TIMEOUT_MS
    const maxRetries = (options.retry ?? true) ? this.maxRetries : 0
    let delay = this.initialRetryDelayMs

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.invokeOnce(action, params, timeoutMs)
      } catch (err) {
        if (err instanceof AnkiTransportError && attempt < maxRetries) {
          await sleep(delay)
          delay = Math.min(delay * 2, this.maxRetryDelayMs)
          continue
        }
        throw err
      }
    }
  }

  /** Health probe: single attempt, short timeout (see NOTE(HealthProbe) upstream). */
  async version(): Promise<number> {
    const result = await this.invoke('version', undefined, {
      timeoutMs: HEALTH_TIMEOUT_MS,
      retry: false,
    })
    if (typeof result !== 'number') {
      throw new AnkiApiError(`Unexpected version result: ${String(result)}`)
    }
    return result
  }

  async deckNames(): Promise<string[]> {
    return toStringArray(await this.invoke('deckNames'))
  }

  async modelNames(): Promise<string[]> {
    return toStringArray(await this.invoke('modelNames'))
  }

  async modelFieldNames(model: string): Promise<string[]> {
    return toStringArray(await this.invoke('modelFieldNames', { modelName: model }))
  }

  /** Creates the deck (idempotent in AnkiConnect) and returns its id. */
  async createDeck(name: string): Promise<number> {
    const result = await this.invoke('createDeck', { deck: name })
    if (typeof result !== 'number') {
      throw new AnkiApiError(`Unexpected createDeck result: ${String(result)}`)
    }
    return result
  }

  async addNote(note: AnkiNote): Promise<number> {
    const result = await this.invoke('addNote', { note })
    if (typeof result !== 'number') {
      throw new AnkiApiError(`Unexpected addNote result: ${String(result)}`)
    }
    return result
  }

  async updateNoteFields(id: number, fields: Record<string, string>): Promise<void> {
    await this.invoke('updateNoteFields', { note: { id, fields } })
  }

  async deleteNotes(ids: number[]): Promise<void> {
    await this.invoke('deleteNotes', { notes: ids })
  }

  async findNotes(query: string): Promise<number[]> {
    const result = await this.invoke('findNotes', { query })
    if (!Array.isArray(result)) return []
    const ids: number[] = []
    for (const value of result) {
      if (typeof value === 'number' && Number.isInteger(value)) ids.push(value)
      else if (typeof value === 'string' && /^\d+$/.test(value)) {
        ids.push(Number.parseInt(value, 10))
      }
    }
    return ids
  }

  async notesInfo(ids: number[]): Promise<AnkiNoteInfo[]> {
    if (ids.length === 0) return []
    const result = await this.invoke('notesInfo', { notes: ids })
    if (!Array.isArray(result)) return []
    return result.filter((entry): entry is AnkiNoteInfo => isRecord(entry))
  }

  /** For each candidate note: can it be added (false = duplicate/invalid)? */
  async canAddNotes(notes: AnkiNote[]): Promise<boolean[]> {
    const result = await this.invoke('canAddNotes', { notes })
    if (!Array.isArray(result)) {
      throw new AnkiApiError(`Unexpected canAddNotes result: ${String(result)}`)
    }
    return result.map((v) => v === true)
  }
}

// --- Connection check ----------------------------------------------------------

export async function checkConnection(
  client: AnkiClient,
): Promise<{ ok: boolean; version?: number; error?: string }> {
  try {
    const version = await client.version()
    if (version < MIN_ANKICONNECT_VERSION) {
      return {
        ok: false,
        version,
        error: `AnkiConnect version ${version} is too old. Minimum required: ${MIN_ANKICONNECT_VERSION}`,
      }
    }
    return { ok: true, version }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

// --- Model name resolution -------------------------------------------------------

/**
 * Localized names of the built-in Basic/Cloze *fields*, so the field-signature
 * detection from `detect_builtin_models` also works on non-English collections
 * (e.g. German "Einfach" with Vorderseite/Rückseite). The Python original only
 * matched the literal "Front"/"Back"/"Text"; this port keeps the identical
 * structural logic but compares field names case-insensitively against these sets.
 */
const FRONT_FIELD_NAMES = new Set([
  'front', // en
  'vorderseite', // de
  'recto', // fr
  'anverso', // es
  'fronte', // it
  'frente', // pt
  'voorkant', // nl
])
const BACK_FIELD_NAMES = new Set([
  'back', // en
  'rückseite', // de
  'verso', // fr, pt
  'reverso', // es
  'retro', // it
  'achterkant', // nl
])
const TEXT_FIELD_NAMES = new Set([
  'text', // en, de
  'texte', // fr
  'texto', // es, pt
  'testo', // it
  'tekst', // nl
])

export interface ResolvedModelNames {
  basic: string
  cloze: string
}

/**
 * Port of `detect_builtin_models`: scan every model's fields; Basic signature =
 * has a Front-like and a Back-like field, Cloze signature = has a Text-like
 * field and no Front-like field. A model literally named "Basic"/"Cloze" wins;
 * otherwise the last matching model is kept (same overwrite semantics as the
 * original). The field lookups are independent reads against localhost, so
 * they go out concurrently; the fold below walks the results in model order,
 * which keeps the overwrite semantics deterministic.
 */
async function detectBuiltinModels(
  client: AnkiClient,
  models: string[],
): Promise<ResolvedModelNames> {
  const fieldsPerModel = await Promise.all(
    // A model whose lookup fails contributes no signature ([] on failure).
    models.map((name) => client.modelFieldNames(name).catch(() => [] as string[])),
  )

  const detected: ResolvedModelNames = { basic: 'Basic', cloze: 'Cloze' }
  let foundCanonicalBasic = false
  let foundCanonicalCloze = false

  for (const [index, name] of models.entries()) {
    const fieldSet = new Set(fieldsPerModel[index].map((f) => f.trim().toLowerCase()))
    const hasFront = [...fieldSet].some((f) => FRONT_FIELD_NAMES.has(f))
    const hasBack = [...fieldSet].some((f) => BACK_FIELD_NAMES.has(f))
    const hasText = [...fieldSet].some((f) => TEXT_FIELD_NAMES.has(f))

    if (hasFront && hasBack) {
      if (name === 'Basic') {
        detected.basic = name
        foundCanonicalBasic = true
      } else if (!foundCanonicalBasic) {
        detected.basic = name
      }
    }

    if (hasText && !hasFront) {
      if (name === 'Cloze') {
        detected.cloze = name
        foundCanonicalCloze = true
      } else if (!foundCanonicalCloze) {
        detected.cloze = name
      }
    }
  }

  return detected
}

/**
 * Resolve the Basic/Cloze model names to use against this Anki instance
 * (port of `resolve_model_name`): prefer the configured names when they exist
 * in the collection; otherwise fall back to the detected localized built-ins;
 * otherwise the literal 'Basic'/'Cloze'.
 *
 * Resolution runs fresh on every call. The original backend cached results
 * because it re-resolved on every request of a long-running server over slow
 * sequential lookups; here it only runs on explicit preview/sync actions and
 * the lookups are concurrent, so caching would only risk staleness when the
 * user edits note types while the app is open.
 *
 * When Anki is unreachable the configured names are passed through unchanged
 * (export will fail anyway).
 */
export async function resolveModelNames(
  client: AnkiClient,
  settings: Settings,
): Promise<ResolvedModelNames> {
  const configuredBasic = settings.basicModelName.trim() || 'Basic'
  const configuredCloze = settings.clozeModelName.trim() || 'Cloze'

  let models: string[] = []
  try {
    models = await client.modelNames()
  } catch {
    models = [] // mirror get_model_names: [] on failure
  }
  if (models.length === 0) {
    return { basic: configuredBasic, cloze: configuredCloze }
  }

  let detected: ResolvedModelNames | undefined
  const resolveOne = async (
    configured: string,
    kind: keyof ResolvedModelNames,
  ): Promise<string> => {
    if (models.includes(configured)) return configured
    detected ??= await detectBuiltinModels(client, models)
    const localized = detected[kind]
    if (localized !== configured && models.includes(localized)) return localized
    return kind === 'basic' ? 'Basic' : 'Cloze'
  }

  return {
    basic: await resolveOne(configuredBasic, 'basic'),
    cloze: await resolveOne(configuredCloze, 'cloze'),
  }
}

// --- Card → note conversion -------------------------------------------------------

/**
 * Convert an engine Card to an AnkiConnect note payload (port of
 * `to_note_fields` in note_export.py). Basic maps to Front/Back, Cloze to
 * Text / Back Extra (falling back to Front/Back content for mislabeled cloze
 * cards, like the Python `payload.text` path). Extra fields whose names are
 * not part of the canonical mapping are preserved verbatim so they fill
 * matching model fields.
 */
export function cardToNote(
  card: Card,
  opts: { deckName: string; modelName: string; tags: string[] },
): AnkiNote {
  const source = card.fields
  const fields: Record<string, string> = {}

  if (card.modelName === 'Cloze') {
    fields['Text'] = source['Text'] ?? source['Front'] ?? ''
    const backExtra = source['Back Extra'] ?? source['Back']
    if (backExtra !== undefined && backExtra !== '') {
      fields['Back Extra'] = backExtra
    }
    for (const [name, value] of Object.entries(source)) {
      if (name === 'Text' || name === 'Back Extra' || name === 'Front' || name === 'Back') {
        continue
      }
      fields[name] = value
    }
  } else {
    fields['Front'] = source['Front'] ?? ''
    fields['Back'] = source['Back'] ?? ''
    for (const [name, value] of Object.entries(source)) {
      if (name === 'Front' || name === 'Back') continue
      fields[name] = value
    }
  }

  return {
    deckName: opts.deckName,
    modelName: opts.modelName,
    fields,
    tags: [...opts.tags],
    options: { allowDuplicate: false },
  }
}

const cardFrontText = (card: Card): string =>
  card.fields['Front'] ?? card.fields['Text'] ?? Object.values(card.fields)[0] ?? ''

const modelNameFor = (card: Card, resolved: ResolvedModelNames): string =>
  card.modelName === 'Cloze' ? resolved.cloze : resolved.basic

// --- Sync preview -------------------------------------------------------------------

/**
 * Preview a sync without mutating Anki: cards with an `ankiNoteId` count as
 * updates (semantics of `build_sync_preview` with allow_updates); the rest are
 * creates, checked against `canAddNotes` to count duplicates that Anki would
 * reject. If the target deck does not exist yet, an existing deck is used for
 * the probe (duplicate detection is collection-wide, and previewing must not
 * create the deck).
 */
export async function previewSync(
  client: AnkiClient,
  cards: Card[],
  deckName: string,
  settings: Settings,
  resolveTags: (card: Card) => string[],
): Promise<SyncPreview> {
  const creates = cards.filter((card) => typeof card.ankiNoteId !== 'number')
  const toUpdate = cards.length - creates.length

  let duplicates = 0
  if (creates.length > 0) {
    const resolved = await resolveModelNames(client, settings)

    let probeDeck = deckName
    try {
      const decks = await client.deckNames()
      if (!decks.includes(deckName) && decks.length > 0) probeDeck = decks[0]
    } catch {
      // keep the requested deck; canAddNotes will surface real transport errors
    }

    const notes = creates.map((card) =>
      cardToNote(card, {
        deckName: probeDeck,
        modelName: modelNameFor(card, resolved),
        tags: resolveTags(card),
      }),
    )
    const canAdd = await client.canAddNotes(notes)
    duplicates = canAdd.filter((ok) => !ok).length
  }

  return { toCreate: creates.length, toUpdate, duplicates }
}

// --- Sync execution -------------------------------------------------------------------

/**
 * Execute a sync (semantics of `stream_sync_cards`): ensure the deck exists,
 * then per card either update (has `ankiNoteId`) or add. One card's failure
 * never aborts the batch — it is collected as a SyncFailure — and progress is
 * reported after every card, success or not. Returns the counts plus a map of
 * card uid → Anki note id for successfully synced cards.
 */
export async function syncCards(
  client: AnkiClient,
  cards: Card[],
  deckName: string,
  settings: Settings,
  resolveTags: (card: Card) => string[],
  onProgress: (p: SyncProgress) => void,
): Promise<SyncResult & { noteIds: Map<string, number> }> {
  const resolved = await resolveModelNames(client, settings)

  try {
    await client.createDeck(deckName)
  } catch {
    // Mirror create_deck's tolerance: if creation fails (deck may already
    // exist, or Anki is down) continue — per-card operations report the
    // actionable errors.
  }

  let created = 0
  let updated = 0
  const failures: SyncFailure[] = []
  const noteIds = new Map<string, number>()
  const total = cards.length

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    try {
      const note = cardToNote(card, {
        deckName,
        modelName: modelNameFor(card, resolved),
        tags: resolveTags(card),
      })
      if (typeof card.ankiNoteId === 'number') {
        await client.updateNoteFields(card.ankiNoteId, note.fields)
        updated++
        noteIds.set(card.uid, card.ankiNoteId)
      } else {
        const id = await client.addNote(note)
        created++
        noteIds.set(card.uid, id)
      }
    } catch (err) {
      failures.push({
        uid: card.uid,
        front: cardFrontText(card),
        error: errorMessage(err),
      })
    }
    onProgress({ done: i + 1, total })
  }

  return { created, updated, failures, noteIds }
}
