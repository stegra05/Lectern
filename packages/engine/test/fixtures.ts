/**
 * A small course and the script of the model that "reads" it. The script answers each task
 * from fixed data, makes three kinds of mistakes on purpose, and corrects two of them when
 * the engine sends the card back with feedback.
 */

import type { ModelRequest } from '../src/ports.ts'

export const SLIDES: Record<string, string[][]> = {
  '01 Risk.pdf': [
    ['Entrepreneurship', 'Lecture 1: Risk and uncertainty'],
    [
      'Risk (Knight 1921)',
      'An outcome whose probability can be calculated or known',
      'Example: opening a hairdresser shop',
    ],
    [
      'Uncertainty (Knight 1921)',
      'An outcome whose probability cannot be calculated',
      'Example: a radically new product',
    ],
    [],
    ['Risk versus uncertainty', 'Risk: insurable', 'Uncertainty: not insurable'],
  ],
  '02 Effectuation.pdf': [
    ['Effectuation', 'Lecture 2'],
    [
      'Effectual principles (Sarasvathy)',
      'Bird in hand',
      'Affordable loss',
      'Crazy quilt',
      'Lemonade',
      'Pilot in the plane',
    ],
    ['Bird in hand', 'Start from who you are, what you know and whom you know'],
    ['Risk revisited', 'Risk: an outcome whose probability can be calculated'],
  ],
  '03 Lean startup.pdf': [
    ['Lean startup', 'Build, measure, learn'],
    [
      'The loop',
      'Build a minimum viable product',
      'Measure how customers react',
      'Learn, then pivot or persevere',
    ],
  ],
}

const MAPS: Record<string, unknown> = {
  '01 Risk.pdf': {
    title: 'Risk and uncertainty',
    topics: [
      {
        name: 'Knight',
        concepts: [
          { name: 'risk', slides: [2, 5] },
          { name: 'uncertainty', slides: [3, 5] },
        ],
      },
    ],
    leftOut: [{ slides: [1], reason: 'Title slide' }],
  },
  '02 Effectuation.pdf': {
    title: 'Effectuation',
    topics: [
      {
        name: 'Principles',
        concepts: [
          { name: 'effectual principles', slides: [2] },
          { name: 'bird in hand', slides: [3] },
          { name: 'Risk', slides: [4] },
        ],
      },
    ],
    leftOut: [{ slides: [1], reason: 'Title slide' }],
  },
  '03 Lean startup.pdf': {
    title: 'Lean startup',
    topics: [{ name: 'Loop', concepts: [{ name: 'build measure learn', slides: [1, 2] }] }],
    leftOut: [],
  },
}

const card = (
  concept: string,
  role: string,
  slide: number,
  front: string,
  answers: string[],
  labels: string[] = [],
) => ({
  concept,
  role,
  slide,
  front,
  answers,
  labels,
  extra: '',
})

const LONG_ANSWER =
  'Start from ==who you are==, what you know and whom you know, and then keep going with many more words until this answer is far too long for one card.'

const CARDS: Record<string, unknown[]> = {
  Knight: [
    card('risk', 'definition', 2, 'Knight (1921): what is risk?', [
      'An outcome whose ==probability can be calculated or known==.',
    ]),
    card(
      'risk',
      'reverse',
      2,
      'Knight: which kind of outcome has a probability that can be calculated?',
      ['Risk'],
    ),
    // Mistake 1: a yes/no question. Fixed on the first rewrite.
    card(
      'uncertainty',
      'definition',
      3,
      'Is uncertainty an outcome whose probability cannot be calculated?',
      ['An outcome whose ==probability cannot be calculated==.'],
    ),
    card(
      'uncertainty',
      'contrast',
      5,
      'Risk versus uncertainty: how insurable is each?',
      ['insurable', 'not insurable'],
      ['Risk', 'Uncertainty'],
    ),
  ],
  Principles: [
    card('effectual principles', 'cloze-list', 2, "Sarasvathy's effectual principles:", [
      'bird in hand',
      'affordable loss',
      'crazy quilt',
      'lemonade',
      'pilot in the plane',
    ]),
    card(
      'bird in hand',
      'reverse',
      3,
      'Which effectual principle says to start from who you are, what you know and whom you know?',
      ['Bird in hand'],
    ),
    // Mistake 2: an answer over 25 words. Never fixed, so the card is dropped.
    card('bird in hand', 'definition', 3, 'What does the bird in hand principle tell a founder?', [
      LONG_ANSWER,
    ]),
  ],
  Loop: [
    card(
      'build measure learn',
      'chain',
      2,
      'Lean loop: which step follows build?',
      ['Measure'],
      ['Build'],
    ),
    // Mistake 3: the question of a card that lecture 1 already has. Fixed on the first rewrite.
    card('build measure learn', 'definition', 2, 'Knight (1921): what is risk?', [
      'A loop to ==measure== how customers react.',
    ]),
  ],
}

const REWRITES: Record<string, unknown> = {
  '01-uncertainty-definition-1': {
    id: '01-uncertainty-definition-1',
    slide: 3,
    front: 'Knight (1921): what is uncertainty?',
    answers: ['An outcome whose ==probability cannot be calculated==.'],
    labels: [],
    extra: 'Example: a radically new product.',
  },
  '02-bird-in-hand-definition-1': {
    id: '02-bird-in-hand-definition-1',
    slide: 3,
    front: 'What does the bird in hand principle tell a founder?',
    answers: [LONG_ANSWER],
    labels: [],
    extra: '',
  },
  '03-build-measure-learn-definition-1': {
    id: '03-build-measure-learn-definition-1',
    slide: 2,
    front: 'Lean startup: what is the second step of the loop for?',
    answers: ['To ==measure== how customers react.'],
    labels: [],
    extra: '',
  },
}

export function script(request: ModelRequest): unknown {
  if (request.task === 'map') {
    return MAPS[/^Lecture file: (.+)$/m.exec(request.prompt)![1]!]
  }
  if (request.task === 'write') {
    return { cards: CARDS[/, topic: (.+)$/m.exec(request.prompt)![1]!] }
  }
  const ids = [...request.prompt.matchAll(/^Card (\S+)$/gm)].map((m) => m[1]!)
  return { cards: ids.map((id) => REWRITES[id]) }
}
