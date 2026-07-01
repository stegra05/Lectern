/**
 * Sizing + pacing — port of the sizing math in LecternApp/lectern/cost_estimator.py
 * (detect_content_mode / estimate_card_cap / derive_effective_target), the hybrid
 * batch-size formula from lectern/application/runners/generation_runner.py, and
 * the per-round pacing hint from lectern/ai_pacing.py.
 */

import {
  CARDS_PER_SLIDE_TARGET,
  DENSE_THRESHOLD_CHARS_PER_PAGE,
  DYNAMIC_BATCH_TARGET_RATIO,
  DYNAMIC_MAX_NOTES_PER_BATCH,
  DYNAMIC_MIN_NOTES_PER_BATCH,
  IMAGE_CARD_WEIGHT,
  MIN_TOTAL_CARDS,
  PAGE_GUARDRAIL_MAX_RATIO,
  PAGE_GUARDRAIL_MIN_FLOOR,
  PAGE_GUARDRAIL_MIN_RATIO,
  SCRIPT_BASE_CHARS,
} from './config'
import type { ContentMode, CoverageData, PdfInfo, SizingPlan } from './types'

// ---------------------------------------------------------------------------
// Content mode (port of detect_content_mode)
// ---------------------------------------------------------------------------

export function detectContentMode(pdfInfo: PdfInfo): ContentMode {
  const charsPerPage = pdfInfo.pageCount > 0 ? pdfInfo.textChars / pdfInfo.pageCount : 0
  return charsPerPage >= DENSE_THRESHOLD_CHARS_PER_PAGE ? 'script' : 'slides'
}

// ---------------------------------------------------------------------------
// Hybrid batch size (port of generation_runner._compute_hybrid_batch_size)
// ---------------------------------------------------------------------------

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max))

/**
 * Target-derived batch (cap * ratio) clamped into the page-derived guardrail
 * [pageCenter * 0.7 .. pageCenter * 1.3] (floor 8), then finally clamped into
 * [DYNAMIC_MIN_NOTES_PER_BATCH .. DYNAMIC_MAX_NOTES_PER_BATCH].
 */
function computeHybridBatchSize(totalCardCap: number, pageCount: number): number {
  const pageCenter = Math.max(0, Math.floor(pageCount / 2))
  const targetBatch =
    totalCardCap > 0 ? Math.round(totalCardCap * DYNAMIC_BATCH_TARGET_RATIO) : pageCenter

  const guardrailMin = Math.max(
    PAGE_GUARDRAIL_MIN_FLOOR,
    Math.round(pageCenter * PAGE_GUARDRAIL_MIN_RATIO),
  )
  const guardrailMax = Math.max(guardrailMin, Math.round(pageCenter * PAGE_GUARDRAIL_MAX_RATIO))

  const hybrid = clamp(targetBatch, guardrailMin, guardrailMax)
  return Math.max(1, clamp(hybrid, DYNAMIC_MIN_NOTES_PER_BATCH, DYNAMIC_MAX_NOTES_PER_BATCH))
}

// ---------------------------------------------------------------------------
// Sizing plan (port of estimate_card_cap + hybrid batch size)
// ---------------------------------------------------------------------------

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

  return {
    contentMode,
    totalCardCap,
    batchSize: computeHybridBatchSize(totalCardCap, pdfInfo.pageCount),
  }
}

// ---------------------------------------------------------------------------
// Pacing hint (port of ai_pacing.PacingState.hint, sans adaptive feedback)
// ---------------------------------------------------------------------------

/**
 * Per-round guidance text: progress, untouched page count, and the current
 * generation density vs. the target density (totalCardCap spread over the
 * document's pages). Returns "" before there is anything meaningful to say
 * (no covered pages yet, or fewer than 5 cards produced) — same warm-up
 * behavior as the Python original.
 */
export function buildPacingHint(
  coverage: CoverageData,
  sizing: SizingPlan,
  producedSoFar: number,
): string {
  const coveredCount = new Set(coverage.coveredPages).size
  if (coveredCount === 0) return ''
  if (producedSoFar < 5) return ''

  const totalPages = coverage.pageCount
  const actualDensity = producedSoFar / coveredCount
  const uncoveredCount = Math.max(totalPages - coveredCount, 0)
  const targetDensity = totalPages > 0 ? sizing.totalCardCap / totalPages : 0

  return (
    `\n- CURRENT PROGRESS: ${coveredCount} covered slides out of ${totalPages}.\n` +
    `- UNTOUCHED SLIDES: ${uncoveredCount}.\n` +
    `- GENERATION DENSITY: ${producedSoFar} cards for ${coveredCount} covered slides ` +
    `(~${actualDensity.toFixed(1)} per covered slide).\n` +
    `- TARGET GOAL: ~${targetDensity.toFixed(1)} cards per slide while spreading coverage across the deck.\n`
  )
}
