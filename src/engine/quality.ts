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

/**
 * Drop HTML tags, unescape entities, collapse whitespace.
 *
 * Tags go first: unescaping ahead of the strip turned an escaped literal
 * ("x &lt; y then z &gt; 0") into a real-looking tag and then deleted
 * everything between the brackets, leaving "x 0". Text that was never markup
 * has to survive a round trip through Anki.
 */
export const stripMarkup = (value: string): string =>
  unescapeHtml((value ?? '').replace(HTML_TAG_RE, ' '))
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

/** Deletions the prompt allows on one card, outside an ordered procedure. */
export const MAX_CLOZE_DELETIONS = 2

const CLOZE_DELETION_RE = /\{\{c\d+::/
const CLOZE_OPENER_RE = /\{\{c(\d+)::/g
/** A *complete* deletion. Non-greedy, exactly like Anki's own parser — which
 *  is why an unescaped `}}` inside the answer truncates the card. */
const CLOZE_FULL_RE = /\{\{c\d+::[\s\S]*?(?:::[^}]*)?\}\}/g

// --- Markup the Anki renderer shows literally ------------------------------
// The prompt forbids all of these; nothing used to check, so the model kept
// producing them and the user found them on the card.

const MARKDOWN_BOLD_RE = /(\*\*|__)(?=\S)[\s\S]+?\1/
const MARKDOWN_HEADING_RE = /^\s{0,3}#{1,6}\s+\S/m
const MARKDOWN_BULLET_RE = /^\s*[-*+]\s+\S/gm
/** `$…$` renders as literal dollars in Anki, which enables `\(…\)` instead.
 *  The body must look like TeX so prices ("between $5 and $10") stay clear. */
const DOLLAR_MATH_RE = /\$\$?[^$\n]*[\\^_{}][^$\n]*\$\$?/

const hasMarkdownBullets = (value: string): boolean =>
  !/<\s*(ul|ol)\b/i.test(value) && (value.match(MARKDOWN_BULLET_RE) ?? []).length >= 2

/** Fronts that can be answered "yes" — the prompt asks for open questions. */
const YES_NO_RE =
  /^\s*(is|are|was|were|does|do|did|can|could|will|would|should|has|have|had|must|ist|sind|war|waren|hat|haben|kann|können|wird|werden|muss|müssen|gibt)\b/i

/** Phrases that point at the slide instead of naming the thing. */
const DEIXIS_RE =
  /\b(as (shown|seen|depicted|illustrated|described)|shown (above|below|here)|in the (figure|diagram|image|picture|table|graph|chart)|on (this|the) slide|the (figure|diagram|slide) (above|below)|see (the|above|below))\b/i

/**
 * Does any deletion end before its author meant it to?
 *
 * Anki closes a deletion at the first `}}`, so `{{c1::\(\frac{1}{2}\)}}`
 * — the shape the prompt itself asks for, math inside a deletion — ends
 * inside the fraction and leaves `\)}}` as literal text on the card. The
 * giveaway is an unbalanced brace count in the captured body, or an opener
 * with no closer at all.
 */
export function hasTruncatedCloze(value: string): boolean {
  const openers = (value.match(CLOZE_OPENER_RE) ?? []).length
  const complete = value.match(CLOZE_FULL_RE) ?? []
  if (openers > complete.length) return true
  return complete.some((deletion) => {
    const body = deletion.replace(/^\{\{c\d+::/, '').replace(/\}\}$/, '')
    const open = (body.match(/\{/g) ?? []).length
    const close = (body.match(/\}/g) ?? []).length
    return open !== close
  })
}

/** Distinct `cN` ordinals — what Anki turns into separate cards. */
export function clozeOrdinals(value: string): number[] {
  const found = new Set<number>()
  for (const match of value.matchAll(CLOZE_OPENER_RE)) found.add(Number(match[1]))
  return [...found].sort((a, b) => a - b)
}

/** How many Anki cards a note actually becomes: one per cloze ordinal. */
export const ankiCardCount = (card: Pick<Card, 'modelName' | 'fields'>): number => {
  if (card.modelName !== 'Cloze') return 1
  const fields = card.fields ?? {}
  return Math.max(1, clozeOrdinals(`${fields['Text'] ?? ''}${fields['Front'] ?? ''}`).length)
}

export interface EvaluateOptions {
  /** Pages the document actually has. Citations beyond it are rejected. */
  pageCount?: number
  /** Extracted page text, index 0 = page 1. Enables the excerpt check. */
  pageTexts?: string[]
}

// --- Excerpt grounding -----------------------------------------------------

/** Below this, the page carries too little extractable text to judge —
 *  a diagram-only slide, or a scan. */
const MIN_PAGE_TEXT_CHARS = 60
/** Share of an excerpt's distinctive words that must appear on the page. */
const EXCERPT_MATCH_RATIO = 0.6
/** Short words carry no evidence; comparing them invites false matches. */
const MIN_EXCERPT_WORD_LEN = 4
const MIN_EXCERPT_WORDS = 3

const wordsOf = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(NON_WORD_RE, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= MIN_EXCERPT_WORD_LEN)

/**
 * Is the excerpt actually on one of the pages the card cites?
 *
 * `source_excerpt` is the model's own claim about the slide, and nothing
 * checked it — a card could cite page 12 and quote something that was never
 * there. Returns null when the question cannot be answered honestly (no page
 * text available, an image-only slide, an excerpt too short to test), so the
 * check only ever speaks when it has evidence.
 */
export function excerptIsOnPage(
  excerpt: string,
  pages: readonly number[],
  pageTexts: readonly string[],
): boolean | null {
  const words = wordsOf(stripMarkup(excerpt))
  if (words.length < MIN_EXCERPT_WORDS) return null

  const available = pages
    .map((page) => pageTexts[page - 1] ?? '')
    .filter((text) => text.length >= MIN_PAGE_TEXT_CHARS)
  if (available.length === 0) return null

  const haystack = new Set(wordsOf(available.join(' ')))
  const found = words.filter((word) => haystack.has(word)).length
  return found / words.length >= EXCERPT_MATCH_RATIO
}

/**
 * Evaluate a card in one pass. `failures` are hard requirements — any one of
 * them rejects the card. `issues` (failures + soft flags) annotate the card
 * for the UI. The score is display-only: 100 minus a fixed penalty per issue.
 */
export function evaluateCard(card: Card, opts: EvaluateOptions = {}): GateVerdict {
  const fields = card.fields ?? {}
  const front = stripMarkup(fields['Front'] || fields['Text'] || '')
  const text = stripMarkup(fields['Text'] || '')
  const answerText = text || stripMarkup(fields['Back'] || '')
  const sourcePages = getCardPageReferences(card)
  const clozeBasis = `${fields['Text'] ?? ''}${fields['Front'] ?? ''}`
  const allMarkup = Object.values(fields).join('\n')

  const failures: string[] = []
  if (!front && !text) failures.push('missing_prompt_text')
  if (!answerText) failures.push('missing_answer_text')
  // A card declared outside the source has no pages or slide excerpt to
  // ground it — the outside_source flag replaces those two requirements.
  if (sourcePages.length === 0 && !card.outsideSource) failures.push('missing_source_pages')
  if (!stripMarkup(card.rationale ?? '')) failures.push('missing_rationale')
  if (!stripMarkup(card.sourceExcerpt ?? '') && !card.outsideSource) {
    failures.push('missing_source_excerpt')
  }
  // A page the document does not have is a hallucinated citation: it grounds
  // nothing, and the ledger would count it as coverage.
  if (opts.pageCount !== undefined && opts.pageCount > 0) {
    const pageCount = opts.pageCount
    if (sourcePages.some((page) => page > pageCount)) failures.push('page_out_of_range')
  }
  // A Cloze note without a {{cN::…}} deletion is rejected by Anki itself;
  // cloze markup on a Basic note renders as literal braces. Catch both here
  // so the model gets an actionable failure instead of a broken sync later.
  if (card.modelName === 'Cloze' && !CLOZE_DELETION_RE.test(clozeBasis)) {
    failures.push('cloze_without_deletion')
  }
  if (
    card.modelName === 'Basic' &&
    CLOZE_DELETION_RE.test(`${fields['Front'] ?? ''}${fields['Back'] ?? ''}`)
  ) {
    failures.push('cloze_markup_in_basic')
  }
  if (card.modelName === 'Cloze') {
    if (hasTruncatedCloze(clozeBasis)) failures.push('cloze_unterminated')
    const ordinals = clozeOrdinals(clozeBasis)
    // An <ol> of numbered steps is the sanctioned exception: each deletion
    // drills one step of a procedure.
    if (ordinals.length > MAX_CLOZE_DELETIONS && !/<\s*ol\b/i.test(clozeBasis)) {
      failures.push('too_many_cloze_deletions')
    }
  }
  // Markdown and $…$ are shown to the student as literal characters.
  if (MARKDOWN_BOLD_RE.test(allMarkup) || MARKDOWN_HEADING_RE.test(allMarkup)) {
    failures.push('markdown_not_html')
  } else if (hasMarkdownBullets(allMarkup)) {
    failures.push('markdown_not_html')
  }
  if (DOLLAR_MATH_RE.test(allMarkup)) failures.push('dollar_math_delimiters')
  // An answer that repeats the question teaches nothing.
  if (
    card.modelName === 'Basic' &&
    answerText !== '' &&
    answerText.toLowerCase() === front.toLowerCase()
  ) {
    failures.push('answer_repeats_prompt')
  }

  const soft: string[] = []
  if (card.outsideSource) soft.push('outside_source')
  if (normalizeStringList(card.conceptIds).length === 0 && !card.outsideSource) {
    soft.push('missing_concept_ids')
  }
  if (front.length > LONG_FRONT_THRESHOLD) soft.push('long_front')
  if (answerText.length > LONG_ANSWER_THRESHOLD) soft.push('long_answer')
  if (sourcePages.length > BROAD_GROUNDING_THRESHOLD) soft.push('broad_grounding')
  if (card.modelName === 'Basic' && YES_NO_RE.test(front)) soft.push('yes_no_question')
  if (DEIXIS_RE.test(`${front} ${answerText}`)) soft.push('points_at_source')
  // An excerpt identical to the answer is a copy of the card, not evidence
  // for it.
  const excerpt = stripMarkup(card.sourceExcerpt ?? '').toLowerCase()
  if (excerpt !== '' && excerpt === answerText.toLowerCase()) soft.push('excerpt_repeats_answer')
  // Grounding the app can check rather than take on trust.
  if (opts.pageTexts !== undefined && !card.outsideSource && card.sourceExcerpt) {
    const onPage = excerptIsOnPage(card.sourceExcerpt, sourcePages, opts.pageTexts)
    if (onPage === false) soft.push('excerpt_not_on_cited_page')
  }

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
  /** Explicit grounding declaration from the follow-up schema: false means
   *  "this content is not in the document". Absent everywhere else. */
  inSource?: boolean
}

/** titleize_model_name + note_export.is_cloze: substring match on "cloze". */
const coerceModelName = (value: unknown): NoteKind =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .includes('cloze')
    ? 'Cloze'
    : 'Basic'

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

  if ((raw['in_source'] ?? raw['inSource']) === false) payload.inSource = false

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

// ---------------------------------------------------------------------------
// Near-duplicate detection
// ---------------------------------------------------------------------------

/** Above this token overlap two prompts are asking the same thing. */
export const NEAR_DUPLICATE_SIMILARITY = 0.85
/** Below this many tokens, overlap is noise ("Define entropy" vs "Define
 *  enthalpy" share 1 of 2 tokens); the exact key still catches repeats. */
const MIN_TOKENS_FOR_SIMILARITY = 4

const tokenSet = (key: string): Set<string> => new Set(key.split(' ').filter(Boolean))

const jaccard = (a: Set<string>, b: Set<string>): number => {
  let shared = 0
  for (const token of a) if (b.has(token)) shared++
  const union = a.size + b.size - shared
  return union === 0 ? 0 : shared / union
}

/**
 * The exact key catches a repeat; this catches a rephrasing. "What is the
 * learning rate?" and "What is a learning rate?" produce different keys and
 * used to both land in the deck, leaving the review pass to notice by eye.
 *
 * Returns the key it collides with, or null.
 */
export function findNearDuplicate(key: string, existingKeys: Iterable<string>): string | null {
  const tokens = tokenSet(key)
  if (tokens.size < MIN_TOKENS_FOR_SIMILARITY) return null
  for (const other of existingKeys) {
    const otherTokens = tokenSet(other)
    if (otherTokens.size < MIN_TOKENS_FOR_SIMILARITY) continue
    if (jaccard(tokens, otherTokens) >= NEAR_DUPLICATE_SIMILARITY) return other
  }
  return null
}
