/**
 * Presets: the hand-written part of the method. A preset says which card types a kind of fact
 * becomes, shows the model example cards per card type, and states the rules for the map and
 * for the cards.
 *
 * `concept` is the working preset for concept courses, written from Steffen's Entrepreneurship
 * study kit and accepted by him on 2026-11-15 after a comparison run
 * (`docs/rfd/0007-presets.md`). The other three kinds of lecture have no preset of
 * their own yet and get `placeholder`, one minimal preset that only makes the pipeline run.
 */

import type { Role } from './cards/roles.ts'
import type { FactKind, ProfileKind } from './decide.ts'

export interface Preset {
  id: string
  /** The card types a fact of each kind becomes, taken in turn within one concept. */
  plan: Record<FactKind, readonly Role[]>
  /** One filled form per card type, shown to the model when it fills that form. */
  examples: Partial<Record<Role, Record<string, unknown>>>
  /** What counts as a concept and a fact, for the model that maps a lecture. */
  mapRules: readonly string[]
  /** How a card is worded, for the model that fills the forms. */
  rules: readonly string[]
}

const PLACEHOLDER: Preset = {
  id: 'placeholder',
  plan: {
    definition: ['definition', 'reverse'],
    contrast: ['contrast'],
    list: ['cloze-list'],
    sequence: ['chain'],
    formula: ['formula'],
    code: ['code'],
    case: ['case'],
    diagram: ['diagram'],
    cause: ['why'],
  },
  examples: {
    definition: {
      question: 'Knight (1921): what is risk?',
      answer: 'An outcome whose ==probability can be calculated or known==.',
      extra: 'Example: opening a hairdresser shop.',
    },
    reverse: {
      question:
        'Which effectual principle says to start from who you are, what you know and whom you know?',
      term: 'bird in hand',
      extra: '',
    },
    contrast: {
      question: 'Causation versus effectuation: how does each handle risk?',
      sideA: 'Causation',
      valueA: 'expected return',
      sideB: 'Effectuation',
      valueB: 'affordable loss',
      extra: '',
    },
    chain: {
      question: 'BMC fill order: which two blocks follow segments and value propositions?',
      givenSteps: ['Customer segments', 'Value propositions'],
      nextSteps: ['Channels', 'Customer relationships'],
      extra: '',
    },
    'cloze-list': {
      leadIn: "Sarasvathy's effectual principles:",
      items: ['bird in hand', 'affordable loss', 'crazy quilt', 'lemonade', 'pilot in the plane'],
      extra: '',
    },
    case: {
      question: 'Arterial pH 7.30 with raised pCO2: which disorder?',
      term: 'respiratory acidosis',
      extra: '',
    },
    formula: {
      question: 'State the Cauchy-Schwarz inequality for u, v in an inner product space.',
      tex: '\\lvert \\langle u, v \\rangle \\rvert \\le \\lVert u \\rVert \\, \\lVert v \\rVert',
      condition: 'Equality holds exactly when u and v are ==linearly dependent==.',
      extra: '',
    },
  },
  mapRules: [],
  rules: [
    'One fact per card. Exactly one defensible answer.',
    'Never a yes/no question: ask what, which, why or how.',
    'Key terms appear exactly as on the slides. Reword the sentence around them; do not copy it.',
    'Add a context prefix such as "Knight:" only when it rules out a rival answer.',
    'Write in the language of the slides.',
  ],
}

/** Concept courses. Examples are cards of the reference deck, put into the forms. */
const CONCEPT: Preset = {
  id: 'concept',
  plan: PLACEHOLDER.plan,
  examples: {
    definition: {
      question: 'Sarasvathy: what is causation?',
      answer: 'Start from a ==given goal== and select the means to reach it.',
      extra: '',
    },
    reverse: {
      question: 'Greiner: which phase resolves the crisis of autonomy?',
      term: 'delegation',
      extra: '',
    },
    case: {
      question: 'Alex Krapp: which big clients did soul-surf win?',
      term: 'BMW and MAN',
      extra: '',
    },
    contrast: {
      question: 'Causation versus effectuation: how does each handle risk?',
      sideA: 'Causation',
      valueA: '==expected return==, the best risk-adjusted opportunity',
      sideB: 'Effectuation',
      valueB: '==affordable loss==, never more than you can afford to lose',
      extra: '',
    },
    chain: {
      question: 'Lean iteration: which step follows the theory?',
      givenSteps: ['Theory'],
      nextSteps: ['Hypothesis'],
      extra: '',
    },
    'name-two': {
      question: 'Which two exit routes are the most common?',
      first: '==trade sales==',
      second: '==buyouts==',
      extra: 'Both change the ownership of the firm.',
    },
    why: {
      question: 'Software: why does copyright give it only weak protection?',
      answer: 'It protects ==the code, not the idea==.',
      then: '',
      extra: '',
    },
    'cloze-list': {
      leadIn: 'Five Cs of lending:',
      items: ['character', 'capacity', 'capital', 'collateral', 'conditions'],
      extra: 'Banks judge them from past financial statements and projections.',
    },
    cloze: {
      sentence:
        'Market development can target a new {{c1::geographical}} market, a new {{c2::demographic}} market, or a new {{c3::product use}}.',
      extra: '',
    },
  },
  mapRules: [
    'Only what can be examined is a concept. The organisation of the course is never one: the lecturer, dates, grading, assignments, the agenda, a recap of the last session, reading lists, instructions for a class exercise.',
    'Give each idea several angles as separate facts: what it is, why or when it holds, what follows from it, the course example, how it differs from its neighbour.',
    'A list fact is a named set the exam asks to recite, such as "the five Cs of lending". The bullet points of a slide are not a list fact: take what each bullet teaches as its own fact.',
    'A case fact names a company, a person or a study from the lecture and says what it shows. Biography and trivia are not facts.',
  ],
  rules: [
    'Lead with the answer: the key term comes first, marked as ==term==. Never restate the question in the answer.',
    'One fact per answer, answerable in about ten seconds. Aim for about 12 words.',
    'Exactly one defensible answer. Add a context prefix such as "Greiner:" or "Bank loan versus VC:" when it rules out a rival answer from another framework.',
    'Never a yes/no or an either/or question, and no wording that gives the answer away. Ask what, which, why or how.',
    'A case card names the case in the question.',
    'A contrast compares both sides on one dimension, in the same wording.',
    'The example, the mechanism or the source goes to extra. Extra is never tested.',
    'Key terms appear exactly as on the slides. Reword the sentence around them; do not copy it.',
    'Write in the language of the slides.',
  ],
}

export const PRESETS = { placeholder: PLACEHOLDER, concept: CONCEPT }
export const PRESET_IDS = ['placeholder', 'concept'] as const

/** A kind of lecture without a preset of its own gets the placeholder. */
const BY_KIND: Record<ProfileKind, Preset> = {
  concept: CONCEPT,
  formula: PLACEHOLDER,
  programming: PLACEHOLDER,
  'fact-heavy': PLACEHOLDER,
}

export function presetFor(kind: ProfileKind): Preset {
  return BY_KIND[kind]
}
