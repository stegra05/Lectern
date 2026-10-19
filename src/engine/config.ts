/**
 * Engine tuning constants, ported from the original Lectern's battle-tested
 * values (LecternApp/lectern/config.py). Values that users should control
 * live in Settings instead (see settings.ts); these are internals.
 */

// --- Sizing / pacing -------------------------------------------------------

/** Cards per slide the generator aims for in slides mode. */
export const CARDS_PER_SLIDE_TARGET = 0.6
/** Chars of source text per card in script mode. Was 1000, which gave a
 *  dense 3-page pathology script 5 cards where blind reviews wanted 24-26;
 *  with the budget guardrails this allows up to one card per 200 chars. */
export const SCRIPT_BASE_CHARS = 400
/** Weight of embedded images when sizing script-mode decks. */
export const IMAGE_CARD_WEIGHT = 0.5
/** Documents above this chars/page are treated as script, below as slides. */
export const DENSE_THRESHOLD_CHARS_PER_PAGE = 1500

/** Suggested submit-round size = cap * ratio, clamped to [min, max]. */
export const DYNAMIC_BATCH_TARGET_RATIO = 0.15
export const DYNAMIC_MIN_NOTES_PER_BATCH = 10
export const DYNAMIC_MAX_NOTES_PER_BATCH = 25

/** Minimum sensible deck size. */
export const MIN_TOTAL_CARDS = 3

// --- Deck size from card budgets --------------------------------------------
// The concept map gives every concept a card budget (1-4) after reading the
// whole lecture; the deck is their sum at the chosen density. The page and
// character heuristic above only guards the sum against a model that
// over- or under-allocates, and sizes the estimate before a run.

export const CONCEPT_CARD_BUDGET_MAX = 4
/** How each density scales the budgets (and the heuristic's guardrails). */
export const DENSITY_FACTOR = { overview: 0.5, standard: 1, thorough: 1.5 } as const
/** Cards one facet may hold before another is a repeat. A thorough deck may
 *  ask a fact a second time from another angle; the others ask it once. */
export const CARDS_PER_FACET = { overview: 1, standard: 1, thorough: 2 } as const
/** The budget sum may go this far below or above the heuristic deck. */
export const BUDGET_GUARD_MIN = 0.5
export const BUDGET_GUARD_MAX = 2

/** Concept-map size. Without a target, models split the same lecture into
 *  anywhere from about 30 to 75 concepts, and coverage is measured against
 *  that count. The target follows the amount of material: about one concept
 *  per slide that earns a card, or per this many characters of a script. A
 *  blind review of a 3-page pathology script found 4-5 concepts (one per
 *  section heading) too coarse to steer anything and asked for 12-18. */
export const SCRIPT_CHARS_PER_CONCEPT = 300
/** The target range runs from this share of the natural count up to it. */
export const CONCEPT_TARGET_MIN_SHARE = 0.6
export const CONCEPT_COUNT_FLOOR = 6
export const CONCEPT_COUNT_CEILING = 40

// --- Generation loop -------------------------------------------------------

/** Rounds in a row with zero accepted cards before the loop aborts. */
export const NON_PROGRESS_MAX_ROUNDS = 2
/** Absolute ceiling on agentic rounds, as a runaway backstop. */
export const MAX_GENERATION_ROUNDS = 30

/** A page holding more than this many cards counts as saturated. */
export const SATURATION_CARDS_PER_PAGE = 2

/** Times a run is sent back to the concepts short of their card budget
 *  before its request to stop early is taken at face value. One push, not an
 *  endless one: the brief asks for an honest short deck over a padded one, so
 *  a second request means the model has looked and found nothing worth
 *  adding, and the deck ends where the material does. */
export const EARLY_FINISH_ATTEMPTS = 1

// --- Coverage sufficiency (loop termination) -------------------------------

export const COVERAGE_MIN_RELATION_PERCENT = 50
export const COVERAGE_MIN_CONCEPT_PERCENT = 60
export const COVERAGE_MIN_PAGE_PERCENT = 75

// --- Reflection (agentic review loop over the generated deck) ---------------
// The deck stays within the sizing cap throughout review: add_cards only
// fills free slots, and remove_cards frees them.

/** Absolute ceiling on review rounds, as a runaway backstop. */
export const MAX_REFLECTION_ROUNDS = 10
/** Review may delete at most this fraction of the pre-review deck. */
export const REFLECTION_MAX_REMOVAL_RATIO = 0.5

// --- Follow-up requests (post-completion "more cards" chat) -----------------
// Additions only: a follow-up never edits or removes existing cards, so each
// request gets its own small budget instead of the session cap.

/** New cards one follow-up request may add. */
export const FOLLOWUP_CARD_CAP = 10
/** Absolute ceiling on agentic rounds per follow-up request. */
export const MAX_FOLLOWUP_ROUNDS = 6

// --- Providers and models ------------------------------------------------

export type ProviderId = 'gemini' | 'openai' | 'anthropic'

export const PROVIDERS: Record<ProviderId, { label: string; voice: string }> = {
  // label names the account and its key; voice names the model in the log.
  gemini: { label: 'Gemini', voice: 'Gemini' },
  openai: { label: 'OpenAI', voice: 'GPT' },
  anthropic: { label: 'Claude', voice: 'Claude' },
}

export const DEFAULT_MODEL = 'gemini-3.8-flash'
export const MODEL_CHOICES = [
  {
    id: 'gemini-3.8-flash',
    provider: 'gemini',
    label: 'Gemini 3.8 Flash',
    note: 'fast, agentic (recommended)',
  },
  {
    id: 'gemini-3.1-pro-preview',
    provider: 'gemini',
    label: 'Gemini 3.1 Pro',
    note: 'deepest reasoning, slower',
  },
  { id: 'gpt-6-luna', provider: 'openai', label: 'GPT-6 Luna', note: 'lowest cost' },
  {
    id: 'claude-haiku-5-5',
    provider: 'anthropic',
    label: 'Claude Haiku 5.5',
    note: 'low cost, strong on charts',
  },
] as const satisfies ReadonlyArray<{
  id: string
  provider: ProviderId
  label: string
  note: string
}>

/** The provider that serves a model. Ids outside the picker (a saved run's
 *  retired model) are told apart by their prefix. */
export function providerOf(model: string): ProviderId {
  const choice = MODEL_CHOICES.find((m) => m.id === model)
  if (choice) return choice.provider
  if (model.startsWith('claude-')) return 'anthropic'
  if (model.startsWith('gpt-') || /^o\d/.test(model)) return 'openai'
  return 'gemini'
}

/** Models that were once offered and no longer are. A saved setting wins over
 *  DEFAULT_MODEL on load, so without this an existing install would sit on a
 *  retired id forever — and keep paying the older, higher output rate. */
export const MODEL_MIGRATIONS: Record<string, string> = {
  'gemini-3.7-flash': 'gemini-3.8-flash',
  'gemini-3.6-flash': 'gemini-3.8-flash',
  'gemini-3.5-flash': 'gemini-3.8-flash',
  'gemini-3-flash': 'gemini-3.8-flash',
  'gemini-3-pro': 'gemini-3.1-pro-preview',
}

/** Thinking effort, in the three levels every provider understands: Gemini's
 *  thinking_level, OpenAI's reasoning effort and Claude's output effort all
 *  take low/medium/high. (`minimal`, a Gemini 3.6-ism, errors on 3.8.) */
export type ThinkingLevel = 'low' | 'medium' | 'high'
/** Thinking effort per phase. `low` suits the agentic loops — few steps per
 *  decision; the one-shot document analysis gets `high`, and review edits sit
 *  in between. Provider defaults differ, so every call sets the level. */
export const THINKING_BY_PHASE = {
  mapping: 'high',
  generating: 'low',
  reflecting: 'medium',
  followUp: 'low',
} as const satisfies Record<string, ThinkingLevel>

export type ThinkingPhase = keyof typeof THINKING_BY_PHASE
export type EffortPlan = Partial<Record<ThinkingPhase, ThinkingLevel>>

/** Where a model's own tuning beats the shared plan. Level names do not mean
 *  the same amount of thinking across providers, and nothing above `high`
 *  is used: xhigh/max wait minutes for a first token on a long prompt.
 *  Empty on evidence (models.eval.test.ts, 2026-10-19): one level deeper in
 *  the loops gave GPT-6 Luna nothing at +50% time, and Claude Haiku 5.5 two
 *  points of page coverage at +30% time. */
export const EFFORT_BY_MODEL: Record<string, EffortPlan> = {}

export function effortFor(model: string, phase: ThinkingPhase): ThinkingLevel {
  return EFFORT_BY_MODEL[model]?.[phase] ?? THINKING_BY_PHASE[phase]
}

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com'
/** Pins the May-2026 Interactions API schema (`steps` timeline) — required
 *  when not going through an official SDK. Still the current revision for
 *  3.8 Flash; the model bump introduced no new one. */
export const GEMINI_API_REVISION = '2026-05-20'

/** Output ceiling per Claude turn. Generous because thinking counts against
 *  it; the request streams, so a long turn cannot hit an HTTP timeout. */
export const ANTHROPIC_MAX_TOKENS = 64_000

// --- Retry -----------------------------------------------------------------

export const RATE_LIMIT_MAX_RETRIES = 5
export const RETRY_BASE_DELAY_MS = 2000
export const RETRY_MAX_DELAY_MS = 60_000
export const UPLOAD_MAX_RETRIES = 3
/** How long to poll a freshly uploaded file for ACTIVE state. */
export const FILE_ACTIVE_TIMEOUT_MS = 120_000

// --- Pricing (USD per million tokens) --------------------------------------
// Approximate — shown to the user as an estimate only. Output prices include
// thinking tokens, which every provider bills as output.
// Retired ids stay listed so a saved run's recorded cost still resolves.

export interface ModelPrice {
  input: number
  output: number
  /** Cache reads, as a fraction of the input rate. */
  cacheRead?: number
  /** Cache writes, as a fraction of the input rate. */
  cacheWrite?: number
  /** A request whose prompt is longer than `aboveTokens` pays these rates
   *  on the whole request, not just the part above the line. */
  longPrompt?: { aboveTokens: number; input: number; output: number }
}

const gemini = (input: number, output: number): ModelPrice => ({ input, output })

export const MODEL_PRICING: Record<string, ModelPrice> = {
  // Introductory rate through 2026-12-31; doubles to 1.5/7.5 on 2027-01-01.
  'gemini-3.8-flash': gemini(0.75, 3.75),
  'gemini-3.7-flash': gemini(0.75, 3.75),
  'gemini-3.6-flash': gemini(1.5, 7.5),
  'gemini-3.5-flash': gemini(1.5, 9.0),
  'gemini-3.5-flash-lite': gemini(0.3, 2.5),
  'gemini-3.1-pro-preview': gemini(2.0, 12.0),
  'gemini-3-pro': gemini(2.0, 12.0),
  'gemini-3-flash': gemini(0.5, 3.0),
  'gemini-2.5-pro': gemini(1.25, 10.0),
  'gemini-2.5-flash': gemini(0.3, 2.5),
  'gpt-6-luna': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.1,
    longPrompt: { aboveTokens: 272_000, input: 0.2, output: 0.75 },
  },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.1,
    cacheWrite: 1.25,
    // A lecture PDF with its page images usually crosses this line.
    longPrompt: { aboveTokens: 100_000, input: 0.5, output: 2.5 },
  },
  'claude-sonnet-5-5': { input: 2.0, output: 10.0, cacheRead: 0.1, cacheWrite: 1.25 },
  default: { input: 0.5, output: 4.0, cacheRead: 0.1 },
}

export const ESTIMATION_TOKENS_PER_PDF_PAGE = 560
export const ESTIMATION_TOKENS_PER_CARD = 100
export const ESTIMATION_BASE_OUTPUT_RATIO = 0.2

// --- Defaults for user settings --------------------------------------------

export const DEFAULT_SETTINGS = {
  model: DEFAULT_MODEL,
  cardDensity: 'standard',
  ankiUrl: 'http://localhost:8765',
  useLecternNoteTypes: true,
  noteTypeTheme: 'paper',
  basicModelName: 'Basic',
  clozeModelName: 'Cloze',
  tagTemplate: '{{deck}}::{{slide_set}}::{{topic}}',
  defaultTag: 'lectern',
  enableDefaultTag: true,
  notifyOnFinish: true,
} as const
