/**
 * The closed-set judgements of the pipeline: their closed lists, their questions, and whether
 * each check has been calibrated. A check that has not been measured on labelled data only
 * flags. It never drops or merges anything.
 */

import type { Answer, Question } from './ports.ts'

export const PROFILE_KINDS = ['concept', 'formula', 'programming', 'fact-heavy'] as const
export type ProfileKind = (typeof PROFILE_KINDS)[number]

export const SLIDE_KINDS = ['title', 'agenda', 'recap', 'reading list', 'content'] as const
export type SlideKind = (typeof SLIDE_KINDS)[number]

export const FACT_KINDS = [
  'definition',
  'contrast',
  'list',
  'sequence',
  'formula',
  'code',
  'case',
  'diagram',
] as const
export type FactKind = (typeof FACT_KINDS)[number]

export type CheckName = 'slideKind' | 'conceptBelongs' | 'sameConcept' | 'supported' | 'sameCard'

export interface Calibration {
  /** False until the threshold has been set on labelled data. */
  calibrated: boolean
  /** The probability from which the check counts as a yes. */
  threshold: number
}

export type Calibrations = Record<CheckName, Calibration>

const unmeasured: Calibration = { calibrated: false, threshold: 0.5 }

/** Nothing has been calibrated yet, so every check only flags. */
export const CALIBRATIONS: Calibrations = {
  slideKind: unmeasured,
  conceptBelongs: unmeasured,
  sameConcept: unmeasured,
  supported: unmeasured,
  sameCard: unmeasured,
}

export const ask = {
  profile: (): Question => ({
    type: 'choice',
    ask:
      'Which kind of course are these lectures? concept: ideas, models and cases, as in business or ' +
      'social science. formula: maths, statistics, physics. programming: code and algorithms. ' +
      'fact-heavy: many facts to memorise, as in medicine, biology or law.',
    choices: PROFILE_KINDS,
  }),
  slideKind: (slide: number): Question => ({
    type: 'choice',
    ask: `What kind of slide is slide ${slide}? content: it teaches something that can be examined.`,
    choices: SLIDE_KINDS,
  }),
  conceptBelongs: (concept: string): Question => ({
    type: 'predicate',
    statement: `This lecture teaches the concept "${concept}".`,
  }),
  sameConcept: (concept: string, earlier: string): Question => ({
    type: 'predicate',
    statement: `"${concept}" in this lecture and "${earlier}" from an earlier lecture are the same concept.`,
  }),
  factKind: (fact: string): Question => ({
    type: 'choice',
    ask: `What kind of knowledge is this fact: "${fact}"`,
    choices: FACT_KINDS,
  }),
  supported: (slide: number, question: string, answer: string): Question => ({
    type: 'predicate',
    statement: `Slide ${slide} supports this flashcard. Question: ${question} Answer: ${answer}`,
  }),
  sameCard: (a: string, b: string): Question => ({
    type: 'predicate',
    statement: `These two flashcards test the same thing. First: ${a} Second: ${b}`,
  }),
}

/** The probability of a predicate answer, or null when the model gave none. */
export function probability(answer: Answer | undefined): number | null {
  return answer?.type === 'predicate' ? answer.probability : null
}

/** The chosen value when it is one of the allowed ones, otherwise the fallback. */
export function chosen<T extends string>(
  answer: Answer | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return answer?.type === 'choice' && (allowed as readonly string[]).includes(answer.choice)
    ? (answer.choice as T)
    : fallback
}
