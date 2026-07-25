/**
 * The prompt library, written for the Gemini 3.x generation. Official 3.x
 * guidance: concise direct instructions, goals stated positively, no
 * chain-of-thought coaching (thinking_level does that), steering through
 * mission briefs rather than per-round pressure. Sampling knobs are not part
 * of the toolkit — temperature/top_p/top_k are deprecated from 3.6 on, so
 * tone, length and format are steered from the instructions below.
 *
 * The constraints themselves (MathJax delimiters, HTML-not-Markdown, cloze
 * limits, self-containment, grounding metadata) describe the Anki renderer
 * and the deterministic gate — they survive any prompt rewrite.
 */

// --- Formatting rules (constraints of the Anki renderer) --------------------

export const FORMATTING_RULES = `Formatting — Anki renders HTML and MathJax; Markdown renders as literal characters:
- Math: inline \\( ... \\), display \\[ ... \\]. Never $ ... $ — Anki prints the dollars. Bold math with \\mathbf{...}/\\boldsymbol{...} (symbols) or \\textbf{...} (words); keep HTML outside math.
- Emphasis: <b> or <strong>, <i> or <em>. Write ** or # as HTML instead. Lists are <ul>/<ol>, never "- " lines.
- Text only — cards carry no images or <img> tags.
- Each card stands alone: name the thing itself ("the sigmoid saturates for large inputs"), never point at the source ("as shown in the diagram"). When a concept depends on a visual, describe the visual relationship in words.
- Cloze: at most 2 deletions per card, each a single specific term whose surrounding context makes the answer unambiguous. Exception — ordered procedures: an <ol> with one numbered deletion per step ({{c1::…}}, {{c2::…}}, …), so each step drills as its own card.
- A deletion ends at the first "}}", so an answer whose math ends in nested braces must not close them next to the deletion: write {{c1::\\(e^{-x^{2}} \\) }}, not {{c1::\\(e^{-x^{2}}\\)}} — otherwise Anki cuts the answer in half.`

// --- Style-teaching examples -------------------------------------------------

const CARD_DATA = [
  {
    model_name: 'Basic',
    fields: [
      {
        name: 'Front',
        value: 'Loss oscillates wildly during training. What is the most likely cause?',
      },
      {
        name: 'Back',
        value: '<b>Learning rate is too high</b>. The steps overshoot the minimum.',
      },
    ],
    slide_topic: 'Optimization Dynamics',
  },
  {
    model_name: 'Basic',
    fields: [
      { name: 'Front', value: 'State the quadratic formula.' },
      {
        name: 'Back',
        value: 'Key idea: <b>roots</b>. Formula: \\(x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\\).',
      },
    ],
    slide_topic: 'Quadratic Equations',
  },
  {
    model_name: 'Cloze',
    fields: [{ name: 'Text', value: 'The derivative of \\(x^n\\) is {{c1::\\(n x^{n-1}\\)}}.' }],
    slide_topic: 'Differentiation Rules',
  },
  {
    model_name: 'Cloze',
    fields: [
      {
        name: 'Text',
        value:
          'One gradient-descent training iteration, in order:<ol><li>{{c1::Forward pass}}</li><li>{{c2::Compute the loss}}</li><li>{{c3::Backpropagate gradients}}</li><li>{{c4::Update the weights}}</li></ol>',
      },
    ],
    slide_topic: 'Training Neural Networks',
  },
]

export const CARD_EXAMPLES =
  'Style examples:\n' +
  CARD_DATA.map((ex) => `  ${ex.model_name}: ${JSON.stringify(ex)}`).join('\n') +
  '\n'

// --- Focus prompt sanitizing (prompt-injection hardening) -------------------

/** The focus note rides along in the system instructions of every call, so
 *  its length is paid per round — but at ~150 tokens a full field that is
 *  noise next to the document itself, and users write real briefs here
 *  ("chapters 3-5, definitions and proofs, skip the historical asides"). */
export const MAX_FOCUS_PROMPT_LEN = 600
/** Follow-up chat requests are sent once, so they get more room still. */
export const MAX_REQUEST_PROMPT_LEN = 1000
const BLOCKED_FRAGMENTS = ['system:', 'assistant:', 'user:', 'ignore previous instructions']

export function sanitizeFocusPrompt(value: string, maxLen: number = MAX_FOCUS_PROMPT_LEN): string {
  let s = (value ?? '')
    .trim()
    // Line breaks stay out — they would let a pasted note fake a turn
    // boundary. They become separators rather than plain spaces so a pasted
    // list keeps its item boundaries ("definitions\nproofs" is two things).
    .replace(/\s*[\r\n]+\s*/g, '; ')
    .replace(/`/g, '')
    .replace(/"/g, "'")
  s = s.split(/\s+/).join(' ')
  for (const blocked of BLOCKED_FRAGMENTS) {
    const pattern = new RegExp(blocked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    s = s.replace(pattern, '')
  }
  s = s.split(/\s+/).join(' ')
  return s.slice(0, maxLen).trim()
}

// --- Prompt builder ---------------------------------------------------------

export interface PromptContext {
  language: string
  focusPrompt?: string
}

const focusOf = (ctx: PromptContext): string =>
  ctx.focusPrompt ? sanitizeFocusPrompt(ctx.focusPrompt) : ''

/** System instructions for the whole session. */
export function systemInstructions(ctx: PromptContext): string {
  const focus = focusOf(ctx)
  return (
    `You are an expert educator turning lecture material into an Anki spaced-repetition deck.\n` +
    `Write all card content in ${ctx.language}.\n` +
    (focus
      ? `The user asked to focus on: "${focus}". Weight concept selection and card style toward it.\n`
      : '') +
    `Card principles: one idea per card; vary styles across definitions, comparisons, and applications; test understanding (why, how, apply) over slide recall.\n` +
    `${FORMATTING_RULES}\n` +
    CARD_EXAMPLES
  )
}

/** Phase 1 — global concept map over the whole document. */
export function conceptMapPrompt(ctx: PromptContext): string {
  const focus = focusOf(ctx)
  return (
    'Analyze the attached lecture document and build its global concept map.\n' +
    (focus ? `Give extra depth to concepts related to the user focus: "${focus}".\n` : '') +
    'Return JSON with:\n' +
    '- objectives: explicit learning goals plus the implicit competency targets.\n' +
    '- concepts: the core entities, theories, and definitions, fundamentals first. Each carries a stable short unique id, importance (high|medium|low, judged against the objectives), difficulty (foundational|intermediate|advanced), and page_references (integer pages where it is taught or illustrated).\n' +
    '- relations: the semantic structure between concepts (is_a, part_of, causes, contrasts_with, ...) with page_references.\n' +
    "- language: ISO 639-1 code of the document's primary language.\n" +
    '- slide_set_name: Title Case name for this set, max 8 words, keeping any lecture/week number.\n' +
    '- page_count and estimated_text_chars: integers, used for deck sizing.\n' +
    '- document_type: slides, script, or mixed.\n' +
    'Text fields use HTML, never Markdown.'
  )
}

/** Phase 2 — the mission brief that opens the agentic generation loop. */
export function generationMissionPrompt(
  ctx: PromptContext,
  opts: {
    totalCardCap: number
    batchSize: number
    gapText: string
    /** Extend runs: what the target deck already teaches. */
    existingDeck?: { count: number; topics: string[]; truncated: number }
    /** The deck already covers the document — this run adds depth, not breadth. */
    depthMode?: boolean
  },
): string {
  const focus = focusOf(ctx)
  const existing = opts.existingDeck
  const existingBrief =
    existing === undefined
      ? ''
      : `\nThis deck already holds ${existing.count} card(s) from earlier runs over this material. ` +
        `They stay exactly as they are — you are adding to them, not replacing them. ` +
        `Their pages are already marked covered in the ledger below, so read it as "what is still missing".\n` +
        `Topics already covered: ${existing.topics.join(', ')}` +
        (existing.truncated > 0 ? `, …and ${existing.truncated} more topic(s) not listed` : '') +
        `.\nA card that repeats one of these is dropped as a duplicate and wastes budget. Go after the gaps.\n`

  // Breadth is spent: say what "more cards" means when every page is covered,
  // or the model reasonably concludes the job is already done.
  const depthBrief = opts.depthMode
    ? `\nThis deck already covers the document end to end, so there is no breadth left to add — your budget buys depth. Depth means: the relations between concepts (how one causes, contrasts with, or builds on another), the sub-points and edge cases of pages that carry a single card, and questions that apply or compare rather than restate. A second card on a page is right when it teaches something the first one does not.\nIf you reach a point where another card would only rephrase one that exists, call finish_generation and say so — a short honest deck beats a padded one.\n`
    : ''

  return (
    `Now build the deck for the document you just mapped. Work in batches: call submit_cards, read the review it returns — accepted/rejected verdicts with reasons plus a coverage ledger of pages, concepts, and relations still lacking cards — and let that drive the next batch. Rework rejected material rather than dropping it.\n` +
    existingBrief +
    depthBrief +
    `\nBudget: ${opts.totalCardCap} accepted cards total. Keep each submit_cards call to about ${opts.batchSize} cards; larger payloads risk truncation.\n` +
    `Coverage order: every high-importance concept first, then breadth across pages. Spend at most 2 cards on one slide while gaps remain elsewhere.\n` +
    (focus ? `User focus: "${focus}" — align card selection and style with it.\n` : '') +
    `Quality bar: the front has exactly one defensible answer (open questions, never yes/no); the answer is verifiable against the card's source_excerpt; prefer why/how/compare/apply over restatement. Use Cloze for definitions and lists (with a {{c1::...}} deletion), Basic for open questions.\n` +
    `Metadata required on every card:\n` +
    `- slide_topic: short section label, Title Case, up to 8 words.\n` +
    `- slide_number: integer page, when confident.\n` +
    `- source_pages: the page numbers grounding the card.\n` +
    `- concept_ids: ids copied exactly from your concept map — unrecognized ids are dropped and earn no coverage.\n` +
    `- relation_keys: "<source>|<type>|<target>" signatures when the card teaches a mapped relation.\n` +
    `- rationale: why the card matters, up to 140 chars.\n` +
    `- source_excerpt: the grounding slide wording or diagram content, up to 220 chars.\n` +
    `When grounding is weak, submit fewer cards.\n` +
    `\nCall finish_generation once the ledger shows the important material is covered or the budget is spent.\n` +
    `\n${opts.gapText}\n` +
    'Start with your first submit_cards call.'
  )
}

/** List entries capped per feedback payload; the cap is always announced so
 *  the model never mistakes a truncated list for the full one. */
const FEEDBACK_LIST_LIMIT = 10

function pushTruncationNote(lines: string[], total: number, shown: number, noun: string): void {
  if (total > shown) lines.push(`  …and ${total - shown} more ${noun} not listed.`)
}

/** Feedback payload returned to the model after each submit_cards call. */
export function buildSubmitFeedback(opts: {
  acceptedCount: number
  rejected: Array<{ front: string; reasons: string[] }>
  duplicateFronts: string[]
  unknownMetadataDropped: number
  cardsRemaining: number
  gapText: string
  finishAllowed: boolean
}): string {
  const lines: string[] = []
  lines.push(
    `Accepted ${opts.acceptedCount} card(s). Rejected ${opts.rejected.length}. Duplicates dropped: ${opts.duplicateFronts.length}.`,
  )
  if (opts.rejected.length > 0) {
    lines.push('Rejected cards (fix and resubmit the underlying content):')
    for (const r of opts.rejected.slice(0, FEEDBACK_LIST_LIMIT)) {
      lines.push(`  - "${r.front.slice(0, 80)}" → ${r.reasons.join(', ')}`)
    }
    pushTruncationNote(lines, opts.rejected.length, FEEDBACK_LIST_LIMIT, 'rejected card(s)')
  }
  if (opts.duplicateFronts.length > 0) {
    lines.push('Duplicates of cards already in the deck (do not resubmit these):')
    for (const front of opts.duplicateFronts.slice(0, FEEDBACK_LIST_LIMIT)) {
      lines.push(`  - "${front.slice(0, 80)}"`)
    }
    pushTruncationNote(lines, opts.duplicateFronts.length, FEEDBACK_LIST_LIMIT, 'duplicate(s)')
  }
  if (opts.unknownMetadataDropped > 0) {
    lines.push(
      `${opts.unknownMetadataDropped} concept_id/relation_key value(s) did not match your concept map and were dropped — copy ids exactly from the map.`,
    )
  }
  lines.push(`Remaining budget: ${opts.cardsRemaining} card(s).`)
  lines.push(opts.gapText)
  lines.push(
    opts.finishAllowed
      ? 'If the ledger shows no important gaps remain, call finish_generation. Otherwise continue with submit_cards.'
      : 'Important gaps remain — continue with submit_cards targeting the ledger items above.',
  )
  return lines.filter(Boolean).join('\n')
}

/** Phase 3 — mission brief for the agentic review loop over the deck. */
export function reviewMissionPrompt(
  ctx: PromptContext,
  opts: {
    deckListing: string
    coverageGaps: string
    cardCap: number
    freeSlots: number
    /** Extend runs: cards inherited from Anki, deliberately absent below. */
    inheritedCount?: number
  },
): string {
  const focus = focusOf(ctx)
  const inherited = opts.inheritedCount ?? 0
  const inheritedNote =
    inherited === 0
      ? ''
      : `\n${inherited} further card(s) from earlier runs are already in this deck. They are not listed below and are not yours to edit — the user is studying them. They do count toward the coverage ledger, so a gap the ledger does not show is not a gap.\n`
  return (
    'The deck is generated. Review it as a quality editor, working through the edit tools:\n' +
    '- update_card: rewrite one card in place — vague fronts, multi-idea cards, answers the source_excerpt cannot back.\n' +
    '- remove_cards: delete redundant or low-value cards. When two overlap, keep the stronger one or merge them via update_card.\n' +
    `- add_cards: close remaining coverage gaps. The deck budget stays ${opts.cardCap} cards (${opts.freeSlots} slot(s) currently free); removing a card frees a slot.\n` +
    '- finish_review: call when the deck is sound, with a short quality summary.\n' +
    '\nEvery edit passes the same quality gate as generation and returns a verdict plus an updated coverage ledger. ' +
    'Leave strong cards untouched — edit only where you can name the defect. ' +
    `All content stays in ${ctx.language}.\n` +
    (focus ? `Check alignment with the user focus: "${focus}".\n` : '') +
    inheritedNote +
    `\n${opts.coverageGaps}\n` +
    `\nDeck under review (card_id → content):\n${opts.deckListing}`
  )
}

/** Post-completion follow-up: the user asked for additional cards in the
 *  activity-log chat. Continues the same conversation, additions only. */
export function followUpRequestPrompt(
  ctx: PromptContext,
  opts: {
    request: string
    deckFronts: string[]
    cardBudget: number
    gapText: string
  },
): string {
  const listing =
    opts.deckFronts.length > 0
      ? opts.deckFronts.map((front) => `- ${front}`).join('\n')
      : '(the deck is currently empty)'
  return (
    `The user reviewed the finished deck and asks for additional cards:\n"${opts.request}"\n\n` +
    `Additions only — the existing deck stays untouched. Call add_cards with the new cards, read the verdicts, and call finish_request with a short summary once the request is served (immediately if it needs no new cards). Add only what the request asks for, up to ${opts.cardBudget} card(s) — no filler.\n` +
    `Every card meets the same quality bar and metadata requirements as before (source_pages, concept_ids copied from the concept map, rationale, source_excerpt).\n` +
    `Ground each card in the document. If the request needs material the document does not contain, still write the card: set in_source=false, leave source_pages empty, and put the knowledge the answer rests on in source_excerpt — the app labels such cards "outside source" for the user to check.\n` +
    `All content stays in ${ctx.language}.\n` +
    `\nCurrent deck fronts (do not duplicate them):\n${listing}\n` +
    `\n${opts.gapText}`
  )
}

/** Feedback payload returned to the model after each follow-up add_cards. */
export function buildFollowUpFeedback(opts: {
  acceptedCount: number
  rejected: Array<{ front: string; reasons: string[] }>
  duplicateFronts: string[]
  cardsRemaining: number
}): string {
  const lines: string[] = []
  lines.push(
    `Accepted ${opts.acceptedCount} card(s). Rejected ${opts.rejected.length}. Duplicates dropped: ${opts.duplicateFronts.length}.`,
  )
  if (opts.rejected.length > 0) {
    lines.push('Rejected cards (fix and resubmit if the request still needs them):')
    for (const r of opts.rejected.slice(0, FEEDBACK_LIST_LIMIT)) {
      lines.push(`  - "${r.front.slice(0, 80)}" → ${r.reasons.join(', ')}`)
    }
    pushTruncationNote(lines, opts.rejected.length, FEEDBACK_LIST_LIMIT, 'rejected card(s)')
  }
  if (opts.duplicateFronts.length > 0) {
    lines.push('Duplicates of cards already in the deck (do not resubmit these):')
    for (const front of opts.duplicateFronts.slice(0, FEEDBACK_LIST_LIMIT)) {
      lines.push(`  - "${front.slice(0, 80)}"`)
    }
    pushTruncationNote(lines, opts.duplicateFronts.length, FEEDBACK_LIST_LIMIT, 'duplicate(s)')
  }
  lines.push(`Remaining request budget: ${opts.cardsRemaining} card(s).`)
  lines.push(
    'Continue with add_cards if the request is not yet served, otherwise call finish_request.',
  )
  return lines.join('\n')
}

/** Feedback payload returned to the model after each review-tool round. */
export function buildReviewFeedback(opts: {
  applied: string[]
  rejected: Array<{ ref: string; reasons: string[] }>
  unknownMetadataDropped: number
  gapText: string
}): string {
  const lines: string[] = []
  if (opts.applied.length > 0) lines.push(`Applied: ${opts.applied.join('; ')}.`)
  if (opts.rejected.length > 0) {
    lines.push('Rejected (card unchanged):')
    for (const r of opts.rejected.slice(0, FEEDBACK_LIST_LIMIT)) {
      lines.push(`  - ${r.ref} → ${r.reasons.join(', ')}`)
    }
    pushTruncationNote(lines, opts.rejected.length, FEEDBACK_LIST_LIMIT, 'rejection(s)')
  }
  if (opts.unknownMetadataDropped > 0) {
    lines.push(
      `${opts.unknownMetadataDropped} concept_id/relation_key value(s) did not match your concept map and were dropped — copy ids exactly from the map.`,
    )
  }
  if (opts.applied.length === 0 && opts.rejected.length === 0) lines.push('No edits applied.')
  lines.push(opts.gapText)
  lines.push('Continue editing where you can name a defect, or call finish_review.')
  return lines.join('\n')
}
