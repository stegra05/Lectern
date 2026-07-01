/**
 * The prompt library — Lectern's crown jewels, carried over from the original
 * app's battle-tested prompts (LecternApp/lectern/ai_prompts.py) and adapted
 * for the agentic tool loop on Gemini 3.5 Flash: instead of re-prompting each
 * batch, the model works one continuous conversation and receives coverage
 * feedback through submit_cards tool results.
 */

// --- Formatting rules (verbatim from the original — load-bearing) ----------

export const FORMATTING_RULES = `- Use LaTeX/MathJax for math: inline \\( ... \\), display \\[ ... \\].
- Use HTML for non-math emphasis: <b>...</b> or <strong>...</strong>; italics with <i>...</i> or <em>...</em>.
- For math bold: \\textbf{...} (text), \\mathbf{...} or \\boldsymbol{...} (symbols). Do not use HTML inside math.
- Never use Markdown (no **bold**, headers, or code fences).
- Do not include images, <img> tags, or Markdown image syntax in card content.
- Cards MUST be completely self-contained. NEVER use phrases like 'in the diagram', 'on this slide', or 'as shown'. If a concept relies on a visual, describe the visual's relationship explicitly in text.
- Cloze constraints: Maximum 2 deletions per card. Never cloze entire phrases or sentences—only single, highly specific terms. Ensure the surrounding context gives a clear, unambiguous clue.`

// --- Few-shot card examples (verbatim content, tool-call arg shape) --------

const CARD_DATA = [
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
    fields: [
      { name: 'Text', value: 'The derivative of \\(x^n\\) is {{c1::\\(n x^{n-1}\\)}}.' },
    ],
    slide_topic: 'Differentiation Rules',
  },
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
      { name: 'Front', value: 'Compare <b>L1</b> and <b>L2</b> regularization effects.' },
      {
        name: 'Back',
        value:
          '<b>L1</b>: Yields sparse weights (feature selection).\n<b>L2</b>: Shrinks all weights uniformly (prevents overfitting).',
      },
    ],
    slide_topic: 'Regularization',
  },
]

export const CARD_EXAMPLES =
  'Examples:\n' +
  CARD_DATA.map((ex) => `  ${ex.model_name}: ${JSON.stringify(ex)}`).join('\n') +
  '\n'

// --- Focus prompt sanitizing (prompt-injection hardening) -------------------

const MAX_FOCUS_PROMPT_LEN = 180
const BLOCKED_FRAGMENTS = ['system:', 'assistant:', 'user:', 'ignore previous instructions']

export function sanitizeFocusPrompt(value: string): string {
  let s = (value ?? '')
    .replace(/[\r\n]/g, ' ')
    .replace(/`/g, '')
    .replace(/"/g, "'")
  s = s.split(/\s+/).join(' ')
  for (const blocked of BLOCKED_FRAGMENTS) {
    const pattern = new RegExp(blocked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    s = s.replace(pattern, '')
  }
  s = s.split(/\s+/).join(' ')
  return s.slice(0, MAX_FOCUS_PROMPT_LEN).trim()
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
  const focusContext = focus
    ? `USER FOCUS: "${focus}"\nInstruction: Prioritize concepts related to this focus. Adjust card styles (e.g. more definitions vs. comparisons) to match the user's intent.\n`
    : ''
  return (
    `You are an expert educator creating Anki flashcards.\n` +
    `Output language: ${ctx.language}\n` +
    focusContext +
    `Goal: Create a comprehensive spaced repetition deck.\n` +
    `Principles: Atomicity, Minimum Information Principle, Variety (Definitions, Comparisons, Applications).\n` +
    `Formatting:\n${FORMATTING_RULES}\n` +
    CARD_EXAMPLES
  )
}

/** Phase 1 — global concept map over the whole document. */
export function conceptMapPrompt(ctx: PromptContext): string {
  const focus = focusOf(ctx)
  const focusContext = focus
    ? `- Focus: USER REQUESTED "${focus}". Ensure concepts relevant to this focus are prioritized and detailed.\n`
    : ''
  return (
    'You are an expert educator and knowledge architect. Analyze the following lecture slides to construct a comprehensive global concept map.\n' +
    focusContext +
    '- Objectives: Extract explicit learning goals and implicit competency targets.\n' +
    '- Concepts: Identify the core entities, theories, and definitions. Prioritize *fundamental* concepts. Assign stable, short, unique IDs.\n' +
    '- For each concept add:\n' +
    '    - `importance`: one of `high`, `medium`, `low` based on lecture objectives.\n' +
    '    - `difficulty`: one of `foundational`, `intermediate`, `advanced` based on cognitive load.\n' +
    '    - `page_references`: integer slide/page numbers where the concept is taught or illustrated.\n' +
    '- Relations: Map the *semantic structure* (e.g., `is_a`, `part_of`, `causes`, `contrasts_with`). Note page references using `page_references`.\n' +
    "- Language: Detect the primary language of the slides (e.g. 'en', 'de', 'fr'). Return the ISO 639-1 code.\n" +
    "- Slide Set Name: Generate a semantic name for this slide set (e.g., 'Lecture 2 Introduction To Machine Learning'). Use Title Case, max 8 words. Include lecture/week number if present.\n" +
    '- Metadata: Estimate `page_count` (integer) and `estimated_text_chars` (integer) for pacing calculations.\n' +
    '- Metadata: Return `document_type` as one of `slides`, `script`, or `mixed`.\n' +
    '- Formatting: STRICTLY AVOID Markdown in text fields. Use HTML.\n' +
    'Return ONLY a JSON object with keys: objectives, concepts, relations, language, slide_set_name, page_count, estimated_text_chars, document_type. No prose.'
  )
}

/** Phase 2 — the mission brief that opens the agentic generation loop. */
export function generationMissionPrompt(
  ctx: PromptContext,
  opts: {
    totalCardCap: number
    batchSize: number
    gapText: string
    pacingHint: string
  },
): string {
  const focus = focusOf(ctx)
  const focusInstruction = focus
    ? `- User Focus: "${focus}". Ensure generated cards align with this goal (e.g. if asking for definitions, prefer Cloze/Basic defs).\n`
    : ''
  return (
    `Now create the flashcard deck for the document you just analyzed. You are working agentically: submit cards in batches by calling the submit_cards tool, and after every call you will receive a machine-generated review — accepted/rejected verdicts with reasons, plus an updated COVERAGE LEDGER showing which pages, concepts and relations still lack cards. Use that feedback to plan your next batch: fix what was rejected (do not silently drop rejected material), then close the highest-priority gaps.\n` +
    `\nBudget: at most ${opts.totalCardCap} accepted cards in total. Aim for roughly ${opts.batchSize} cards per submit_cards call.\n` +
    `Language: Ensure all content is in ${ctx.language}.\n` +
    '- Principles:\n' +
    '    - Atomicity: One idea per card.\n' +
    '    - Variety: Mix Definitions, Comparisons, Applications.\n' +
    '    - Breadth-first coverage: cover every HIGH importance concept before deepening already-covered clusters.\n' +
    '    - Anti-clustering: do not spend more than 2 cards on one slide/topic while higher-priority gaps remain elsewhere.\n' +
    focusInstruction +
    '- Format:\n' +
    '    - Prefer Cloze for definitions/lists. Basic for open-ended questions.\n' +
    '    - STRICTLY AVOID Markdown. Use HTML for formatting.\n' +
    '- Per-card metadata (required for acceptance):\n' +
    '    - `slide_topic` (short section/topic label, Title Case, ideally <= 8 words).\n' +
    '    - `slide_number` when confident (integer page number).\n' +
    '    - `source_pages`: array of grounded page numbers for the card.\n' +
    '    - `concept_ids`: array of concept IDs from your concept map that this card covers.\n' +
    '    - `relation_keys`: array of `<source>|<type>|<target>` relation signatures when the card teaches a relation from the concept map.\n' +
    '    - `rationale`: concise reason the card matters (max 140 chars).\n' +
    '    - `source_excerpt`: concise excerpt grounded in the slide wording or diagram content (max 220 chars).\n' +
    '    - If grounding is weak, emit fewer cards rather than inventing unsupported details.\n' +
    `\nWhen — and only when — the coverage ledger shows the important concepts and pages are exhausted, or the budget is spent, call finish_generation with a short coverage assessment. Do not finish while HIGH importance concepts remain uncovered and budget remains.\n` +
    `\n${opts.pacingHint}\n${opts.gapText}\n` +
    'Begin by calling submit_cards with your first batch.'
  )
}

/** Feedback payload returned to the model after each submit_cards call. */
export function buildSubmitFeedback(opts: {
  acceptedCount: number
  rejected: Array<{ front: string; reasons: string[] }>
  duplicates: number
  cardsRemaining: number
  gapText: string
  pacingHint: string
  finishAllowed: boolean
}): string {
  const lines: string[] = []
  lines.push(
    `Accepted ${opts.acceptedCount} card(s). Rejected ${opts.rejected.length}. Duplicates dropped: ${opts.duplicates}.`,
  )
  if (opts.rejected.length > 0) {
    lines.push('Rejected cards (fix and resubmit the underlying content):')
    for (const r of opts.rejected.slice(0, 10)) {
      lines.push(`  - "${r.front.slice(0, 80)}" → ${r.reasons.join(', ')}`)
    }
  }
  lines.push(`Remaining budget: ${opts.cardsRemaining} card(s).`)
  lines.push(opts.pacingHint)
  lines.push(opts.gapText)
  lines.push(
    opts.finishAllowed
      ? 'If the ledger shows no important gaps remain, call finish_generation. Otherwise continue with submit_cards.'
      : 'Important gaps remain — continue with submit_cards targeting the ledger items above.',
  )
  return lines.filter(Boolean).join('\n')
}

/** Phase 3 — reflection / QA pass. */
export function reflectionPrompt(
  ctx: PromptContext,
  opts: { limit: number; cardsJson: string; coverageGaps: string },
): string {
  const focus = focusOf(ctx)
  const focusContext = focus ? `- Check alignment with user focus: "${focus}"\n` : ''
  return (
    'You are a Quality Assurance Specialist. Review the provided cards and refine them.\n' +
    'Critique Criteria:\n' +
    '    - Redundancy: Duplicate/overlapping? Merge them.\n' +
    '    - Vagueness: Ambiguous? Clarify them.\n' +
    '    - Complexity: Too long? Split them.\n' +
    '    - Distribution: If coverage is clustered, replace low-value cards with missing high-priority coverage.\n' +
    '    - Grounding: Preserve or improve `source_pages`, `slide_number`, and `concept_ids`.\n' +
    '    - Provenance: Preserve or improve `rationale`, `source_excerpt`, and `relation_keys`.\n' +
    focusContext +
    `${opts.coverageGaps}\n` +
    'Action:\n' +
    '    - Write a concise `reflection` on the quality of these cards.\n' +
    '    - Rewrite the cards applying your critique. Add gap-filling cards if necessary.\n' +
    '    - Keep strong cards when they already meet the criteria; do not rewrite purely for style.\n' +
    '    - Return the best refined set of cards for this batch, with improved metadata.\n' +
    `Language: Ensure all content is in ${ctx.language}.\n` +
    `\nCards to Refine:\n${opts.cardsJson}\n` +
    `Return ONLY JSON: {reflection, cards, done}. Limit ${opts.limit} cards.`
  )
}
