/**
 * The closed set of card roles. A role is a slot template: it says which slots the model
 * fills and how many, and `assemble.ts` builds every card field from those slots.
 * `code` and `diagram` from the field contract are not built yet.
 */

export const ROLES = [
  'definition',
  'reverse',
  'contrast',
  'chain',
  'name-two',
  'why',
  'case',
  'formula',
  'cloze',
  'cloze-list',
] as const

export type Role = (typeof ROLES)[number]

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value)
}

/** What the model returns for one card. Everything else on a card is written by code. */
export interface Draft {
  /** Name of a concept from the lecture's tree. */
  concept: string
  role: string
  /** The slide the card comes from. */
  slide: number
  /** The question. For `cloze` the sentence with deletions, for `cloze-list` the lead-in. */
  front: string
  /** The answer slots, in the order the role defines. */
  answers: string[]
  /** The slot labels, for the roles that name their slots. */
  labels: string[]
  /** Optional context shown after the answer. Empty when there is none. */
  extra: string
}

export interface RoleSpec {
  note: 'qa' | 'cloze'
  /** Allowed number of answers, lowest and highest. */
  answers: readonly [number, number]
  /** Allowed number of labels, lowest and highest. */
  labels: readonly [number, number]
  /** How Back is built from the answers. */
  back: 'sentence' | 'term' | 'list' | 'formula' | 'none'
  /** A key term mark (`==term==`) is required in the answer. */
  markRequired: boolean
  /** An answer without a mark is the key term as a whole. */
  markWhole: boolean
  /** One line for the prompt: when to use the role and how to fill its slots. */
  use: string
}

export const ROLE_SPECS: Record<Role, RoleSpec> = {
  definition: {
    note: 'qa',
    answers: [1, 1],
    labels: [0, 0],
    back: 'sentence',
    markRequired: true,
    markWhole: false,
    use: 'What a term means. answers: one sentence, the key term wrapped as ==key term==.',
  },
  reverse: {
    note: 'qa',
    answers: [1, 1],
    labels: [0, 0],
    back: 'term',
    markRequired: false,
    markWhole: true,
    use: 'From a description to its term. answers: the term alone, written as it appears mid-sentence.',
  },
  contrast: {
    note: 'qa',
    answers: [2, 2],
    labels: [2, 2],
    back: 'list',
    markRequired: false,
    markWhole: true,
    use: 'Two sides on one dimension. labels: the two sides. answers: one short value per side, same order.',
  },
  chain: {
    note: 'qa',
    answers: [1, 2],
    labels: [1, 4],
    back: 'list',
    markRequired: false,
    markWhole: true,
    use: 'What comes next in a sequence. labels: the steps given in the question, in order. answers: the one or two steps that follow.',
  },
  'name-two': {
    note: 'qa',
    answers: [2, 2],
    labels: [0, 0],
    back: 'list',
    markRequired: false,
    markWhole: false,
    use: 'Two items the exam asks to name. answers: exactly two items.',
  },
  why: {
    note: 'qa',
    answers: [2, 2],
    labels: [0, 0],
    back: 'list',
    markRequired: false,
    markWhole: false,
    use: 'A cause or justification. answers: two reasoning steps, the second following from the first.',
  },
  case: {
    note: 'qa',
    answers: [1, 1],
    labels: [0, 0],
    back: 'term',
    markRequired: false,
    markWhole: true,
    use: 'A case or example from the lecture, named in the question. answers: the term it stands for.',
  },
  formula: {
    note: 'qa',
    answers: [2, 2],
    labels: [0, 0],
    back: 'formula',
    markRequired: false,
    markWhole: false,
    use: 'A formula to state. answers: first the formula in TeX without delimiters, then one sentence with its condition.',
  },
  cloze: {
    note: 'cloze',
    answers: [0, 0],
    labels: [0, 0],
    back: 'none',
    markRequired: false,
    markWhole: false,
    use: 'One sentence with one to five hidden items. front: the sentence with {{c1::item}}, {{c2::item}}, numbered from 1. answers: empty.',
  },
  'cloze-list': {
    note: 'cloze',
    answers: [2, 5],
    labels: [0, 0],
    back: 'none',
    markRequired: false,
    markWhole: false,
    use: 'A list the exam asks to name. front: the lead-in, such as "The five Cs of lending:". answers: the two to five items in their fixed order.',
  },
}

/** The student's goal sets the depth: the most cards one concept may get. */
export const GOALS = ['pass', 'good', 'top'] as const
export type Goal = (typeof GOALS)[number]
export const GOAL_LABEL: Record<Goal, string> = {
  pass: 'pass',
  good: 'good grade',
  top: 'top grade',
}
export const CARDS_PER_CONCEPT: Record<Goal, number> = { pass: 2, good: 3, top: 4 }
