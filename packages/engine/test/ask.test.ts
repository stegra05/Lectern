import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { scriptedDecisions, scriptedModel } from '../src/adapters/fake.ts'
import { createAsk, type Meter } from '../src/ask.ts'
import { modelReservation } from '../src/cost.ts'
import type { ModelRequest, Ports } from '../src/ports.ts'

/** A scripted price, in dollars per million tokens. */
const price = { input: 100, cachedInput: 10, output: 400, fast: 2 }
const request: Omit<ModelRequest, 'schema' | 'onUsage'> = {
  task: 'fill',
  system: 'Write one card.',
  context: 'A lecture. '.repeat(400),
  images: [],
  prompt: 'The card for one fact.',
  effort: 'low',
}
const expected = modelReservation(request, price)
const cap = 10.5 * expected

/** Four calls at a time, each lane asking again until the run stops. Every call costs `cost`. */
async function run(cost: number) {
  let running = 0
  let most = 0
  const scripted = scriptedModel(async () => {
    most = Math.max(most, ++running)
    await new Promise((resolve) => setTimeout(resolve, 1))
    running--
    return { ok: true }
  }, cost)
  const ports = {
    model: { ...scripted, price },
    decisions: scriptedDecisions(() => undefined),
  } as unknown as Ports
  const meter: Meter = {
    calls: 0,
    decisions: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  }
  const ask = createAsk(ports, meter, cap)
  const lane = async () => {
    for (;;) await ask.model(request, z.object({ ok: z.boolean() }))
  }
  const lanes = await Promise.allSettled([lane(), lane(), lane(), lane()])
  return { meter, most, lanes }
}

describe('the cap with four calls in parallel', () => {
  it('stops at or below the cap when replies cost what was estimated, and starts no call that could pass it', async () => {
    const { meter, most, lanes } = await run(expected)
    expect(most).toBe(4)
    expect(meter.calls).toBe(10)
    expect(meter.costUsd).toBeLessThanOrEqual(cap)
    for (const lane of lanes) {
      expect(lane.status === 'rejected' && String(lane.reason)).toMatch(
        `as the next call could take it past its cap of ${cap.toFixed(2)} dollars.`,
      )
    }
  })

  it('passes the cap by no more than the excess of the replies in flight when they cost more', async () => {
    const excess = 0.5 * expected
    const { meter, most, lanes } = await run(expected + excess)
    expect(most).toBe(4)
    expect(meter.costUsd).toBeGreaterThan(cap)
    expect(meter.costUsd).toBeLessThanOrEqual(cap + 4 * excess)
    expect(lanes.every((lane) => lane.status === 'rejected')).toBe(true)
  })
})
