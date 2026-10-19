import { describe, expect, it } from 'vitest'

import { UsageMeter, turnCost } from './cost'
import { ZERO_USAGE } from './llm'

const turn = (input: number, output: number, cached = 0, written = 0) => ({
  ...ZERO_USAGE,
  inputTokens: input,
  outputTokens: output,
  cachedInputTokens: cached,
  cacheWriteTokens: written,
})

describe('turnCost', () => {
  it('prices a short Haiku prompt at the base rate', () => {
    // 50K in at $0.10, 1K out at $0.50.
    expect(turnCost('claude-haiku-5-5', turn(50_000, 1_000))).toBeCloseTo(0.0055, 6)
  })

  it('moves the whole request to the long-prompt rate once the prompt crosses the line', () => {
    // 150K in at $0.50, 1K out at $2.50: the first 100K are not cheaper.
    expect(turnCost('claude-haiku-5-5', turn(150_000, 1_000))).toBeCloseTo(0.0775, 6)
  })

  it('discounts cache reads and charges the premium on cache writes', () => {
    // 150K prompt: 120K read at 10%, 20K written at 125%, 10K fresh, at $0.50.
    const cost = turnCost('claude-haiku-5-5', turn(150_000, 0, 120_000, 20_000))
    expect(cost).toBeCloseTo((10_000 * 0.5 + 120_000 * 0.05 + 20_000 * 0.625) / 1e6, 9)
  })

  it('leaves Gemini at a flat rate', () => {
    expect(turnCost('gemini-3.8-flash', turn(1_000_000, 0))).toBeCloseTo(0.75, 6)
  })
})

describe('UsageMeter', () => {
  it('prices every turn by its own size', () => {
    const meter = new UsageMeter('claude-haiku-5-5')
    meter.add(turn(50_000, 0))
    meter.add(turn(150_000, 0))
    expect(meter.usage.inputTokens).toBe(200_000)
    // Priced as one 200K turn this would be $0.10; turn by turn it is less.
    expect(meter.costUsd).toBeCloseTo(0.005 + 0.075, 6)
  })
})
