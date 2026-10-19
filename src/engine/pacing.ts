/**
 * Deck sizing: detect whether the document reads like slides or a dense
 * script, derive the total card cap from that, and suggest a per-round batch
 * size. Per-round pacing feedback lives in the coverage ledger (coverage.ts),
 * not here.
 */

import {
  CARDS_PER_SLIDE_TARGET,
  CONCEPT_COUNT_CEILING,
  CONCEPT_COUNT_FLOOR,
  CONCEPT_TARGET_MIN_SHARE,
  DENSE_THRESHOLD_CHARS_PER_PAGE,
  DYNAMIC_BATCH_TARGET_RATIO,
  DYNAMIC_MAX_NOTES_PER_BATCH,
  DYNAMIC_MIN_NOTES_PER_BATCH,
  BUDGET_GUARD_MAX,
  BUDGET_GUARD_MIN,
  DENSITY_FACTOR,
  IMAGE_CARD_WEIGHT,
  MIN_TOTAL_CARDS,
  SCRIPT_BASE_CHARS,
  SCRIPT_CHARS_PER_CONCEPT,
} from './config'
import type { CardDensity, ConceptMap, ContentMode, PdfInfo, SizingPlan } from './types'

export function detectContentMode(pdfInfo: PdfInfo): ContentMode {
  const charsPerPage = pdfInfo.pageCount > 0 ? pdfInfo.textChars / pdfInfo.pageCount : 0
  return charsPerPage >= DENSE_THRESHOLD_CHARS_PER_PAGE ? 'script' : 'slides'
}

export interface SizingOptions {
  density?: CardDensity
  /** Force slides/script instead of the chars-per-page heuristic. */
  forceMode?: ContentMode
  /** The concept budgets' sum at this density, once the concept map exists.
   *  Without it (before a run) the plan is the heuristic's estimate. */
  budgetSum?: number
  /** Extend runs: the budget sum is what the deck still lacks, and a deck
   *  that lacks little gets little: one card at the least. */
  extending?: boolean
}

/** The deck the document's length suggests, before anyone has read it. */
function heuristicCards(pdfInfo: PdfInfo, contentMode: ContentMode): number {
  const cards =
    contentMode === 'script'
      ? pdfInfo.textChars / SCRIPT_BASE_CHARS + pdfInfo.imageCount * IMAGE_CARD_WEIGHT
      : pdfInfo.pageCount * CARDS_PER_SLIDE_TARGET
  return Math.max(MIN_TOTAL_CARDS, Math.round(cards))
}

/** How far the budget sum may stray from the heuristic at this density. */
export function deckBounds(
  pdfInfo: PdfInfo,
  density: CardDensity = 'standard',
  forceMode?: ContentMode,
): { min: number; max: number } {
  const contentMode = forceMode ?? detectContentMode(pdfInfo)
  const expected = heuristicCards(pdfInfo, contentMode) * DENSITY_FACTOR[density]
  const min = Math.max(MIN_TOTAL_CARDS, Math.round(expected * BUDGET_GUARD_MIN))
  return { min, max: Math.max(min, Math.round(expected * BUDGET_GUARD_MAX)) }
}

export function computeSizingPlan(pdfInfo: PdfInfo, opts: SizingOptions = {}): SizingPlan {
  const contentMode = opts.forceMode ?? detectContentMode(pdfInfo)
  const density = opts.density ?? 'standard'
  const bounds = deckBounds(pdfInfo, density, contentMode)
  const clamp = (n: number, min: number) => Math.min(bounds.max, Math.max(min, Math.round(n)))

  const totalCardCap =
    opts.budgetSum === undefined
      ? Math.max(
          MIN_TOTAL_CARDS,
          Math.round(heuristicCards(pdfInfo, contentMode) * DENSITY_FACTOR[density]),
        )
      : clamp(opts.budgetSum, opts.extending === true ? 1 : bounds.min)

  // Batch size is a fraction of the cap, clamped to a sane per-round range.
  const batchSize = Math.min(
    DYNAMIC_MAX_NOTES_PER_BATCH,
    Math.max(DYNAMIC_MIN_NOTES_PER_BATCH, Math.round(totalCardCap * DYNAMIC_BATCH_TARGET_RATIO)),
  )

  return { contentMode, totalCardCap, batchSize }
}

/**
 * Cards each concept should get at a density. Overview keeps the essentials:
 * low-importance concepts drop out and the rest are halved, never below one.
 */
export function allocateBudgets(conceptMap: ConceptMap, density: CardDensity): Map<string, number> {
  const budgets = new Map<string, number>()
  for (const concept of conceptMap.concepts) {
    const skipped = density === 'overview' && concept.importance === 'low'
    budgets.set(
      concept.id.trim(),
      skipped ? 0 : Math.max(1, Math.round(concept.cardBudget * DENSITY_FACTOR[density])),
    )
  }
  return budgets
}

/**
 * How many concepts the concept map should hold, from the amount of material,
 * so a model that splits finely and one that groups broadly describe the same
 * lecture at the same grain. Neither the deck size nor the user's own card
 * target moves it: the map describes the document, and a small deck simply
 * covers less of it.
 */
export function conceptTarget(pdfInfo: PdfInfo): { min: number; max: number } {
  const natural =
    detectContentMode(pdfInfo) === 'script'
      ? pdfInfo.textChars / SCRIPT_CHARS_PER_CONCEPT
      : pdfInfo.pageCount * CARDS_PER_SLIDE_TARGET
  const clamp = (n: number) =>
    Math.min(CONCEPT_COUNT_CEILING, Math.max(CONCEPT_COUNT_FLOOR, Math.round(n)))
  return { min: clamp(natural * CONCEPT_TARGET_MIN_SHARE), max: clamp(natural) }
}
