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
  /** Measured on the two full runs of 2026-11-14: 268 and 295 concepts on 356 slides. */
  conceptsPerSlide: 0.8,
  /** The map found 2.4 facts per concept on average, whatever the goal asks for. */
  factsPerConcept: 2.4,
  /** Share of concepts that are core, for the goal that only covers those: 173 of 268. */
  coreShare: 0.65,
  /** Repairs and splits on top of the fill calls. */
  reworkShare: 0.25,
  /** Calls per lecture that read the lecture at full price: the cache is kept per card type. */
  uncachedCalls: 10,
  /** How often the whole lecture goes to the decision model: slide kinds, map checks. */
  decisionPasses: 2,
  /**
   * Decision input per card: the organisation check on every card, and the slide check on the
   * cards the free rule cannot settle, each with one slide as input. Rough, not yet measured.
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
  capUsd: number
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
    const concepts =
      lecture.slides * TOKENS.conceptsPerSlide * (depth.coverage === 'core' ? TOKENS.coreShare : 1)
    const fills = Math.round(concepts * Math.min(depth.facts, TOKENS.factsPerConcept))
    const calls = fills * (1 + TOKENS.reworkShare)
    const uncached = Math.min(calls, TOKENS.uncachedCalls)
    cards += fills
    dollars +=
      // The map reads the lecture once at full price.
      (source + TOKENS.mapPrompt) * prices.model.input +
      lecture.slides * TOKENS.mapReplyPerSlide * prices.model.output +
      // Every card sees the whole lecture again, mostly from the provider's cache.
      source * (uncached * prices.model.input + (calls - uncached) * prices.model.cachedInput) +
      calls * (TOKENS.fillPrompt * prices.model.input + TOKENS.fillReply * prices.model.output) +
      (source * TOKENS.decisionPasses + calls * TOKENS.cardCheck) * prices.decisions.input
  }
  const costUsd = dollars / 1_000_000
  return {
    lectures: lectures.length,
    slides: lectures.reduce((sum, l) => sum + l.slides, 0),
    cards,
    costUsd,
    capUsd: Math.max(CAP_MULTIPLE * costUsd, CAP_FLOOR_USD),
  }
}
