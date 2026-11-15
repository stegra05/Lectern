/**
 * The preset: the hand-written part of the method. It says which card types a kind of fact
 * becomes, shows the model example cards per card type, and states the rules for the map and
 * for the cards.
 *
 * Written from Steffen's Entrepreneurship study kit and accepted by him on 2026-11-15 after a
 * comparison run (`docs/engine-profile-concept.md`). Every course uses it.
 */

import type { Role } from './cards/roles.ts'
import type { FactKind } from './decide.ts'

export interface Preset {
  /** The card types a fact of each kind becomes, taken in turn within one concept. */
  plan: Record<FactKind, readonly Role[]>
  /** One filled form per card type, shown to the model when it fills that form. */
  examples: Partial<Record<Role, Record<string, unknown>>>
  /** What counts as a concept and a fact, for the model that maps a lecture. */
  mapRules: readonly string[]
  /** How a card is worded, for the model that fills the forms. */
  rules: readonly string[]
}

/** The preset of every course. Examples are cards of the reference deck, put into the forms. */
export const CONCEPT: Preset = {
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
