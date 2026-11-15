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
  // Added by Steffen on 2026-11-14: a reason, a condition or a consequence. It becomes a "why" card.
  'cause',
] as const
export type FactKind = (typeof FACT_KINDS)[number]

export type CheckName =
  'slideKind' | 'conceptBelongs' | 'sameConcept' | 'supported' | 'sameCard' | 'organisation'

export interface Calibration {
  /** False until the threshold has been set on labelled data. */
  calibrated: boolean
  /** The probability from which the check counts as a yes. */
  threshold: number
}

export type Calibrations = Record<CheckName, Calibration>

const unmeasured: Calibration = { calibrated: false, threshold: 0.5 }

/**
 * A check that has not been measured on labelled data only flags. One has been: on 2026-11-14
 * the organisation check ran over the 1,150 cards of two full Entrepreneurship runs, each card
 * graded by a second model. Its answers fall into two heaps. From 0.2 on it named 37 cards:
 * 32 of the 56 about course organisation, 3 about the session, 1 other defect and 1 sound
 * card. None of the 50 cards Steffen had judged worth keeping was among them.
 */
export const CALIBRATIONS: Calibrations = {
  slideKind: unmeasured,
  conceptBelongs: unmeasured,
  sameConcept: unmeasured,
  supported: unmeasured,
  sameCard: unmeasured,
  organisation: { calibrated: true, threshold: 0.2 },
}

/**
 * One card as the whole input of a decision request. The decision model judges statements
 * about its input: asked about a card while a whole lecture was the input, it said yes to
 * nearly everything. So the card check sees the card and nothing else.
 */
export function cardInput(question: string, answer: string): string {
  return `A flashcard written from the slides of a university course.\nQuestion: ${question}\nAnswer: ${answer}`
}

/**
 * One slide as the whole input of the slide check. Measured on 2026-11-15 on 66 cards, each
 * with its own slide and with a far-away slide of the same lecture: with the whole lecture as
 * input the model said yes to 50 of the 66 wrong slides, with the slide alone to 12, and it
 * still said yes to 65 of the 66 right ones.
 */
export function slideInput(lines: string[]): string {
  return `One slide of a university lecture:\n${lines.join('\n')}`
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
    ask:
      `What kind of slide is slide ${slide}? title: it only names the lecture or a section. ` +
      'agenda: it lists what the session will cover, or organisation such as dates, grading, ' +
      'assignments and instructions for an exercise. recap: it repeats what an earlier session ' +
      'covered. reading list: literature. content: it teaches something that can be examined.',
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
  supported: (question: string, answer: string): Question => ({
    type: 'predicate',
    statement: `This slide supports this flashcard. Question: ${question} Answer: ${answer}`,
  }),
  organisation: (): Question => ({
    type: 'predicate',
    statement:
      'This flashcard is about the organisation of the course: the lecturer, dates, grading, ' +
      'exam rules, assignments, reading lists, guest visits or instructions for a class exercise.',
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
