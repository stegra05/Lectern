import { describe, expect, it } from 'vitest'
import { assemble, type Paper } from '../eval/bench/rubric.ts'
import {
  compare,
  coverage,
  ingest,
  open,
  pairKey,
  score,
  shortlist,
  standings,
  type Card,
  type Point,
  type Verdicts,
} from '../eval/bench/score.ts'

const paper: Paper = {
  paper: 'Summer 26',
  total: 10,
  choices: [],
  questions: [
    {
      number: '1',
      asks: 'The unique offering a firm promises its customers is the value A) promise B) proposition',
      marks: 2,
      points: [
        {
          knows: 'The value proposition is the unique offering a firm promises to its customers.',
          marks: 2,
          kind: 'recall',
          basis: 'slides',
        },
      ],
    },
    {
      number: '2',
      asks: 'Name two of the three key ideas of effectuation.',
      marks: 4,
      points: ['Affordable loss', 'Available means', 'Surprises as opportunities'].map((idea) => ({
        knows: `${idea} is a key idea of effectuation.`,
        marks: 2,
        kind: 'recall' as const,
        basis: 'slides' as const,
      })),
    },
    {
      number: '3',
      asks: 'Apply the five forces to the airline case.',
      marks: 4,
      points: [
        {
          knows: 'Applies the five forces to the airline case.',
          marks: 4,
          kind: 'apply',
          basis: 'own',
        },
      ],
    },
  ],
}
const { points } = assemble('Entrepreneurship', [paper])
const [proposition, loss, means, surprises, forces] = points as [Point, Point, Point, Point, Point]

const cards: Card[] = [
  {
    id: 'vp',
    question: 'What is a value proposition?',
    answer: 'The unique offering a firm promises.',
  },
  {
    id: 'loss',
    question: 'Effectuation: what does affordable loss mean?',
    answer: 'Risk only what you can lose.',
  },
  {
    id: 'means',
    question: 'Effectuation starts from which means?',
    answer: 'The available means.',
  },
  { id: 'lemon', question: 'How does effectuation treat surprises?', answer: 'As opportunities.' },
  { id: 'porter', question: 'Who named the five forces?', answer: 'Porter' },
]
const card = (id: string) => cards.find((c) => c.id === id)!

function verdictsOf(held: [Point, string][]): Verdicts {
  const verdicts: Verdicts = {}
  ingest(
    held.map(([point, id]) => ({ point: point.id, card: id, verdict: 'same' as const })),
    points,
    cards,
    verdicts,
  )
  return verdicts
}

describe('the rubric', () => {
  it('gives every point an id, its question and the marks of its question', () => {
    expect(points.map((p) => p.id)).toEqual([
      'Summer 26/1/1',
      'Summer 26/2/1',
      'Summer 26/2/2',
      'Summer 26/2/3',
      'Summer 26/3/1',
    ])
    expect(loss.questionMarks).toBe(4)
  })

  it('refuses a paper whose questions do not add up to its total', () => {
    expect(() => assemble('c', [{ ...paper, total: 12 }])).toThrow('carry 10 marks, the paper 12')
  })

  it('takes marks that are fractions', () => {
    const fine = structuredClone(paper)
    const [first] = fine.questions[0]!.points
    fine.questions[0]!.points = [0.3, 0.3, 0.3, 0.3, 0.3, 0.5].map((marks) => ({
      ...first!,
      marks,
    }))
    expect(assemble('c', [fine]).points).toHaveLength(10)
  })

  it('refuses a question whose points earn less than its marks', () => {
    const short = structuredClone(paper)
    short.questions[0]!.points[0]!.marks = 1
    expect(() => assemble('c', [short])).toThrow('question 1: its points earn 1 of 2 marks')
  })
})

describe('the shortlist', () => {
  it('puts the card that shares the words of a point first', () => {
    const short = shortlist(points, cards, 2)
    expect(short.get(proposition.id)![0]!.id).toBe('vp')
    expect(short.get(loss.id)![0]!.id).toBe('loss')
    expect(short.get(proposition.id)!.length).toBeLessThanOrEqual(2)
  })
})

describe('verdicts', () => {
  it('are kept under the texts of the pair, so a reworded card is judged anew', () => {
    const reworded = { ...card('vp'), answer: 'What a firm offers.' }
    expect(pairKey(proposition, card('vp'))).toBe(pairKey(proposition, { ...card('vp') }))
    expect(pairKey(proposition, reworded)).not.toBe(pairKey(proposition, card('vp')))
  })

  it('leave only the pairs no judge has decided open', () => {
    const short = shortlist(points, cards, 2)
    const all = open(points, short, {})
    expect(all.find((entry) => entry.point.id === proposition.id)!.cards.length).toBeGreaterThan(0)
    const verdicts: Verdicts = {}
    for (const { point, cards: list } of all) {
      ingest(
        list.map((c) => ({ point: point.id, card: c.id, verdict: 'no' as const })),
        points,
        cards,
        verdicts,
      )
    }
    expect(open(points, short, verdicts)).toEqual([])
  })

  it('ask once about a fact that two papers share', () => {
    const twice = [proposition, { ...proposition, id: 'Winter 25/3/1', paper: 'Winter 25' }]
    const pairs = open(twice, shortlist(twice, cards, 2), {})
    expect(pairs.map((entry) => entry.point.id)).toEqual([proposition.id])
    const verdicts: Verdicts = {}
    ingest([{ point: proposition.id, card: 'vp', verdict: 'same' }], twice, cards, verdicts)
    expect(standings(twice, cards, verdicts).map((s) => s.verdict)).toEqual(['same', 'same'])
  })

  it('refuse a point or a card the run does not have', () => {
    const label = { point: proposition.id, card: 'vp', verdict: 'same' as const }
    expect(() => ingest([{ ...label, point: 'x' }], points, cards, {})).toThrow('the point x')
    expect(() => ingest([{ ...label, card: 'y' }], points, cards, {})).toThrow('the card y')
  })

  it('give a point the best verdict of any card', () => {
    const verdicts = verdictsOf([[proposition, 'vp']])
    ingest([{ point: proposition.id, card: 'porter', verdict: 'no' }], points, cards, verdicts)
    const [first, second] = standings(points, cards, verdicts)
    expect(first).toMatchObject({ verdict: 'same', card: 'vp' })
    expect(second).toMatchObject({ verdict: 'no', card: null })
  })
})

describe('coverage', () => {
  it('is the share of the marks, and a question pays no more than its own marks', () => {
    // Question 1 held (2 of 2), two of the three ideas held (4 of 4), the case not (0 of 4).
    const list = standings(
      points,
      cards,
      verdictsOf([
        [proposition, 'vp'],
        [loss, 'loss'],
        [means, 'means'],
      ]),
    )
    expect(coverage(list)).toBe(0.6)
    // The third idea adds nothing: the question is full.
    const more = standings(
      points,
      cards,
      verdictsOf([
        [proposition, 'vp'],
        [loss, 'loss'],
        [means, 'means'],
        [surprises, 'lemon'],
      ]),
    )
    expect(coverage(more)).toBe(0.6)
  })

  it('counts only the best questions of a choice', () => {
    const question = (number: string): Paper['questions'][number] => ({
      number,
      asks: `Essay ${number}`,
      marks: 30,
      points: ['first', 'second'].map((half) => ({
        knows: `The ${half} half of essay ${number}.`,
        marks: 15,
        kind: 'recall' as const,
        basis: 'slides' as const,
      })),
    })
    const essays = { paper: 'p', total: 30, choices: [{ questions: ['1', '2'], pick: 1 }] }
    const rubric = assemble('c', [{ ...essays, questions: [question('1'), question('2')] }])
    const stand = (held: number[]) =>
      rubric.points.map((point, i) => ({
        point,
        verdict: held.includes(i) ? ('same' as const) : ('no' as const),
        card: null,
      }))
    // Half of each essay is half of the one essay a student writes, not a whole one.
    expect(coverage(stand([0, 2]))).toBe(0.5)
    expect(coverage(stand([2, 3]))).toBe(1)
    expect(() =>
      assemble('c', [{ ...essays, total: 60, questions: [question('1'), question('2')] }]),
    ).toThrow('carry 30 marks, the paper 60')
  })

  it('has an interval that holds it and is the same every time', () => {
    const list = standings(points, cards, verdictsOf([[proposition, 'vp']]))
    const first = score(list)
    expect(first.coverage).toBe(0.2)
    expect(first.low).toBeLessThanOrEqual(0.2)
    expect(first.high).toBeGreaterThanOrEqual(0.2)
    expect(score(list)).toEqual(first)
  })

  it('draws a unit as a whole, so a half-held question never counts as full', () => {
    // One question, half of its marks held: every draw of it is a half, whatever is drawn.
    const list = standings(points, cards, verdictsOf([[loss, 'loss']])).filter(
      (s) => s.point.question === '2',
    )
    expect(score(list)).toEqual({ coverage: 0.5, low: 0.5, high: 0.5 })
  })

  it('compares two decks point by point', () => {
    const before = standings(points, cards, verdictsOf([[proposition, 'vp']]))
    const after = standings(
      points,
      cards,
      verdictsOf([
        [loss, 'loss'],
        [means, 'means'],
        [forces, 'porter'],
      ]),
    )
    const result = compare(before, after)
    expect(result.difference).toBeCloseTo(0.6)
    expect(result.gained.map((p) => p.id)).toEqual([loss.id, means.id, forces.id])
    expect(result.lost.map((p) => p.id)).toEqual([proposition.id])
  })
})
