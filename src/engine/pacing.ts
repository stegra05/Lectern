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
  IMAGE_CARD_WEIGHT,
  MIN_TOTAL_CARDS,
  SCRIPT_BASE_CHARS,
  SCRIPT_CHARS_PER_CONCEPT,
} from './config'
import type { ContentMode, PdfInfo, SizingPlan } from './types'

export function detectContentMode(pdfInfo: PdfInfo): ContentMode {
  const charsPerPage = pdfInfo.pageCount > 0 ? pdfInfo.textChars / pdfInfo.pageCount : 0
  return charsPerPage >= DENSE_THRESHOLD_CHARS_PER_PAGE ? 'script' : 'slides'
}

export interface SizingOptions {
  /** Explicit user override for the total card cap. */
  userTargetCards?: number
  /** Force slides/script instead of the chars-per-page heuristic. */
  forceMode?: ContentMode
}

export function computeSizingPlan(pdfInfo: PdfInfo, opts: SizingOptions = {}): SizingPlan {
  const contentMode = opts.forceMode ?? detectContentMode(pdfInfo)

  let totalCardCap: number
  if (opts.userTargetCards !== undefined) {
    totalCardCap = Math.max(1, Math.round(opts.userTargetCards))
  } else if (contentMode === 'script') {
    totalCardCap = Math.max(
      MIN_TOTAL_CARDS,
      Math.round(pdfInfo.textChars / SCRIPT_BASE_CHARS + pdfInfo.imageCount * IMAGE_CARD_WEIGHT),
    )
  } else {
    totalCardCap = Math.max(MIN_TOTAL_CARDS, Math.round(pdfInfo.pageCount * CARDS_PER_SLIDE_TARGET))
  }

  // Batch size is a fraction of the cap, clamped to a sane per-round range.
  const batchSize = Math.min(
    DYNAMIC_MAX_NOTES_PER_BATCH,
    Math.max(DYNAMIC_MIN_NOTES_PER_BATCH, Math.round(totalCardCap * DYNAMIC_BATCH_TARGET_RATIO)),
  )

  return { contentMode, totalCardCap, batchSize }
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
