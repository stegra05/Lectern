/**
 * The estimate before a run and the cap that stops one. Pure. The constants were set against
 * the first real runs (gpt-6-luna, 2026-11-14) and stay rough. The card count is shown to the
 * student, so it is fitted to what the runs made: 596 and 658 cards from 356 slides.
 */

import { GOAL_PRESETS, type Goal } from './cards/roles.ts'

/** The run stops when its real cost passes this multiple of the estimate. */
export const CAP_MULTIPLE = 3
/** A small course may still cost this much before the cap applies, so noise does not stop it. */
export const CAP_FLOOR_USD = 0.25
/** A slide with fewer characters of text than this is also shown to the model as a picture. */
export const LOW_TEXT_CHARS = 100

const TOKENS = {
  perChar: 0.25,
  perImage: 1000,
  mapPrompt: 500,
  /** The map reasons before it answers, and reasoning is billed as output. */
  mapReplyPerSlide: 250,
  fillPrompt: 600,
  fillReply: 120,
  /** The second reading gets the map back and answers with what it adds. */
  morePromptPerSlide: 120,
  moreReplyPerSlide: 150,
  /** Facts the map finds per slide: 633 on 356 slides before the second reading. Rough. */
  factsPerSlide: 2.2,
  /** One decision request per fact for its worth: 142,375 tokens for 633 facts. */
  factWorth: 225,
  /** Repairs and splits on top of the fill calls. */
  reworkShare: 0.25,
  /** Calls per lecture that read the lecture at full price: the cache is kept per card type. */
  uncachedCalls: 10,
  /** How often the whole lecture goes to the decision model: slide kinds, map checks. */
  decisionPasses: 2,
  /**
   * Decision input per card: the organisation check on every card, and the slide check on the
   * cards the free rule cannot settle, each with one slide as input. Rough. The one measured
   * figure is 401 tokens per card for a request with two questions about one card (1,150 cards,
   * 2026-11-14); a request with one question has not been measured.
   */
  cardCheck: 350,
}

export interface Prices {
  /** Dollars per million tokens of the writing model. */
  model: { input: number; cachedInput: number; output: number }
  /** Dollars per million input tokens of the decision model. Its answers cost nothing. */
  decisions: { input: number }
}

export interface Estimate {
  lectures: number
  slides: number
  /** Cards the run is expected to write. */
  cards: number
  costUsd: number
  /** The estimate as the student is shown it: euros, rounded up. See `shownEuros`. */
  costEur: number
  capUsd: number
}

/**
 * Euros per dollar, for what the student is shown. Fixed on purpose: the estimate is rougher
 * than the rate moves, and a live rate would need the network. Providers bill in dollars, so
 * the engine counts and caps in dollars.
 */
export const EUR_PER_USD = 0.9

/**
 * The estimate in euros, rounded up to a step that grows with the amount: 5 cents up to 50
 * cents, 10 cents up to one euro, 50 cents above. Real runs landed between half and 2.6 times
 * their estimate, so a figure to the cent would claim a precision the engine does not have.
 * Up, never to the nearest step: what a run costs should rarely exceed what was shown.
 */
export function shownEuros(costUsd: number): number {
  const cents = costUsd * EUR_PER_USD * 100
  if (cents <= 0) return 0
  const step = cents <= 50 ? 5 : cents <= 100 ? 10 : 50
  // The small margin keeps an amount that sits on a step from being pushed to the next one.
  return (Math.ceil(cents / step - 1e-9) * step) / 100
}

export function estimate(
  lectures: { chars: number; slides: number; images: number }[],
  goal: Goal,
  prices: Prices,
): Estimate {
  const depth = GOAL_PRESETS[goal]
  let dollars = 0
  let cards = 0
  for (const lecture of lectures) {
    const source = lecture.chars * TOKENS.perChar + lecture.images * TOKENS.perImage
    const facts = lecture.slides * TOKENS.factsPerSlide
    const fills = Math.round(Math.min(facts, depth.cardsPerSlide * lecture.slides))
    const calls = fills * (1 + TOKENS.reworkShare)
    const uncached = Math.min(calls, TOKENS.uncachedCalls)
    cards += fills
    dollars +=
      // The map reads the lecture once at full price.
      (source + TOKENS.mapPrompt) * prices.model.input +
      lecture.slides * TOKENS.mapReplyPerSlide * prices.model.output +
      // The second reading: the lecture again, the map so far, and what it adds.
      (source + TOKENS.mapPrompt + lecture.slides * TOKENS.morePromptPerSlide) *
        prices.model.input +
      lecture.slides * TOKENS.moreReplyPerSlide * prices.model.output +
      // Every card sees the whole lecture again, mostly from the provider's cache.
      source * (uncached * prices.model.input + (calls - uncached) * prices.model.cachedInput) +
      calls * (TOKENS.fillPrompt * prices.model.input + TOKENS.fillReply * prices.model.output) +
      (source * TOKENS.decisionPasses + facts * TOKENS.factWorth + calls * TOKENS.cardCheck) *
        prices.decisions.input
  }
  const costUsd = dollars / 1_000_000
  return {
    lectures: lectures.length,
    slides: lectures.reduce((sum, l) => sum + l.slides, 0),
    cards,
    costUsd,
    costEur: shownEuros(costUsd),
    capUsd: Math.max(CAP_MULTIPLE * costUsd, CAP_FLOOR_USD),
  }
}
