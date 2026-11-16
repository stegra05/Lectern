/**
 * The gate a change of the engine has to pass: one verdict from the builds of the old code and
 * the builds of the new. Written for a change made without a person watching, so it closes the
 * cheap ways to a higher score. Nothing here calls a model or reads a file.
 *
 * The score is the share of the exam marks a deck holds, averaged over the builds of a side.
 * A change is better only when the new side beats the old by more than builds of the same code
 * differ, and no guard fails:
 *
 * - the deck is no bigger, since more cards hold more marks and cost the student more reviews,
 * - the answers are no longer, since one card stuffed with five facts holds five points and is
 *   no card to learn from,
 * - the build makes no more calls and writes no more, the two things that set its time and
 *   that, unlike the clock, barely move between builds of the same code.
 */

import { spread } from '../spread.ts'

/** What the gate needs to know of one build. */
export interface Build {
  /** The share of the marks its deck holds, from 0 to 1. */
  coverage: number
  cards: number
  /** The words of its answers: the mean and the length nine in ten stay under. */
  answerWords: number
  answerWordsP90: number
  /** Calls to the writing model, and the tokens it wrote. */
  calls: number
  outputTokens: number
}

/**
 * How far the new side may go above the old before a guard fails. The deck: 5 percent, where
 * three builds of one code differed by 1 (661 to 668 cards, 2026-11-16). Answers: 10 percent.
 * Calls and output: 10 percent, where the same three builds differed by 7 and 5.
 */
export const LIMITS = {
  cards: 1.05,
  answerWords: 1.1,
  answerWordsP90: 1.1,
  calls: 1.1,
  outputTokens: 1.1,
} as const
export type Guard = keyof typeof LIMITS

export interface GuardResult {
  guard: Guard
  old: number
  new: number
  /** The most the new side may have. */
  limit: number
  holds: boolean
}

export interface Verdict {
  /**
   * better: the score rose by at least the bar and every guard holds. worse: it fell by at
   * least the bar. guard: a guard fails, whatever the score. unclear: the difference is within
   * what builds of the same code differ by.
   */
  verdict: 'better' | 'worse' | 'guard' | 'unclear'
  old: number
  new: number
  difference: number
  /** The smallest difference worth believing: twice the standard error of the difference. */
  bar: number
  guards: GuardResult[]
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length

/**
 * How much builds of the same code spread, from both sides together: each side's builds around
 * their own mean. A side of one build tells nothing about spread.
 */
function pooledSd(sides: number[][]): number {
  const usable = sides.filter((side) => side.length >= 2)
  if (usable.length === 0) throw new Error('The gate needs at least two builds of one side.')
  const squares = usable.reduce((sum, side) => sum + spread(side).sd ** 2 * (side.length - 1), 0)
  const freedom = usable.reduce((sum, side) => sum + side.length - 1, 0)
  return Math.sqrt(squares / freedom)
}

export function gate(old: Build[], next: Build[]): Verdict {
  if (old.length === 0 || next.length === 0) throw new Error('The gate needs builds of both sides.')
  const scores = [old, next].map((side) => side.map((build) => build.coverage))
  const [oldScore, newScore] = scores.map(mean) as [number, number]
  const bar = 2 * pooledSd(scores) * Math.sqrt(1 / old.length + 1 / next.length)
  const guards = (Object.keys(LIMITS) as Guard[]).map((guard) => {
    const before = mean(old.map((build) => build[guard]))
    const after = mean(next.map((build) => build[guard]))
    const limit = before * LIMITS[guard]
    return { guard, old: before, new: after, limit, holds: after <= limit }
  })
  const difference = newScore - oldScore
  const verdict = guards.some((g) => !g.holds)
    ? 'guard'
    : difference > 0 && difference >= bar
      ? 'better'
      : difference < 0 && difference <= -bar
        ? 'worse'
        : 'unclear'
  return { verdict, old: oldScore, new: newScore, difference, bar, guards }
}

/** The mean length of the answers in words, and the length nine in ten stay under. */
export function answerLengths(answers: string[]): { mean: number; p90: number } {
  const words = answers.map((answer) => answer.trim().split(/\s+/).filter(Boolean).length)
  if (words.length === 0) return { mean: 0, p90: 0 }
  const sorted = [...words].sort((a, b) => a - b)
  return { mean: mean(words), p90: sorted[Math.ceil(sorted.length * 0.9) - 1]! }
}
