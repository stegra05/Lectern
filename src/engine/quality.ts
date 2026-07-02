/**
 * Card evaluation (grounding gate + advisory flags), model-payload
 * normalization and the dedupe key.
 *
 * The gate is a plain checklist: a card is accepted iff every hard
 * requirement is present (prompt, answer, source pages, rationale, source
 * excerpt, valid cloze markup). Soft issues (length, breadth, missing concept
 * ids) are flagged but do not reject. The score shown in the UI derives
 * directly from the issue count — there is no tunable weights table.
 *
 * All functions are pure.
 */

import type { Card, GateVerdict, NoteKind } from './types'

// ---------------------------------------------------------------------------
// Markup stripping (_strip_markup)
// ---------------------------------------------------------------------------

const HTML_TAG_RE = /<[^>]+>/g
const ENTITY_RE = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g

/** Common named entities. Python uses html.unescape (full HTML5 table); we
 *  cover numeric entities completely and the named ones that occur in cards. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  deg: '°',
  times: '×',
  middot: '·',
  plusmn: '±',
  micro: 'µ',
  le: '≤',
  ge: '≥',
  ne: '≠',
  rarr: '→',
  larr: '←',
}

const unescapeHtml = (value: string): string =>
  value.replace(ENTITY_RE, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })

/** Unescape entities, drop HTML tags, collapse whitespace (as in Python). */
export const stripMarkup = (value: string): string =>
  unescapeHtml(value ?? '')
    .replace(HTML_TAG_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// ---------------------------------------------------------------------------
// Scalar / list normalization (coverage.py helpers)
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** normalize_positive_int: bools rejected, floats truncated, digit strings ok. */
const normalizePositiveInt = (value: unknown): number | null => {
  if (typeof value === 'boolean') return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    const truncated = Math.trunc(value)
    return truncated > 0 ? truncated : null
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = parseInt(value.trim(), 10)
    return parsed > 0 ? parsed : null
  }
  return null
}

/** normalize_page_references: scalar → [n], list → deduped positive ints. */
const normalizePageReferences = (value: unknown): number[] => {
  if (value === null || value === undefined) return []
  if (typeof value === 'number' || typeof value === 'string') {
    const normalized = normalizePositiveInt(value)
    return normalized === null ? [] : [normalized]
  }
  if (!Array.isArray(value)) return []
  const refs: number[] = []
  const seen = new Set<number>()
  for (const item of value) {
    const normalized = normalizePositiveInt(item)
    if (normalized !== null && !seen.has(normalized)) {
      refs.push(normalized)
      seen.add(normalized)
    }
  }
  return refs
}

/** normalize_string_list: comma-split strings, stringified lists, no empties. */
const normalizeStringList = (value: unknown): string[] => {
  if (value === null || value === undefined) return []
  let items: string[]
  if (typeof value === 'string') {
    items = value.split(',').map((segment) => segment.trim())
  } else if (Array.isArray(value)) {
    items = value.map((item) => String(item).trim())
  } else {
    return []
  }
  return items.filter((item) => item !== '')
}

/** normalize_relation_key: "source|type|target", all three parts non-empty.
 *  Extra '|' characters stay inside the target part. */
export const normalizeRelationKey = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  const first = value.indexOf('|')
  const second = first < 0 ? -1 : value.indexOf('|', first + 1)
  if (first < 0 || second < 0) return ''
  const parts = [
    value.slice(0, first).trim(),
    value.slice(first + 1, second).trim(),
    value.slice(second + 1).trim(),
  ]
  if (parts.some((part) => part === '')) return ''
  return parts.join('|')
}

/** get_card_page_references: sourcePages, else fall back to the slide number. */
const getCardPageReferences = (card: Card): number[] => {
  const sourcePages = normalizePageReferences(card.sourcePages)
  if (sourcePages.length > 0) return sourcePages
  const slide = normalizePositiveInt(card.slideNumber)
  return slide === null ? [] : [slide]
}

// ---------------------------------------------------------------------------
// Card evaluation — the grounding gate as a checklist
// ---------------------------------------------------------------------------

export const LONG_FRONT_THRESHOLD = 180
export const LONG_ANSWER_THRESHOLD = 420
export const BROAD_GROUNDING_THRESHOLD = 3

const HARD_FAILURE_PENALTY = 25
const SOFT_ISSUE_PENALTY = 10

const CLOZE_DELETION_RE = /\{\{c\d+::/

/**
 * Evaluate a card in one pass. `failures` are hard requirements — any one of
 * them rejects the card. `issues` (failures + soft flags) annotate the card
 * for the UI. The score is display-only: 100 minus a fixed penalty per issue.
 */
export function evaluateCard(card: Card): GateVerdict {
  const fields = card.fields ?? {}
  const front = stripMarkup(fields['Front'] || fields['Text'] || '')
  const text = stripMarkup(fields['Text'] || '')
  const answerText = text || stripMarkup(fields['Back'] || '')
  const sourcePages = getCardPageReferences(card)
  const clozeBasis = `${fields['Text'] ?? ''}${fields['Front'] ?? ''}`

  const failures: string[] = []
  if (!front && !text) failures.push('missing_prompt_text')
  if (!answerText) failures.push('missing_answer_text')
  if (sourcePages.length === 0) failures.push('missing_source_pages')
  if (!stripMarkup(card.rationale ?? '')) failures.push('missing_rationale')
  if (!stripMarkup(card.sourceExcerpt ?? '')) failures.push('missing_source_excerpt')
  // A Cloze note without a {{cN::…}} deletion is rejected by Anki itself;
  // cloze markup on a Basic note renders as literal braces. Catch both here
  // so the model gets an actionable failure instead of a broken sync later.
  if (card.modelName === 'Cloze' && !CLOZE_DELETION_RE.test(clozeBasis)) {
    failures.push('cloze_without_deletion')
  }
  if (card.modelName === 'Basic' && CLOZE_DELETION_RE.test(`${fields['Front'] ?? ''}${fields['Back'] ?? ''}`)) {
    failures.push('cloze_markup_in_basic')
  }

  const soft: string[] = []
  if (normalizeStringList(card.conceptIds).length === 0) soft.push('missing_concept_ids')
  if (front.length > LONG_FRONT_THRESHOLD) soft.push('long_front')
  if (answerText.length > LONG_ANSWER_THRESHOLD) soft.push('long_answer')
  if (sourcePages.length > BROAD_GROUNDING_THRESHOLD) soft.push('broad_grounding')

  const score = Math.max(
    0,
    100 - failures.length * HARD_FAILURE_PENALTY - soft.length * SOFT_ISSUE_PENALTY,
  )
  return {
    pass: failures.length === 0,
    score,
    failures,
    issues: [...failures, ...soft].sort(),
  }
}

// ---------------------------------------------------------------------------
// Model payload normalization (ai_client._normalize_card_payload +
// ai_schemas.AnkiCard validators)
// ---------------------------------------------------------------------------

/** A model-emitted card after tolerant normalization: Card minus the fields
 *  the pipeline assigns later (uid, quality, ankiNoteId). */
export interface NormalizedCardPayload {
  modelName: NoteKind
  fields: Record<string, string>
  slideTopic?: string
  slideNumber?: number
  sourcePages: number[]
  conceptIds: string[]
  relationKeys: string[]
  rationale?: string
  sourceExcerpt?: string
}

/** titleize_model_name + note_export.is_cloze: substring match on "cloze". */
const coerceModelName = (value: unknown): NoteKind =>
  String(value ?? '').trim().toLowerCase().includes('cloze') ? 'Cloze' : 'Basic'

/** stringify_slide_number + ai_client int coercion: 1..99999 or nothing. */
const coerceSlideNumber = (value: unknown): number | null => {
  if (typeof value === 'boolean') return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    const truncated = Math.trunc(value)
    return truncated >= 1 && truncated <= 99999 ? truncated : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d+$/.test(trimmed) && trimmed.length <= 5) {
      const parsed = parseInt(trimmed, 10)
      return parsed >= 1 ? parsed : null
    }
  }
  return null
}

/** coerce_fields: list of {name,value} | record | {front,back}/{text} shorthand. */
const coerceFields = (
  raw: Record<string, unknown>,
  modelName: NoteKind,
): Record<string, string> => {
  const value = raw['fields']
  const out: Record<string, string> = {}

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isRecord(item)) continue
      const name = String(item['name'] ?? '').trim()
      const fieldValue = item['value']
      if (name && fieldValue !== null && fieldValue !== undefined) {
        out[name] = String(fieldValue)
      }
    }
    return out
  }

  if (isRecord(value)) {
    for (const [key, fieldValue] of Object.entries(value)) {
      if (fieldValue === null || fieldValue === undefined) continue
      out[key] = String(fieldValue)
    }
    return out
  }

  // No structured fields — accept the {text} / {front,back} shorthands.
  if (modelName === 'Cloze') {
    const text = String(raw['text'] ?? '').trim()
    if (text) out['Text'] = text
  } else {
    const front = String(raw['front'] ?? '').trim()
    const back = String(raw['back'] ?? '').trim()
    if (front) out['Front'] = front
    if (back) out['Back'] = back
  }
  return out
}

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

/**
 * Tolerant normalization of a raw model-emitted card. Accepts snake_case
 * (the Gemini schema) and camelCase keys. Returns null when the input is not
 * an object or yields no usable note fields.
 */
export function normalizeCardPayload(raw: unknown): NormalizedCardPayload | null {
  if (!isRecord(raw)) return null

  const modelName = coerceModelName(raw['model_name'] ?? raw['modelName'])
  const fields = coerceFields(raw, modelName)
  if (Object.keys(fields).length === 0) return null

  const payload: NormalizedCardPayload = {
    modelName,
    fields,
    sourcePages: normalizePageReferences(raw['source_pages'] ?? raw['sourcePages']),
    conceptIds: normalizeStringList(raw['concept_ids'] ?? raw['conceptIds']),
    relationKeys: normalizeStringList(raw['relation_keys'] ?? raw['relationKeys']),
  }

  const slideTopic = optionalString(raw['slide_topic'] ?? raw['slideTopic'])
  if (slideTopic !== undefined) payload.slideTopic = slideTopic.trim()

  const slideNumber = coerceSlideNumber(raw['slide_number'] ?? raw['slideNumber'])
  if (slideNumber !== null) payload.slideNumber = slideNumber

  const rationale = optionalString(raw['rationale'])
  if (rationale !== undefined) payload.rationale = rationale

  const sourceExcerpt = optionalString(raw['source_excerpt'] ?? raw['sourceExcerpt'])
  if (sourceExcerpt !== undefined) payload.sourceExcerpt = sourceExcerpt

  return payload
}

// ---------------------------------------------------------------------------
// Dedupe key (generation_utils.get_card_key)
// ---------------------------------------------------------------------------

const CLOZE_RE = /\{\{c\d+::(.*?)(?:::[^}]*)?\}\}/g
/** Python's [^\w\s] with Unicode semantics: strip everything that is not a
 *  letter, digit, underscore or whitespace. */
const NON_WORD_RE = /[^\p{L}\p{N}_\s]/gu

/**
 * Normalized duplicate-detection key: Text/Front basis, markup stripped,
 * cloze wrappers reduced to their answers, punctuation dropped, lowercased,
 * whitespace collapsed. Empty key means "no usable prompt" (skip the card).
 */
export function cardKey(card: Pick<Card, 'modelName' | 'fields'>): string {
  const fields = card.fields ?? {}
  let value = stripMarkup(fields['Text'] || fields['Front'] || '')
  value = value.replace(CLOZE_RE, '$1')
  value = value.replace(NON_WORD_RE, ' ')
  return value.toLowerCase().split(/\s+/).filter(Boolean).join(' ')
}
