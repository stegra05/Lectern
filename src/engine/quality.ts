/**
 * Card quality rubric, grounding gate, model-payload normalization and the
 * dedupe key — faithful port of the battle-tested Python logic in:
 *   - LecternApp/lectern/card_quality.py        (rubric weights + rules)
 *   - LecternApp/lectern/generation_utils.py    (evaluate_grounding_gate, get_card_key)
 *   - LecternApp/lectern/ai_client.py           (_normalize_card_payload)
 *   - LecternApp/lectern/ai_schemas.py          (AnkiCard coercion validators)
 *   - LecternApp/lectern/coverage.py            (normalize_* helpers)
 *
 * All functions are pure.
 */

import { GROUNDING_GATE_MIN_QUALITY } from './config'
import type { Card, CoverageCatalog, GateVerdict, NoteKind } from './types'

// ---------------------------------------------------------------------------
// Rubric weights (CardQualityWeights in card_quality.py — identical values)
// ---------------------------------------------------------------------------

export const CARD_QUALITY_WEIGHTS = {
  baseScore: 30,
  promptPresentBonus: 12,
  promptMissingPenalty: 20,
  answerPresentBonus: 10,
  answerMissingPenalty: 15,
  sourcePagesPresentBonus: 12,
  sourcePagesMissingPenalty: 10,
  conceptIdsPresentBonus: 12,
  conceptIdsMissingPenalty: 8,
  relationKeysPresentBonus: 6,
  rationalePresentBonus: 7,
  rationaleMissingPenalty: 4,
  sourceExcerptPresentBonus: 6,
  sourceExcerptMissingPenalty: 4,
  slideNumberBonus: 3,
  longFrontPenalty: 8,
  longAnswerPenalty: 8,
  broadGroundingPenalty: 3,
  highPriorityConceptBonus: 5,
  longFrontThreshold: 180,
  longAnswerThreshold: 420,
  broadGroundingThreshold: 3,
} as const

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
 *  Extra '|' characters stay inside the target part (Python split("|", 2)). */
const normalizeRelationKey = (value: unknown): string => {
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
// Rubric scoring (CardQualityEvaluator.evaluate)
// ---------------------------------------------------------------------------

interface QualityContext {
  front: string
  answerText: string
  sourcePages: number[]
  conceptIds: string[]
  relationKeys: string[]
  rationale: string
  sourceExcerpt: string
  hasSlideNumber: boolean
  hasPromptText: boolean
}

const buildQualityContext = (card: Card): QualityContext => {
  const fields = card.fields ?? {}
  // _get_card_front: front || fields.Front || text || fields.Text (raw
  // truthiness picks the field, markup is stripped afterwards).
  const front = stripMarkup(fields['Front'] || fields['Text'] || '')
  const back = stripMarkup(fields['Back'] || '')
  const text = stripMarkup(fields['Text'] || '')
  return {
    front,
    answerText: text || back,
    sourcePages: getCardPageReferences(card),
    conceptIds: normalizeStringList(card.conceptIds),
    relationKeys: normalizeStringList(card.relationKeys)
      .map(normalizeRelationKey)
      .filter((key) => key !== ''),
    rationale: stripMarkup(card.rationale ?? ''),
    sourceExcerpt: stripMarkup(card.sourceExcerpt ?? ''),
    hasSlideNumber: Boolean(card.slideNumber),
    hasPromptText: Boolean(front || text),
  }
}

/**
 * Weighted rule-based quality rubric. Same rules, weights and flag slugs as
 * card_quality.DEFAULT_CARD_QUALITY_RULES; score clamped to [0, 100] and
 * rounded to one decimal, issues deduped + sorted.
 */
export function scoreCard(
  card: Card,
  catalog?: CoverageCatalog,
): { score: number; issues: string[] } {
  const W = CARD_QUALITY_WEIGHTS
  const ctx = buildQualityContext(card)
  let score = W.baseScore
  const issues: string[] = []

  if (ctx.hasPromptText) {
    score += W.promptPresentBonus
  } else {
    issues.push('missing_prompt_text')
    score -= W.promptMissingPenalty
  }

  if (ctx.answerText) {
    score += W.answerPresentBonus
  } else {
    issues.push('missing_answer_text')
    score -= W.answerMissingPenalty
  }

  if (ctx.sourcePages.length > 0) {
    score += W.sourcePagesPresentBonus
  } else {
    issues.push('missing_source_pages')
    score -= W.sourcePagesMissingPenalty
  }

  if (ctx.conceptIds.length > 0) {
    score += W.conceptIdsPresentBonus
  } else {
    issues.push('missing_concept_ids')
    score -= W.conceptIdsMissingPenalty
  }

  if (ctx.relationKeys.length > 0) score += W.relationKeysPresentBonus

  if (ctx.rationale) {
    score += W.rationalePresentBonus
  } else {
    issues.push('missing_rationale')
    score -= W.rationaleMissingPenalty
  }

  if (ctx.sourceExcerpt) {
    score += W.sourceExcerptPresentBonus
  } else {
    issues.push('missing_source_excerpt')
    score -= W.sourceExcerptMissingPenalty
  }

  if (ctx.hasSlideNumber) score += W.slideNumberBonus

  if (ctx.front.length > W.longFrontThreshold) {
    issues.push('long_front')
    score -= W.longFrontPenalty
  }

  if (ctx.answerText.length > W.longAnswerThreshold) {
    issues.push('long_answer')
    score -= W.longAnswerPenalty
  }

  if (ctx.sourcePages.length > W.broadGroundingThreshold) {
    issues.push('broad_grounding')
    score -= W.broadGroundingPenalty
  }

  if (
    catalog !== undefined &&
    ctx.conceptIds.some((id) => catalog.highPriorityIds.has(id))
  ) {
    score += W.highPriorityConceptBonus
  }

  const clamped = Math.max(0, Math.min(100, score))
  return {
    score: Math.round(clamped * 10) / 10,
    issues: [...new Set(issues)].sort(),
  }
}

// ---------------------------------------------------------------------------
// Grounding gate (generation_utils.evaluate_grounding_gate)
// ---------------------------------------------------------------------------

const GATE_FLAG_ORDER = [
  'missing_source_excerpt',
  'missing_rationale',
  'missing_source_pages',
] as const

/**
 * Hard gate for accepting a generated card. Recomputes the rubric (the Python
 * pipeline annotates first, then gates on the stored score/flags — same net
 * result) and fails on missing grounding metadata or a score below
 * GROUNDING_GATE_MIN_QUALITY. Failure slugs are stable and ordered.
 */
export function evaluateGroundingGate(
  card: Card,
  catalog?: CoverageCatalog,
): GateVerdict {
  const { score, issues } = scoreCard(card, catalog)
  const flagged = new Set(issues)
  const failures: string[] = []
  for (const key of GATE_FLAG_ORDER) {
    if (flagged.has(key)) failures.push(key)
  }
  if (score < GROUNDING_GATE_MIN_QUALITY) failures.push('below_quality_threshold')
  return { pass: failures.length === 0, score, failures }
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
