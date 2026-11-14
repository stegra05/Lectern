/**
 * The estimate before a run and the cap that stops one. Pure. The numbers are rough and
 * will be calibrated against the first real runs.
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
  mapReplyPerSlide: 60,
  fillPrompt: 600,
  fillReply: 120,
  conceptsPerSlide: 0.5,
  /** Share of concepts that are core, for the goal that only covers those. */
  coreShare: 0.5,
  /** Repairs and splits on top of the fill calls. */
  reworkShare: 0.25,
  /** How often the whole lecture goes to the decision model: slide kinds, map checks, slide check. */
  decisionPasses: 3,
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
    const fills = Math.round(concepts * depth.facts)
    const calls = fills * (1 + TOKENS.reworkShare)
    cards += fills
    dollars +=
      // The map reads the lecture once at full price.
      (source + TOKENS.mapPrompt) * prices.model.input +
      lecture.slides * TOKENS.mapReplyPerSlide * prices.model.output +
      // Every card sees the whole lecture again, from the provider's cache.
      calls * (source * prices.model.cachedInput + TOKENS.fillPrompt * prices.model.input) +
      calls * TOKENS.fillReply * prices.model.output +
      source * TOKENS.decisionPasses * prices.decisions.input
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
