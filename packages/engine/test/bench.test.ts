import { describe, expect, it } from 'vitest'
import { assemble, type Paper } from '../eval/bench/rubric.ts'
import {
  compare,
  considered,
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
/** Every card looked at for every point. */
const every = (list: Point[]) => new Map(list.map((point) => [point.id, cards]))

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

  it('refuses papers and questions named twice, and a choice that is none', () => {
    expect(() => assemble('c', [paper, paper])).toThrow('Two paper files are named Summer 26')
    const twice = structuredClone(paper)
    twice.questions[1]!.number = '1'
    expect(() => assemble('c', [twice])).toThrow('two questions carry the same number')
    const all = { ...paper, choices: [{ questions: ['1', '2'], pick: 2 }] }
    expect(() => assemble('c', [all])).toThrow('picks all of its questions or more')
    const both = {
      ...paper,
      choices: [
        { questions: ['2', '3'], pick: 1 },
        { questions: ['3', '2'], pick: 1 },
      ],
    }
    expect(() => assemble('c', [both])).toThrow('is in two choices')
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

  it('keep apart two cards whose texts differ only in where the question ends', () => {
    const one = { id: 'a', question: 'What is\nx', answer: 'y' }
    const other = { id: 'b', question: 'What is', answer: 'x\ny' }
    expect(pairKey(proposition, one)).not.toBe(pairKey(proposition, other))
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
    expect(standings(twice, every(twice), verdicts).map((s) => s.verdict)).toEqual(['same', 'same'])
  })

  it('stand once kept: a later judge who differs changes nothing', () => {
    const verdicts: Verdicts = {}
    const label = { point: proposition.id, card: 'vp', verdict: 'partial' as const }
    expect(ingest([label], points, cards, verdicts)).toEqual({ added: 1, differing: 0 })
    expect(ingest([{ ...label, verdict: 'same' }], points, cards, verdicts)).toEqual({
      added: 0,
      differing: 1,
    })
    expect(verdicts[pairKey(proposition, card('vp'))]).toBe('partial')
  })

  it('count for a run only on its shortlist and on what its own judges found', () => {
    const twin = { ...loss, id: 'Winter 25/2/1', paper: 'Winter 25' }
    const list = [proposition, loss, twin]
    const short = new Map(list.map((point) => [point.id, [card('porter')]]))
    // Another run's judge once found that the card `loss` holds the fact.
    const verdicts = verdictsOf([[loss, 'loss']])
    const blind = considered(list, cards, short, [])
    expect(standings(list, blind, verdicts).map((s) => s.verdict)).toEqual(['no', 'no', 'no'])
    // This run's own judge found it, for one of the two points that share the fact.
    const found = considered(list, cards, short, [
      { point: loss.id, card: 'loss', verdict: 'same' },
    ])
    expect(found.get(twin.id)!.map((c) => c.id)).toEqual(['porter', 'loss'])
    expect(standings(list, found, verdicts).map((s) => s.verdict)).toEqual(['no', 'same', 'same'])
  })

  it('refuse a point or a card the run does not have', () => {
    const label = { point: proposition.id, card: 'vp', verdict: 'same' as const }
    expect(() => ingest([{ ...label, point: 'x' }], points, cards, {})).toThrow('the point x')
    expect(() => ingest([{ ...label, card: 'y' }], points, cards, {})).toThrow('the card y')
  })

  it('give a point the best verdict of any card', () => {
    const verdicts = verdictsOf([[proposition, 'vp']])
    ingest([{ point: proposition.id, card: 'porter', verdict: 'no' }], points, cards, verdicts)
    const [first, second] = standings(points, every(points), verdicts)
    expect(first).toMatchObject({ verdict: 'same', card: 'vp' })
    expect(second).toMatchObject({ verdict: 'no', card: null })
    // A card judged to be about something else is not the point's card.
    ingest([{ point: loss.id, card: 'porter', verdict: 'no' }], points, cards, verdicts)
    expect(standings(points, every(points), verdicts)[1]).toMatchObject({
      verdict: 'no',
      card: null,
    })
    ingest([{ point: loss.id, card: 'means', verdict: 'partial' }], points, cards, verdicts)
    expect(standings(points, every(points), verdicts)[1]).toMatchObject({
      verdict: 'partial',
      card: 'means',
    })
  })
})

describe('coverage', () => {
  it('is the share of the marks, and a question pays no more than its own marks', () => {
    // Question 1 held (2 of 2), two of the three ideas held (4 of 4), the case not (0 of 4).
    const list = standings(
      points,
      every(points),
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
      every(points),
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

  /** An exam of `count` questions of two marks, one point each, the listed ones held. */
  function exam(count: number, held: number[]) {
    const questions = Array.from({ length: count }, (_, i) => ({
      number: String(i + 1),
      asks: `Question ${i + 1}`,
      marks: 2,
      points: [
        { knows: `Fact ${i + 1}.`, marks: 2, kind: 'recall' as const, basis: 'slides' as const },
      ],
    }))
    const rubric = assemble('c', [{ paper: 'p', total: 2 * count, choices: [], questions }])
    return rubric.points.map((point, i) => ({
      point,
      verdict: held.includes(i) ? ('same' as const) : ('no' as const),
      card: null,
    }))
  }

  it('counts the best two of a choice of three', () => {
    const question = (number: string) => ({
      number,
      asks: `Short answer ${number}`,
      marks: 4,
      points: [
        { knows: `Fact ${number}.`, marks: 4, kind: 'recall' as const, basis: 'slides' as const },
      ],
    })
    const paper3 = {
      paper: 'p',
      total: 8,
      choices: [{ questions: ['1', '2', '3'], pick: 2 }],
      questions: ['1', '2', '3'].map(question),
    }
    const rubric = assemble('c', [paper3])
    const stand = (held: number[]) =>
      rubric.points.map((point, i) => ({
        point,
        verdict: held.includes(i) ? ('same' as const) : ('no' as const),
        card: null,
      }))
    expect(coverage(stand([2]))).toBe(0.5)
    expect(coverage(stand([0, 2]))).toBe(1)
    expect(coverage(stand([0, 1, 2]))).toBe(1)
  })

  it('has an interval around it that is the same every time', () => {
    const list = exam(20, [0, 1, 2, 3, 4])
    const first = score(list)
    expect(first.coverage).toBe(0.25)
    const [low, high] = first.interval!
    expect(low).toBeLessThan(0.25)
    expect(high).toBeGreaterThan(0.25)
    expect(low).toBeGreaterThanOrEqual(0)
    expect(high).toBeLessThan(0.6)
    expect(score(list)).toEqual(first)
  })

  it('gives no interval from a handful of questions', () => {
    expect(score(exam(9, [0])).interval).toBeNull()
    expect(compare(exam(9, [0]), exam(9, [0, 1])).interval).toBeNull()
  })

  it('draws a question as a whole, so a half-held question never counts as full', () => {
    // Ten questions, each half held: every draw is a half, whatever is drawn.
    const half = Array.from({ length: 10 }, (_, i) => ({
      number: String(i + 1),
      asks: `Question ${i + 1}`,
      marks: 4,
      points: ['first', 'second'].map((part) => ({
        knows: `The ${part} half of fact ${i + 1}.`,
        marks: 2,
        kind: 'recall' as const,
        basis: 'slides' as const,
      })),
    }))
    const rubric = assemble('c', [{ paper: 'p', total: 40, choices: [], questions: half }])
    const list = rubric.points.map((point, i) => ({
      point,
      verdict: i % 2 === 0 ? ('same' as const) : ('no' as const),
      card: null,
    }))
    expect(score(list)).toEqual({ coverage: 0.5, interval: [0.5, 0.5] })
  })

  it('pairs two decks question by question', () => {
    // The second deck holds all the first holds and four questions more: every draw gains.
    const gain = compare(exam(20, [0, 1, 2]), exam(20, [0, 1, 2, 3, 4, 5, 6]))
    expect(gain.difference).toBeCloseTo(0.2)
    expect(gain.interval![0]).toBeGreaterThan(0)
    // The same deck twice differs by nothing in every draw.
    expect(compare(exam(20, [0, 5]), exam(20, [0, 5])).interval).toEqual([0, 0])
    // Decks that hold as much on other questions: no difference, and an interval around zero.
    const swap = compare(exam(20, [0, 1, 2]), exam(20, [3, 4, 5]))
    expect(swap.difference).toBe(0)
    expect(swap.interval![0]).toBeLessThan(0)
    expect(swap.interval![1]).toBeGreaterThan(0)
    expect(() => compare(exam(20, []), exam(19, []))).toThrow('the same points')
  })

  it('compares two decks point by point', () => {
    const before = standings(points, every(points), verdictsOf([[proposition, 'vp']]))
    const after = standings(
      points,
      every(points),
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
