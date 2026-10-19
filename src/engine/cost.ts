/**
 * Up-front cost estimation. Deliberately heuristic (no network round-trip):
 * native-PDF pages cost a roughly fixed token budget each, output scales with
 * the planned card count. Shown to the user as an approximation, and
 * corrected by calibration factors learned from past runs (calibration.ts).
 */

import { UNCALIBRATED, type CalibrationFactors } from './calibration'
import {
  ESTIMATION_BASE_OUTPUT_RATIO,
  ESTIMATION_TOKENS_PER_CARD,
  ESTIMATION_TOKENS_PER_PDF_PAGE,
  CACHED_INPUT_PRICE_RATIO,
  MODEL_PRICING,
} from './config'
import type { Usage } from './llm'
import type { PdfInfo, SizingPlan } from './types'

export interface CostEstimate {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export function estimateCost(
  pdfInfo: PdfInfo,
  sizing: SizingPlan,
  model: string,
  factors: CalibrationFactors = UNCALIBRATED,
): CostEstimate {
  // The document is re-read server-side on each agentic round; approximate
  // rounds as cap/batch + mapping + reflection.
  const rounds = Math.max(2, Math.ceil(sizing.totalCardCap / sizing.batchSize) + 2)
  const docTokens =
    pdfInfo.pageCount * ESTIMATION_TOKENS_PER_PDF_PAGE + Math.round(pdfInfo.textChars / 4)
  const inputTokens = Math.round(docTokens * Math.min(rounds, 4) * factors.input)
  const outputTokens = Math.round(
    sizing.totalCardCap *
      ESTIMATION_TOKENS_PER_CARD *
      (1 + ESTIMATION_BASE_OUTPUT_RATIO) *
      2 *
      factors.output,
  )
  const costUsd = costOf(model, { inputTokens, cachedInputTokens: 0, outputTokens })
  return { inputTokens, outputTokens, costUsd }
}

/** What a run's usage cost, in USD. */
export function costOf(model: string, usage: Usage): number {
  const [inPrice, outPrice] = MODEL_PRICING[model] ?? MODEL_PRICING.default
  const freshInput = usage.inputTokens - usage.cachedInputTokens
  return (
    (freshInput * inPrice +
      usage.cachedInputTokens * inPrice * CACHED_INPUT_PRICE_RATIO +
      usage.outputTokens * outPrice) /
    1_000_000
  )
}
