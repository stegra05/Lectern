import { describe, expect, it } from 'vitest'
import {
  appendCalibrationRun,
  CALIBRATION_VERSION,
  calibrationFactors,
  MAX_CALIBRATION_RUNS,
  parseCalibrationLog,
  UNCALIBRATED,
  type CalibrationLog,
  type CalibrationRun,
} from './calibration'

const run = (extra: Partial<CalibrationRun> = {}): CalibrationRun => ({
  at: '2026-08-14T10:00:00.000Z',
  model: 'gemini-3.8-flash',
  pageCount: 30,
  textChars: 12000,
  imageCount: 5,
  totalCardCap: 20,
  batchSize: 10,
  cardCount: 18,
  estimated: { inputTokens: 100_000, outputTokens: 5000, costUsd: 0.1 },
  actual: { inputTokens: 200_000, outputTokens: 10_000, costUsd: 0.2 },
  ...extra,
})

const log = (runs: CalibrationRun[]): CalibrationLog => ({
  version: CALIBRATION_VERSION,
  runs,
})

describe('parseCalibrationLog', () => {
  it('round-trips a valid log', () => {
    const value = log([run()])
    expect(parseCalibrationLog(JSON.parse(JSON.stringify(value)))).toEqual(value)
  })

  it('reads corruption and unknown versions as no log', () => {
    expect(parseCalibrationLog(null)).toBeNull()
    expect(parseCalibrationLog('garbage')).toBeNull()
    expect(parseCalibrationLog({ version: 99, runs: [] })).toBeNull()
    expect(parseCalibrationLog({ version: CALIBRATION_VERSION, runs: [{ at: 1 }] })).toBeNull()
  })
})

describe('appendCalibrationRun', () => {
  it('starts a log from nothing', () => {
    expect(appendCalibrationRun(null, run())).toEqual(log([run()]))
  })

  it('appends and drops the oldest beyond the cap', () => {
    const full = log(Array.from({ length: MAX_CALIBRATION_RUNS }, (_, i) => run({ at: `t${i}` })))
    const appended = appendCalibrationRun(full, run({ at: 'newest' }))
    expect(appended.runs).toHaveLength(MAX_CALIBRATION_RUNS)
    expect(appended.runs[0].at).toBe('t1')
    expect(appended.runs.at(-1)?.at).toBe('newest')
  })
})

describe('calibrationFactors', () => {
  it('is uncalibrated with no log or too few runs', () => {
    expect(calibrationFactors(null, 'gemini-3.8-flash')).toEqual(UNCALIBRATED)
    expect(calibrationFactors(log([run(), run()]), 'gemini-3.8-flash')).toEqual(UNCALIBRATED)
  })

  it('takes the median actual/estimated ratio per side', () => {
    const runs = [
      run({
        estimated: { inputTokens: 100, outputTokens: 100, costUsd: 0 },
        actual: { inputTokens: 100, outputTokens: 50, costUsd: 0 },
      }),
      run({
        estimated: { inputTokens: 100, outputTokens: 100, costUsd: 0 },
        actual: { inputTokens: 200, outputTokens: 80, costUsd: 0 },
      }),
      run({
        estimated: { inputTokens: 100, outputTokens: 100, costUsd: 0 },
        actual: { inputTokens: 300, outputTokens: 110, costUsd: 0 },
      }),
    ]
    const factors = calibrationFactors(log(runs), 'gemini-3.8-flash')
    expect(factors).toEqual({ input: 2, output: 0.8, sampleCount: 3 })
  })

  it('prefers same-model runs once they reach the minimum sample', () => {
    const other = run({
      model: 'gemini-3.1-pro-preview',
      actual: { inputTokens: 400_000, outputTokens: 20_000, costUsd: 0 },
    })
    const runs = [other, other, other, run(), run(), run()]
    // Same-model runs all sit at ratio 2 (input) / 2 (output).
    expect(calibrationFactors(log(runs), 'gemini-3.8-flash')).toEqual({
      input: 2,
      output: 2,
      sampleCount: 3,
    })
    // The pro model has its own three runs at ratio 4 — clamped to 4.
    expect(calibrationFactors(log(runs), 'gemini-3.1-pro-preview')).toEqual({
      input: 4,
      output: 4,
      sampleCount: 3,
    })
  })

  it('pools all models while the same-model history is thin', () => {
    const runs = [run(), run(), run({ model: 'gemini-3.1-pro-preview' })]
    const factors = calibrationFactors(log(runs), 'gemini-3.1-pro-preview')
    expect(factors.sampleCount).toBe(3)
    expect(factors.input).toBe(2)
  })

  it('clamps outlier ratios and skips zero-token estimates', () => {
    const wild = run({
      estimated: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
      actual: { inputTokens: 1_000_000, outputTokens: 0, costUsd: 0 },
    })
    const zero = run({ estimated: { inputTokens: 0, outputTokens: 0, costUsd: 0 } })
    const factors = calibrationFactors(log([wild, wild, wild, zero]), 'gemini-3.8-flash')
    expect(factors).toEqual({ input: 4, output: 0.25, sampleCount: 3 })
  })
})
