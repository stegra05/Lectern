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
  MODEL_PRICING,
} from './config'
import { ZERO_USAGE, addUsage, type Usage } from './llm'
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
  // Priced turn by turn, since a long prompt can move a turn into a
  // provider's higher rate. Caching is left out: the estimate errs high.
  const turns = Math.min(rounds, 4)
  const perTurn: Usage = {
    ...ZERO_USAGE,
    inputTokens: Math.round(inputTokens / turns),
    outputTokens: Math.round(outputTokens / turns),
  }
  const costUsd = turnCost(model, perTurn) * turns
  return { inputTokens, outputTokens, costUsd }
}

/** What one turn cost, in USD. Rates depend on the turn's own prompt size,
 *  so a run's cost is the sum of its turns, never one sum priced at once. */
export function turnCost(model: string, usage: Usage): number {
  const price = MODEL_PRICING[model] ?? MODEL_PRICING.default
  const long = price.longPrompt
  const [inRate, outRate] =
    long && usage.inputTokens > long.aboveTokens
      ? [long.input, long.output]
      : [price.input, price.output]
  const fresh = usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens
  return (
    (fresh * inRate +
      usage.cachedInputTokens * inRate * (price.cacheRead ?? 1) +
      usage.cacheWriteTokens * inRate * (price.cacheWrite ?? 1) +
      usage.outputTokens * outRate) /
    1_000_000
  )
}

/** Running usage and cost of a run or a follow-up request. */
export class UsageMeter {
  usage: Usage = ZERO_USAGE
  costUsd = 0

  constructor(private readonly model: string) {}

  add(turn: Usage): void {
    this.usage = addUsage(this.usage, turn)
    this.costUsd += turnCost(this.model, turn)
  }
}
