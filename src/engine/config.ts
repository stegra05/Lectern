/**
 * Engine tuning constants, ported from the original Lectern's battle-tested
 * values (LecternApp/lectern/config.py). Values that users should control
 * live in Settings instead (see settings.ts); these are internals.
 */

// --- Sizing / pacing -------------------------------------------------------

/** Cards per slide the generator aims for in slides mode. */
export const CARDS_PER_SLIDE_TARGET = 0.6
/** Chars of source text per card in script mode. */
export const SCRIPT_BASE_CHARS = 1000
/** Weight of embedded images when sizing script-mode decks. */
export const IMAGE_CARD_WEIGHT = 0.5
/** Documents above this chars/page are treated as script, below as slides. */
export const DENSE_THRESHOLD_CHARS_PER_PAGE = 1500

/** Suggested submit-round size = cap * ratio, clamped by page guardrails. */
export const DYNAMIC_BATCH_TARGET_RATIO = 0.15
export const DYNAMIC_MIN_NOTES_PER_BATCH = 10
export const DYNAMIC_MAX_NOTES_PER_BATCH = 25
export const PAGE_GUARDRAIL_MIN_RATIO = 0.7
export const PAGE_GUARDRAIL_MAX_RATIO = 1.3
export const PAGE_GUARDRAIL_MIN_FLOOR = 8

/** Minimum sensible deck size. */
export const MIN_TOTAL_CARDS = 3

// --- Grounding gate --------------------------------------------------------

export const GROUNDING_GATE_MIN_QUALITY = 60
/** Rounds in a row with zero accepted cards before the loop aborts. */
export const NON_PROGRESS_MAX_ROUNDS = 2
/** Absolute ceiling on agentic rounds, as a runaway backstop. */
export const MAX_GENERATION_ROUNDS = 30

/** A page holding more than this many cards counts as saturated. */
export const SATURATION_CARDS_PER_PAGE = 2

// --- Coverage sufficiency (loop termination) -------------------------------

export const COVERAGE_MIN_RELATION_PERCENT = 50
export const COVERAGE_MIN_CONCEPT_PERCENT = 60
export const COVERAGE_MIN_PAGE_PERCENT = 75

// --- Reflection ------------------------------------------------------------

export const REFLECTION_HARD_CAP_MULTIPLIER = 1.2
export const REFLECTION_HARD_CAP_PADDING = 5
export const MAX_REFLECTION_ROUNDS = 3

// --- Gemini ----------------------------------------------------------------

export const DEFAULT_MODEL = 'gemini-3.5-flash'
export const MODEL_CHOICES = [
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash — fast, agentic (recommended)' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro — deepest reasoning, slower' },
] as const

export type ThinkingLevel = 'low' | 'medium' | 'high'
/** Thinking effort per phase. Flash 3.5 defaults to medium; we push the
 *  one-shot analysis phases higher and keep the card loop snappy. */
export const THINKING_BY_PHASE = {
  mapping: 'high',
  generating: 'medium',
  reflecting: 'high',
} as const satisfies Record<string, ThinkingLevel>

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com'

// --- Retry -----------------------------------------------------------------

export const RATE_LIMIT_MAX_RETRIES = 5
export const RETRY_BASE_DELAY_MS = 2000
export const RETRY_MAX_DELAY_MS = 60_000
export const UPLOAD_MAX_RETRIES = 3
/** How long to poll a freshly uploaded file for ACTIVE state. */
export const FILE_ACTIVE_TIMEOUT_MS = 120_000

// --- Pricing (USD per million tokens: [input, output]) ---------------------
// Approximate — shown to the user as an estimate only.

export const GEMINI_PRICING: Record<string, [number, number]> = {
  'gemini-3.5-flash': [1.5, 9.0],
  'gemini-3.1-pro-preview': [2.0, 12.0],
  'gemini-3-pro': [2.0, 12.0],
  'gemini-3-flash': [0.5, 3.0],
  'gemini-2.5-pro': [1.25, 10.0],
  'gemini-2.5-flash': [0.3, 2.5],
  default: [0.5, 4.0],
}

export const ESTIMATION_TOKENS_PER_PDF_PAGE = 560
export const ESTIMATION_TOKENS_PER_CARD = 100
export const ESTIMATION_BASE_OUTPUT_RATIO = 0.2

// --- Defaults for user settings --------------------------------------------

export const DEFAULT_SETTINGS = {
  model: DEFAULT_MODEL,
  ankiUrl: 'http://localhost:8765',
  basicModelName: 'Basic',
  clozeModelName: 'Cloze',
  tagTemplate: '{{deck}}::{{slide_set}}::{{topic}}',
  defaultTag: 'lectern',
  enableDefaultTag: true,
} as const
