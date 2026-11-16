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
  /**
   * Reading one slide: its picture and the question at full price, the lecture from the cache.
   * Measured on the 356 Entrepreneurship slides on 2026-11-15: 1,281 tokens at full price and
   * 285 tokens of reply per slide.
   */
  readPerSlide: 1300,
  readReply: 290,
  /** Facts the reading finds per slide: 1,418 on those 356 slides. */
  factsPerSlide: 4,
  /** Sorting the facts: each one listed with its id, and its id back with some reasoning. */
  groupPrompt: 600,
  groupPerFact: 45,
  groupReplyPerFact: 25,
  fillPrompt: 600,
  fillReply: 120,
  /**
   * Past exams: each paper read whole, then all questions sorted into families in one call,
   * then one answer per family over its lecture. Measured on 22 Entrepreneurship papers on
   * 2026-11-15: 272 questions, about 10 per paper; families are roughly half the questions.
   */
  questionsPerPaper: 10,
  questionReply: 45,
  familyPerQuestion: 70,
  familyReplyPerQuestion: 30,
  familiesPerQuestion: 0.5,
  answerPrompt: 350,
  answerReply: 120,
  /** One decision request per fact for its worth: 142,375 tokens for 633 facts. */
  factWorth: 225,
  /** Repairs and splits on top of the fill calls. */
  reworkShare: 0.25,
  /** Calls per lecture that read the lecture at full price: the cache is kept per card type. */
  uncachedCalls: 10,
  /**
   * Decision input per card: the organisation check on every card, with the card alone as input.
   * Rough. The one measured
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
  exams: { papers: number; chars: number } = { papers: 0, chars: 0 },
): Estimate {
  const depth = GOAL_PRESETS[goal]
  const questions = exams.papers * TOKENS.questionsPerPaper
  const families = questions * TOKENS.familiesPerQuestion
  const lectureSource =
    lectures.reduce((sum, l) => sum + l.chars * TOKENS.perChar + l.images * TOKENS.perImage, 0) /
    Math.max(1, lectures.length)
  let dollars =
    exams.papers === 0
      ? 0
      : exams.chars * TOKENS.perChar * prices.model.input +
        questions * TOKENS.questionReply * prices.model.output +
        questions * TOKENS.familyPerQuestion * prices.model.input +
        questions * TOKENS.familyReplyPerQuestion * prices.model.output +
        families *
          (lectureSource * prices.model.cachedInput +
            TOKENS.answerPrompt * prices.model.input +
            TOKENS.answerReply * prices.model.output)
  let cards = 0
  for (const lecture of lectures) {
    const source = lecture.chars * TOKENS.perChar + lecture.images * TOKENS.perImage
    const facts = lecture.slides * TOKENS.factsPerSlide
    const fills = Math.round(depth.cardsPerSlide * lecture.slides)
    const calls = fills * (1 + TOKENS.reworkShare)
    const uncached = Math.min(calls, TOKENS.uncachedCalls)
    cards += fills
    dollars +=
      // Every slide read on its own: the first call puts the lecture in the cache.
      source * (prices.model.input + (lecture.slides - 1) * prices.model.cachedInput) +
      lecture.slides *
        (TOKENS.readPerSlide * prices.model.input + TOKENS.readReply * prices.model.output) +
      // The facts sorted into topics and concepts, in one call over the lecture.
      (source + TOKENS.groupPrompt + facts * TOKENS.groupPerFact) * prices.model.input +
      facts * TOKENS.groupReplyPerFact * prices.model.output +
      // Every card sees the whole lecture again, mostly from the provider's cache.
      source * (uncached * prices.model.input + (calls - uncached) * prices.model.cachedInput) +
      calls * (TOKENS.fillPrompt * prices.model.input + TOKENS.fillReply * prices.model.output) +
      (facts * TOKENS.factWorth + calls * TOKENS.cardCheck) * prices.decisions.input
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
