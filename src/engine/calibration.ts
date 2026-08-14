/**
 * Estimator calibration — the record of estimated vs. real cost that outlives
 * the session.
 *
 * The up-front estimate (cost.ts) is a heuristic with no ground truth in the
 * loop. Every completed pipeline run *has* the ground truth: the usage totals
 * Gemini reported. This module writes both sides down and turns the history
 * into per-model correction factors the next estimate multiplies in, so the
 * estimator converges on real behaviour instead of staying wrong forever.
 *
 * Only full pipeline runs are recorded: follow-ups and aborted runs were
 * never estimated, so they would poison the ratios.
 *
 * Pure functions + zod schema — no UI imports, no storage. Reading and
 * writing live in `src/lib/calibrationStore.ts`.
 */

import { z } from 'zod'

export const CALIBRATION_VERSION = 1

/** Runs kept in the log. Enough history for stable medians without the file
 *  growing unbounded. */
export const MAX_CALIBRATION_RUNS = 200

/** Same-model runs needed before per-model factors apply; below that, runs
 *  from all models are pooled, and below it again the factor stays 1. */
const MIN_SAMPLES = 3

/** A single wild run (a retry storm, a truncated upload) must not swing the
 *  estimate by an order of magnitude, so each ratio is clamped before the
 *  median is taken. */
const RATIO_MIN = 0.25
const RATIO_MAX = 4

// --- Schema -------------------------------------------------------------------

const tokensAndCostSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
})

const calibrationRunSchema = z.object({
  /** ISO timestamp of the run's completion. */
  at: z.string(),
  model: z.string(),
  // Document facts + the sizing the estimate was computed from, so the
  // heuristic's constants can be re-derived from the log later.
  pageCount: z.number(),
  textChars: z.number(),
  imageCount: z.number(),
  totalCardCap: z.number(),
  batchSize: z.number(),
  /** Cards the run actually produced (the cap is only an upper bound). */
  cardCount: z.number(),
  /** What the user was shown before the run. */
  estimated: tokensAndCostSchema,
  /** What Gemini's usage accounting reported after the run. */
  actual: tokensAndCostSchema,
})

export const calibrationLogSchema = z.object({
  version: z.literal(CALIBRATION_VERSION),
  runs: z.array(calibrationRunSchema),
})

export type CalibrationRun = z.infer<typeof calibrationRunSchema>
export type CalibrationLog = z.infer<typeof calibrationLogSchema>

/** Validate a stored value. Corruption reads as "no log" — the history is an
 *  optimisation, never data worth guarding. */
export function parseCalibrationLog(value: unknown): CalibrationLog | null {
  const result = calibrationLogSchema.safeParse(value)
  return result.success ? result.data : null
}

// --- Recording ----------------------------------------------------------------

/** Fold a completed run into the log, oldest runs falling off the front. */
export function appendCalibrationRun(
  existing: CalibrationLog | null,
  run: CalibrationRun,
): CalibrationLog {
  const runs = [...(existing?.runs ?? []), run].slice(-MAX_CALIBRATION_RUNS)
  return { version: CALIBRATION_VERSION, runs }
}

// --- Correction factors -------------------------------------------------------

export interface CalibrationFactors {
  /** Multiplier for estimated input tokens (median actual/estimated). */
  input: number
  /** Multiplier for estimated output tokens. */
  output: number
  /** Runs the factors were derived from; 0 means uncalibrated (both 1). */
  sampleCount: number
}

export const UNCALIBRATED: CalibrationFactors = { input: 1, output: 1, sampleCount: 0 }

/**
 * Correction factors for the next estimate. Same-model history wins once it
 * has enough runs; a young log pools every model — the heuristic's systematic
 * bias (page weight, rounds) is model-independent enough for a first
 * correction, and per-model factors take over as runs accumulate.
 */
export function calibrationFactors(log: CalibrationLog | null, model: string): CalibrationFactors {
  if (log === null) return UNCALIBRATED
  const usable = log.runs.filter((r) => r.estimated.inputTokens > 0 && r.estimated.outputTokens > 0)
  const sameModel = usable.filter((r) => r.model === model)
  const sample = sameModel.length >= MIN_SAMPLES ? sameModel : usable
  if (sample.length < MIN_SAMPLES) return UNCALIBRATED
  const ratio = (actual: number, estimated: number) =>
    Math.min(RATIO_MAX, Math.max(RATIO_MIN, actual / estimated))
  return {
    input: median(sample.map((r) => ratio(r.actual.inputTokens, r.estimated.inputTokens))),
    output: median(sample.map((r) => ratio(r.actual.outputTokens, r.estimated.outputTokens))),
    sampleCount: sample.length,
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
