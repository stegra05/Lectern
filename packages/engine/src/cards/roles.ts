/**
 * The closed set of card roles. A role is a slot template: it says which slots the model
 * fills and how many, and `assemble.ts` builds every card field from those slots.
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
  'code',
  'diagram',
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
  /** The listing of a `code` card, copied from the slide. Empty for every other role. */
  code: string
  /** The drawing of a `diagram` card. Null for every other role. */
  diagram: Diagram | null
}

export const DIAGRAM_TYPES = ['matrix', 'sequence', 'cycle'] as const

/**
 * A drawing as data, from a small set of types that code can render. No renderer exists yet;
 * until one is benchmarked the card shows the slide image instead.
 * matrix: `cells` row by row under the `columns` and beside the `rows` labels.
 * sequence and cycle: `cells` are the steps in order; `columns` and `rows` stay empty.
 */
export interface Diagram {
  type: (typeof DIAGRAM_TYPES)[number]
  columns: string[]
  rows: string[]
  cells: string[]
  /** Indexes into `cells` of the parts that answer the question. */
  key: number[]
}

export interface RoleSpec {
  note: 'qa' | 'cloze'
  /** Allowed number of answers, lowest and highest. */
  answers: readonly [number, number]
  /** Allowed number of labels, lowest and highest. */
  labels: readonly [number, number]
  /** How Back is built from the answers. */
  /** `steps` is one sentence, or two bullets when the reasoning has two steps. */
  back: 'sentence' | 'term' | 'list' | 'steps' | 'formula' | 'none'
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
    use: 'What a term means. answers: one sentence that gives the meaning and does not start with the term asked about. Wrap the words to recall as ==words==.',
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
    answers: [1, 2],
    labels: [0, 0],
    back: 'steps',
    markRequired: false,
    markWhole: false,
    use: 'A reason, a condition or a consequence. answers: one sentence; a second step only when the reasoning needs it.',
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
  code: {
    note: 'qa',
    answers: [1, 2],
    labels: [1, 2],
    back: 'list',
    markRequired: false,
    markWhole: false,
    use: 'What a listing does. code: the listing as on the slide, at most 16 lines. labels: one per question part, such as "Returns" and "Time". answers: one per label.',
  },
  diagram: {
    note: 'qa',
    answers: [1, 1],
    labels: [0, 0],
    back: 'sentence',
    markRequired: false,
    markWhole: false,
    use: 'A framework to draw from memory. front: asks to draw it. diagram: the drawing as data. answers: one sentence that reads the drawing.',
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

/** The student's goal, asked once per course. It sets coverage and depth. */
export const GOALS = ['pass', 'good', 'top'] as const
export type Goal = (typeof GOALS)[number]

export interface GoalPreset {
  label: string
  /** Which concepts get cards: only those the map marks as core, or all. */
  coverage: 'core' | 'all'
  /** How many facts of one concept get a card. */
  facts: number
  /** Facts of these kinds get a card even beyond that number. */
  always: readonly string[]
}

export const GOAL_PRESETS: Record<Goal, GoalPreset> = {
  pass: { label: 'pass', coverage: 'core', facts: 1, always: [] },
  good: { label: 'good grade', coverage: 'all', facts: 2, always: [] },
  top: { label: 'top grade', coverage: 'all', facts: 4, always: ['case', 'contrast'] },
}

/** A concept that comes up again in a later lecture gets this many more cards there. */
export const RECURRING_CARDS = 1
