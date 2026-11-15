/**
 * A small course and the scripts of the two models that "read" it. The writing model maps
 * each lecture and fills one form per planned card. It makes mistakes on purpose: a yes/no
 * question (repaired), a card that is too long (split), a term that never fits (dropped) and
 * a question the course already has (dropped at the end). The decision model answers the
 * closed questions and raises doubts that, uncalibrated, only become flags.
 */

import type { Answer, DecisionRequest, ModelRequest, Question } from '../src/ports.ts'

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
      'Example: a radically new product on a new market',
    ],
    ['Agenda', 'Risk', 'Uncertainty'],
    [
      'Risk versus uncertainty in practice',
      'Risk can be insured because insurers can price it',
      'Uncertainty cannot be insured because nobody can price it',
    ],
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
      'Five principles for acting under uncertainty',
    ],
    [
      'Bird in hand',
      'Start from who you are, what you know and whom you know',
      'Means come first, goals follow from the means at hand',
    ],
    [
      'Risk revisited',
      'Risk: an outcome whose probability can be calculated',
      'Effectuation avoids predicting risk and controls what it can',
    ],
  ],
  '03 Lean startup.pdf': [
    ['Lean startup', 'Build, measure, learn'],
    [
      'The build measure learn loop',
      'Build a minimum viable product',
      'Measure how customers react',
      'Learn, then pivot or persevere',
      'Repeat the loop quickly and cheaply',
    ],
  ],
  '04 Pivot.pdf': [
    ['Pivot or persevere', 'Lecture 4'],
    ['Organisation', 'The exam takes place on 11 February', 'Bring a pen'],
    [
      'Pivot',
      'A pivot changes the strategy and keeps the vision',
      'Persevere when the numbers improve',
    ],
  ],
}

const F = {
  riskIs: 'Risk is an outcome whose probability can be calculated or known.',
  riskTerm: 'An outcome with a calculable probability is called risk.',
  riskCase: 'Opening a hairdresser shop is an example of risk.',
  uncertaintyIs: 'Uncertainty is an outcome whose probability cannot be calculated.',
  insurable: 'Risk can be insured, uncertainty cannot.',
  principles:
    'The five effectual principles are bird in hand, affordable loss, crazy quilt, lemonade and pilot in the plane.',
  birdIs: 'Bird in hand means starting from who you are, what you know and whom you know.',
  birdMeans: 'Under bird in hand, means come first and goals follow.',
  riskAgain: 'Risk is an outcome whose probability can be calculated.',
  loop: 'The loop runs build, then measure, then learn.',
  mvp: 'The build step produces a minimum viable product.',
  early: 'Lean startup lowers risk by testing early.',
  examDate: 'The exam takes place on 11 February.',
  pivotIs: 'A pivot changes the strategy and keeps the vision.',
  persevere: 'A venture perseveres when its numbers improve.',
}

const fact = (text: string, slide: number, items = 0) => ({ text, slide, items })

interface FixtureMap {
  title: string
  topics: {
    name: string
    concepts: { name: string; facts: { text: string; slide: number; items: number }[] }[]
  }[]
}

/** The map each lecture should end up with. The scripted model reads it out slide by slide. */
const MAPS: Record<string, FixtureMap> = {
  '01 Risk.pdf': {
    title: 'Risk and uncertainty',
    topics: [
      {
        name: 'Knight',
        concepts: [
          {
            name: 'risk',
            facts: [fact(F.riskIs, 2), fact(F.riskTerm, 2), fact(F.riskCase, 2)],
          },
          {
            name: 'uncertainty',
            facts: [fact(F.uncertaintyIs, 3), fact(F.insurable, 5)],
          },
        ],
      },
    ],
  },
  '02 Effectuation.pdf': {
    title: 'Effectuation',
    topics: [
      {
        name: 'Principles',
        concepts: [
          { name: 'effectual principles', facts: [fact(F.principles, 2, 5)] },
          { name: 'bird in hand', facts: [fact(F.birdIs, 3), fact(F.birdMeans, 3)] },
          { name: 'Risk', facts: [fact(F.riskAgain, 4)] },
        ],
      },
    ],
  },
  '03 Lean startup.pdf': {
    title: 'Lean startup',
    topics: [
      {
        name: 'Loop',
        concepts: [
          { name: 'build measure learn', facts: [fact(F.loop, 2), fact(F.mvp, 2)] },
          { name: 'entrepreneurial risk', facts: [fact(F.early, 2)] },
        ],
      },
    ],
  },
  '04 Pivot.pdf': {
    title: 'Pivot or persevere',
    topics: [
      {
        name: 'Deciding',
        concepts: [
          { name: 'exam', facts: [fact(F.examDate, 2)] },
          { name: 'pivot', facts: [fact(F.pivotIs, 3)] },
          { name: 'persevere', facts: [fact(F.persevere, 3)] },
        ],
      },
    ],
  },
}

const KINDS: Record<string, string> = {
  [F.riskCase]: 'case',
  [F.insurable]: 'contrast',
  [F.principles]: 'list',
  [F.loop]: 'sequence',
}

const LONG =
  'It means to ==start from who you are==, from what you know and from whom you know, and to let the means come first while the goals follow from the means at hand.'

/** The first filled form per fact. */
/** A past paper of the course, and what the scripted model makes of it. */
export const EXAM = ['Exam Winter 2025/26', '1) What is risk according to Knight (1921)?']
export const EXAM_ANSWER = 'Knight (1921): risk is an outcome whose probability can be calculated.'
export const EXAM_GAP = 'Kickstarter funds a project only when it reaches its goal.'

const FILLS: Record<string, unknown> = {
  [EXAM_ANSWER]: {
    question: 'Knight (1921): how is risk defined?',
    answer: 'An outcome whose ==probability can be calculated==.',
    extra: '',
  },
  [EXAM_GAP]: {
    question: 'Kickstarter: when does a project get its money?',
    answer: 'Only when it ==reaches its funding goal==.',
    extra: '',
  },
  [F.riskIs]: {
    question: 'Knight (1921): what is risk?',
    answer: 'An outcome with a ==probability that is known== or can be worked out.',
    extra: '',
  },
  [F.riskTerm]: {
    question: 'Knight: which kind of outcome has a probability that can be calculated?',
    term: 'Risk',
    extra: '',
  },
  [F.riskCase]: {
    question: 'Opening a hairdresser shop: which kind of outcome?',
    term: 'risk',
    extra: '',
  },
  // Mistake: a yes/no question. Repaired.
  [F.uncertaintyIs]: {
    question: 'Is uncertainty an outcome whose probability cannot be calculated?',
    answer: 'An outcome whose ==probability cannot be calculated==.',
    extra: '',
  },
  [F.insurable]: {
    question: 'Risk versus uncertainty: how insurable is each?',
    sideA: 'Risk',
    valueA: 'can be insured',
    sideB: 'Uncertainty',
    valueB: 'cannot be insured',
    extra: '',
  },
  [F.principles]: {
    leadIn: "Sarasvathy's effectual principles:",
    items: ['bird in hand', 'affordable loss', 'crazy quilt', 'lemonade', 'pilot in the plane'],
    extra: '',
  },
  // Mistake: an answer of 33 words. Split into two cards.
  [F.birdIs]: {
    question: 'What does the bird in hand principle tell a founder?',
    answer: LONG,
    extra: '',
  },
  // Mistake: a term of nine words, in every attempt. Dropped.
  [F.birdMeans]: {
    question: 'Which principle puts means before goals?',
    term: 'the principle that the means come before the goals',
    extra: '',
  },
  // Mistake: the very question lecture 1 already asks. Dropped at the end.
  [F.riskAgain]: {
    question: 'Knight (1921): what is risk?',
    answer: 'An outcome whose ==probability can be calculated==.',
    extra: '',
  },
  [F.loop]: {
    question: 'Lean loop: which step follows build?',
    givenSteps: ['Build'],
    nextSteps: ['Measure'],
    extra: '',
  },
  // Looks like the uncertainty card of lecture 1. Flagged.
  [F.mvp]: {
    question: 'Knight (1921): what is uncertainty exactly?',
    answer: 'A ==minimum viable product== is built.',
    extra: '',
  },
  // No term of this answer is on the slide. The decision model doubts it: flagged.
  [F.early]: {
    question: 'Lean startup: how does it lower risk?',
    answer: 'By ==trying ideas out== before spending much.',
    extra: '',
  },
  // About the organisation of the course. Dropped by the card check, never repaired.
  [F.examDate]: {
    question: 'When does the exam take place?',
    answer: 'On ==11 February==.',
    extra: '',
  },
  // Mistake: the question leans on the slide. Sent back by the rule and reworded.
  [F.pivotIs]: {
    question: 'What does the slide say about a pivot?',
    answer: 'It changes the ==strategy== and keeps the vision.',
    extra: '',
  },
  // Mistake: the answer only turns the question around, in every attempt. Dropped.
  [F.persevere]: {
    question: 'When does a venture persevere?',
    answer: 'A venture ==perseveres==.',
    extra: '',
  },
}

const REPAIRS: Record<string, unknown> = {
  [F.uncertaintyIs]: {
    question: 'Knight (1921): what is uncertainty?',
    answer: 'An outcome whose ==probability cannot be calculated==.',
    extra: 'Example: a radically new product.',
  },
  [F.birdMeans]: FILLS[F.birdMeans],
  // Only asked for when the slide check is calibrated.
  [F.early]: {
    question: 'Lean startup: how does it lower risk?',
    answer: 'By building a ==minimum viable product== and measuring how customers react.',
    extra: '',
  },
  [F.pivotIs]: {
    question: 'Lean startup: what does a pivot change?',
    answer: 'The ==strategy==, while the vision stays.',
    extra: '',
  },
  [F.persevere]: FILLS[F.persevere],
}

const SPLITS: Record<string, unknown> = {
  [F.birdIs]: {
    cards: [
      {
        question: 'Bird in hand: what does a founder start from?',
        answer: 'From ==who you are==, what you know and whom you know.',
        extra: '',
      },
      {
        question: 'Bird in hand: what does a founder put first?',
        answer: 'The ==means==; goals follow from the means at hand.',
        extra: '',
      },
    ],
  },
}

export function script(request: ModelRequest): unknown {
  // A past paper: its questions. Then the families, then one answer per family.
  if (request.context.startsWith('Exam paper:')) {
    return {
      questions: [
        { number: '1', text: 'What is risk according to Knight (1921)?' },
        { number: '2', text: 'When does Kickstarter release the money?' },
      ],
    }
  }
  if (request.prompt.includes('Sort the questions into families')) {
    return {
      families: [
        {
          question: 'What is risk according to Knight (1921)?',
          members: ['Q1'],
          lecture: 1,
          concept: 'risk',
        },
        {
          question: 'When does Kickstarter release the money?',
          members: ['Q2'],
          lecture: 1,
          concept: 'Kickstarter',
        },
      ],
    }
  }
  if (request.prompt.startsWith('A question past exams')) {
    return request.prompt.includes('Kickstarter')
      ? { answer: EXAM_GAP, items: 0, slide: 0, fromSlides: false }
      : { answer: EXAM_ANSWER, items: 0, slide: 2, fromSlides: true }
  }
  const map = MAPS[/^Lecture file: (.+)$/m.exec(request.context)?.[1] ?? '']
  const concepts = map?.topics.flatMap((topic) => topic.concepts) ?? []
  // Reading one slide: the facts the map puts on it.
  if (request.task === 'read') {
    const slide = Number(/^Read slide (\d+) /.exec(request.prompt)![1])
    const facts = concepts.flatMap((concept) =>
      concept.facts
        .filter((fact) => fact.slide === slide)
        .map(({ text, items }) => ({ concept: concept.name, text, items })),
    )
    return { facts }
  }
  // Sorting the facts: the map itself, with the ids the prompt gave each fact.
  if (request.task === 'map') {
    const ids = new Map(
      [...request.prompt.matchAll(/^(F\d+) \(slide \d+\) [^:]+: (.+)$/gm)].map((m) => [
        m[2]!,
        m[1]!,
      ]),
    )
    return {
      title: map!.title,
      topics: map!.topics.map((topic) => ({
        name: topic.name,
        concepts: topic.concepts.map((concept) => ({
          name: concept.name,
          facts: concept.facts.map((fact) => ids.get(fact.text)!),
        })),
      })),
      repeats: [],
    }
  }
  const told = /^Fact to test: (.+) \(slide \d+\)$/m.exec(request.prompt)![1]!
  return { fill: FILLS, repair: REPAIRS, split: SPLITS }[request.task][told]
}

/** The decision model: sure about most things, with a few doubts. */
export function decisions(question: Question, request: DecisionRequest): Answer {
  if (question.type === 'choice') {
    if (question.ask.startsWith('Which kind of course'))
      return { type: 'choice', choice: 'concept', confidence: 0.9 }
    const slide = /^What kind of slide is slide (\d+)\?/.exec(question.ask)?.[1]
    if (slide) {
      const agenda = slide === '4' && request.context.startsWith('Lecture file: 01 Risk.pdf')
      return {
        type: 'choice',
        choice: slide === '1' ? 'title' : agenda ? 'agenda' : 'content',
        confidence: 0.9,
      }
    }
    const told = /^What kind of knowledge is this fact: "(.+)"$/.exec(question.ask)![1]!
    return { type: 'choice', choice: KINDS[told] ?? 'definition', confidence: 0.8 }
  }
  // Every fact is examinable, so a goal that cuts keeps the first facts of the map.
  if (question.type === 'score') return { type: 'score', score: 2 }
  // The card check sees one card as its whole input. One card of lecture 4 trips it.
  if (question.statement.startsWith('This flashcard is about the organisation of the course')) {
    const exam = request.context.includes('Question: When does the exam take place?')
    return { type: 'predicate', probability: exam ? 0.97 : 0.02 }
  }
  const doubts = [
    // Does the concept belong, are two concepts the same, does the slide support the card.
    ['This lecture teaches the concept "entrepreneurial risk".', 0.2],
    [
      '"entrepreneurial risk" in this lecture and "risk" from an earlier lecture are the same concept.',
      0.8,
    ],
    ['Answer: By trying ideas out before spending much.', 0.1],
    // Two look-alike pairs: one a duplicate, one a near twin. Other pairs are told apart.
    ['First: Knight (1921): what is uncertainty exactly?', 0.9],
    ['First: Bird in hand: what does a founder put first?', 0.3],
    ['These two flashcards test the same thing.', 0.05],
  ] as const
  const doubt = doubts.find(([text]) => question.statement.includes(text))
  return { type: 'predicate', probability: doubt?.[1] ?? 0.95 }
}
