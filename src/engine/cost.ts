/**
 * Up-front cost estimation. Deliberately heuristic (no network round-trip):
 * native-PDF pages cost a roughly fixed token budget each, output scales with
 * the planned card count. Shown to the user as an approximation.
 */

import {
  ESTIMATION_BASE_OUTPUT_RATIO,
  ESTIMATION_TOKENS_PER_CARD,
  ESTIMATION_TOKENS_PER_PDF_PAGE,
  GEMINI_PRICING,
} from './config'
import type { PdfInfo, SizingPlan } from './types'

export interface CostEstimate {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export function estimateCost(pdfInfo: PdfInfo, sizing: SizingPlan, model: string): CostEstimate {
  // The document is re-read server-side on each agentic round; approximate
  // rounds as cap/batch + mapping + reflection.
  const rounds = Math.max(2, Math.ceil(sizing.totalCardCap / sizing.batchSize) + 2)
  const docTokens =
    pdfInfo.pageCount * ESTIMATION_TOKENS_PER_PDF_PAGE + Math.round(pdfInfo.textChars / 4)
  const inputTokens = Math.round(docTokens * Math.min(rounds, 4))
  const outputTokens = Math.round(
    sizing.totalCardCap * ESTIMATION_TOKENS_PER_CARD * (1 + ESTIMATION_BASE_OUTPUT_RATIO) * 2,
  )
  const [inPrice, outPrice] = GEMINI_PRICING[model] ?? GEMINI_PRICING.default
  const costUsd = (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000
  return { inputTokens, outputTokens, costUsd }
}
