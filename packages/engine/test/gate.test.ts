import { describe, expect, it } from 'vitest'
import { answerLengths, gate, type Build } from '../eval/bench/gate.ts'

const build = (coverage: number, change: Partial<Build> = {}): Build => ({
  coverage,
  cards: 660,
  answerWords: 10,
  answerWordsP90: 20,
  calls: 950,
  outputTokens: 285_000,
  ...change,
})
// Three builds of one code, as measured on 2026-11-16.
const old = [0.46, 0.531, 0.49].map((coverage) => build(coverage))

describe('the gate of a change', () => {
  it('calls a change better only above what builds of the same code differ by', () => {
    const small = gate(
      old,
      [0.5, 0.56, 0.52].map((c) => build(c)),
    )
    expect(small.verdict).toBe('unclear')
    expect(small.difference).toBeCloseTo(0.033, 3)
    expect(small.bar).toBeGreaterThan(0.05)
    const large = gate(
      old,
      [0.58, 0.63, 0.6].map((c) => build(c)),
    )
    expect(large.verdict).toBe('better')
    expect(
      gate(
        old,
        [0.36, 0.41, 0.4].map((c) => build(c)),
      ).verdict,
    ).toBe('worse')
  })

  it('sees nothing in builds that all score the same', () => {
    const flat = [0.5, 0.5].map((c) => build(c))
    expect(gate(flat, flat)).toMatchObject({ verdict: 'unclear', difference: 0, bar: 0 })
  })

  it('asks more of one build than of three', () => {
    const three = gate(
      old,
      [0.55, 0.6, 0.57].map((c) => build(c)),
    )
    const one = gate(old, [build(0.573)])
    expect(one.bar).toBeGreaterThan(three.bar)
    expect(three.verdict).toBe('better')
    expect(one.verdict).toBe('unclear')
  })

  it('refuses to judge from one build a side', () => {
    expect(() => gate([build(0.4)], [build(0.6)])).toThrow('at least two builds of one side')
    expect(() => gate(old, [])).toThrow('builds of both sides')
  })

  it('fails a higher score that was bought with a bigger deck', () => {
    const bigger = gate(
      old,
      [0.6, 0.64, 0.62].map((c) => build(c, { cards: 760 })),
    )
    expect(bigger.verdict).toBe('guard')
    expect(bigger.guards.filter((g) => !g.holds).map((g) => g.guard)).toEqual(['cards'])
    // Within five percent the deck may grow.
    expect(
      gate(
        old,
        [0.6, 0.64, 0.62].map((c) => build(c, { cards: 690 })),
      ).verdict,
    ).toBe('better')
  })

  it('fails answers that grew long, and a build that calls or writes more', () => {
    const fails = (change: Partial<Build>) =>
      gate(
        old,
        [0.6, 0.64, 0.62].map((c) => build(c, change)),
      )
        .guards.filter((g) => !g.holds)
        .map((g) => g.guard)
    expect(fails({ answerWords: 14 })).toEqual(['answerWords'])
    expect(fails({ answerWordsP90: 30 })).toEqual(['answerWordsP90'])
    expect(fails({ calls: 1100 })).toEqual(['calls'])
    expect(fails({ outputTokens: 330_000 })).toEqual(['outputTokens'])
    expect(fails({ calls: 1040, outputTokens: 310_000 })).toEqual([])
  })
})

describe('the length of answers', () => {
  it('is counted in words: the mean and what nine in ten stay under', () => {
    const answers = [
      ...Array.from({ length: 9 }, () => 'two words'),
      'a much longer answer of seven words',
    ]
    expect(answerLengths(answers)).toEqual({ mean: 2.5, p90: 2 })
    expect(answerLengths([])).toEqual({ mean: 0, p90: 0 })
  })
})
