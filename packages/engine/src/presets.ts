/**
 * Presets: the hand-written part of the method. A preset says which card types a kind of fact
 * becomes, shows the model example cards per card type, and states the writing rules.
 *
 * PLACEHOLDER. One minimal preset serves every kind of lecture so the pipeline runs end to
 * end. The four real presets (concept, formula, programming, fact-heavy courses) are drafted
 * from real lectures and the reference deck and approved by Steffen before they ship.
 */

import type { Role } from './cards/roles.ts'
import type { FactKind, ProfileKind } from './decide.ts'

export interface Preset {
  id: string
  /** The card types a fact of each kind becomes, taken in turn within one concept. */
  plan: Record<FactKind, readonly Role[]>
  /** One filled form per card type, shown to the model when it fills that form. */
  examples: Partial<Record<Role, Record<string, unknown>>>
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
  rules: [
    'One fact per card. Exactly one defensible answer.',
    'Never a yes/no question: ask what, which, why or how.',
    'Key terms appear exactly as on the slides. Reword the sentence around them; do not copy it.',
    'Add a context prefix such as "Knight:" only when it rules out a rival answer.',
    'Write in the language of the slides.',
  ],
}

/** Every kind of lecture gets the placeholder until its own preset exists. */
const PRESETS: Record<ProfileKind, Preset> = {
  concept: PLACEHOLDER,
  formula: PLACEHOLDER,
  programming: PLACEHOLDER,
  'fact-heavy': PLACEHOLDER,
}

export function presetFor(kind: ProfileKind): Preset {
  return PRESETS[kind]
}
