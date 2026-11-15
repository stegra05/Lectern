/** The closed-set judgements of the pipeline: their closed lists and their questions. */

import type { Answer, Level, Question } from './ports.ts'

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

/**
 * The organisation check's threshold: from this probability on, a card about the organisation
 * of the course is dropped. Set on 2026-11-14 over the 1,150 cards of two full Entrepreneurship
 * runs, each card graded by a second model. Its answers fall into two heaps. From 0.2 on it
 * named 37 cards: 32 of the 56 about course organisation, 3 about the session, 1 other defect
 * and 1 sound card. None of the 50 cards Steffen had judged worth keeping was among them.
 */
export const ORGANISATION_THRESHOLD = 0.2

/**
 * One card as the whole input of a decision request. The decision model judges statements
 * about its input: asked about a card while a whole lecture was the input, it said yes to
 * nearly everything. So the card check sees the card and nothing else.
 */
export function cardInput(question: string, answer: string): string {
  return `A flashcard written from the slides of a university course.\nQuestion: ${question}\nAnswer: ${answer}`
}

/**
 * One fact as the whole input of its own request, for the same reason as a card: the decision
 * model judges statements about its input.
 */
export function factInput(concept: string, fact: string): string {
  return `One fact taken from the slides of a university lecture.\nConcept: ${concept}\nFact: ${fact}`
}

/**
 * How much a fact is worth learning, lowest first. The answer orders the facts of a lecture;
 * the goal says how many get a card. Measured on 2026-11-15 on the 633 facts of a full
 * Entrepreneurship run against the 636 notes of the reference deck: of the 192 notes the run's
 * cards covered, the 372 facts with the highest answer kept 164, the first 372 in the order
 * the map listed them kept 133, and 372 at random kept 129.
 */
export const WORTH_LEVELS: readonly Level[] = [
  {
    label: 'not examinable',
    description:
      'About the organisation of the course, the slides or the session itself, or it says nothing specific.',
  },
  {
    label: 'detail',
    description:
      'True and on the subject, but an incidental detail, the trivia of an example, or obvious.',
  },
  { label: 'examinable', description: 'Subject matter an exam could ask.' },
  {
    label: 'core',
    description: 'A central concept, model, framework or distinction of the course.',
  },
]

/** The worth of a fact the decision model gave no answer for: examinable, neither first nor last. */
export const WORTH_UNKNOWN = 2

export const ask = {
  worth: (): Question => ({
    type: 'score',
    ask: 'How much is this fact worth learning for the exam of the course?',
    levels: WORTH_LEVELS,
  }),
  factKind: (fact: string): Question => ({
    type: 'choice',
    ask: `What kind of knowledge is this fact: "${fact}"`,
    choices: FACT_KINDS,
  }),
  organisation: (): Question => ({
    type: 'predicate',
    statement:
      'This flashcard is about the organisation of the course: the lecturer, dates, grading, ' +
      'exam rules, assignments, reading lists, guest visits or instructions for a class exercise.',
  }),
}

/** The probability of a predicate answer, or null when the model gave none. */
export function probability(answer: Answer | undefined): number | null {
  return answer?.type === 'predicate' ? answer.probability : null
}

/** The score of a score answer, or null when the model gave none. */
export function score(answer: Answer | undefined): number | null {
  return answer?.type === 'score' ? answer.score : null
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
