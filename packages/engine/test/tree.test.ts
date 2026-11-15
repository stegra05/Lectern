import { describe, expect, it } from 'vitest'
import { assignNumbers, inCourseOrder } from '../src/course.ts'
import {
  FACTS_PER_CONCEPT,
  settleMap,
  fromGroups,
  type MapContext,
  type MapOutput,
} from '../src/tree.ts'

const ctx: MapContext = {
  slides: 6,
  earlier: new Map([['risk', { name: 'risk', lecture: 1 }]]),
  fallbackTitle: 'Slides',
}
const fact = (slide: number, text = `A fact on slide ${slide}.`) => ({ text, slide, items: 0 })
const concept = (name: string, slides: number[]) => ({
  name,
  facts: slides.map((s) => fact(s)),
})
const good: MapOutput = {
  title: 'Effectuation',
  topics: [
    {
      name: 'Principles',
      concepts: [concept('effectual principles', [2]), concept('bird in hand', [3, 2])],
    },
    { name: 'More', concepts: [concept('affordable loss', [5, 6])] },
  ],
}

describe('settleMap', () => {
  it('keeps a clean map: concepts with their facts and the slides those sit on', () => {
    const settled = settleMap(good, ctx)
    expect(settled.title).toBe('Effectuation')
    expect(settled.topics[0]).toEqual({
      name: 'Principles',
      concepts: [
        {
          id: 'effectual-principles',
          name: 'effectual principles',
          slides: [2],
          facts: [{ text: 'A fact on slide 2.', slide: 2, kind: 'definition' }],
        },
        {
          id: 'bird-in-hand',
          name: 'bird in hand',
          slides: [2, 3],
          facts: [
            { text: 'A fact on slide 3.', slide: 3, kind: 'definition' },
            { text: 'A fact on slide 2.', slide: 2, kind: 'definition' },
          ],
        },
      ],
    })
  })

  it('keeps the number of items of a list fact, and nothing for other facts', () => {
    const list = {
      name: 'five Cs',
      facts: [
        { text: 'The five Cs of lending.', slide: 2, items: 5 },
        { text: 'One C.', slide: 2, items: 0 },
        { text: 'Odd.', slide: 2, items: 1.5 },
      ],
    }
    const facts = settleMap(
      { title: 'T', topics: [{ name: 'T', concepts: [list, concept('rest', [3, 5, 6])] }] },
      ctx,
    ).topics[0]!.concepts[0]!.facts
    expect(facts.map((f) => f.items)).toEqual([5, undefined, undefined])
  })

  it('leaves out every unused slide', () => {
    expect(settleMap(good, ctx).leftOut).toEqual([
      { slide: 1, reason: 'No testable fact on this slide' },
      { slide: 4, reason: 'No testable fact on this slide' },
    ])
  })

  it('keeps one vocabulary: a concept an earlier lecture has takes its id, name and lecture', () => {
    const out = {
      ...good,
      topics: [...good.topics, { name: 'Again', concepts: [concept('Risk', [3])] }],
    }
    const again = settleMap(out, ctx).topics.at(-1)!.concepts[0]!
    expect(again).toMatchObject({ id: 'risk', name: 'risk', since: 1, slides: [3] })
  })

  it('drops facts on slides the lecture does not have', () => {
    const out = {
      ...good,
      topics: [
        { name: 'T', concepts: [concept('a', [2, 9]), concept('b', [7]), concept('c', [3, 5, 6])] },
      ],
    }
    const settled = settleMap(out, ctx)
    expect(settled.topics[0]!.concepts.map((c) => [c.id, c.slides])).toEqual([
      ['a', [2]],
      ['c', [3, 5, 6]],
    ])
  })

  it('cuts a concept with too many facts: several ideas under one name', () => {
    const out = {
      ...good,
      topics: [
        { name: 'T', concepts: [concept('a', [2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 5, 5, 6])] },
      ],
    }
    const kept = settleMap(out, ctx).topics[0]!.concepts[0]!
    expect(kept.facts).toHaveLength(FACTS_PER_CONCEPT)
    expect(kept.slides).toEqual([2, 3])
  })

  it('merges a concept named twice into the first, and drops an empty topic', () => {
    const out: MapOutput = {
      title: 'Effectuation',
      topics: [
        { name: 'A', concepts: [concept('Bird in hand', [2]), concept('X', [3])] },
        { name: 'B', concepts: [] },
        { name: 'C', concepts: [concept('bird in hand', [5, 6])] },
      ],
    }
    const settled = settleMap(out, ctx)
    expect(settled.topics.map((t) => t.name)).toEqual(['A'])
    expect(settled.topics[0]!.concepts.map((c) => [c.id, c.slides])).toEqual([
      ['bird-in-hand', [2, 5, 6]],
      ['x', [3]],
    ])
    expect(settled.leftOut.map((l) => l.slide)).toEqual([1, 4])
  })

  it('keeps no more than the limit of facts when a concept is merged', () => {
    const out: MapOutput = {
      title: 'T',
      topics: [
        { name: 'A', concepts: [concept('a', [2, 2, 2, 2, 2, 2, 2])] },
        { name: 'B', concepts: [concept('A', [3, 3, 3, 3, 3, 3, 3])] },
      ],
    }
    const merged = settleMap(out, ctx).topics[0]!.concepts[0]!
    expect(merged.facts).toHaveLength(FACTS_PER_CONCEPT)
    expect(merged.slides).toEqual([2, 3])
  })

  it('keeps the title within 32 characters', () => {
    const settled = settleMap(
      { ...good, title: 'Effectuation and the logic of entrepreneurial expertise' },
      ctx,
    )
    expect(settled.title).toBe('Effectuation and the logic of')
    expect(settleMap({ ...good, title: ' ' }, ctx).title).toBe('Slides')
  })

  it('says so when there is nothing to learn', () => {
    const settled = settleMap({ title: 'Welcome', topics: [] }, ctx)
    expect(settled.topics).toEqual([])
    expect(settled.leftOut).toHaveLength(6)
  })
})

describe('lecture files', () => {
  it('are read in course order, numbers compared as numbers', () => {
    expect(
      inCourseOrder(['10 Legal.pdf', '2 Effectuation.pdf', 'notes.txt', '1 Intro.PDF']),
    ).toEqual(['1 Intro.PDF', '2 Effectuation.pdf', '10 Legal.pdf'])
  })

  it('take the leading number of the file name when it is free', () => {
    expect(assignNumbers([], ['01 Intro.pdf', '02 Effectuation.pdf', '04 Model.pdf'])).toEqual([
      1, 2, 4,
    ])
    expect(assignNumbers([1, 2, 4], ['03 Opportunity.pdf'])).toEqual([3])
  })

  it('take the next number otherwise, and never one that is taken', () => {
    expect(assignNumbers([], ['Intro.pdf', 'Effectuation.pdf'])).toEqual([1, 2])
    expect(assignNumbers([1, 2], ['02 Effectuation v2.pdf', 'Guest.pdf'])).toEqual([3, 4])
  })
})

describe('the map from the facts read slide by slide', () => {
  const facts = [
    { concept: 'Growth phases', text: 'Greiner names five phases.', slide: 9, items: 5 },
    {
      concept: 'Creativity',
      text: 'Creativity ends in a crisis of leadership.',
      slide: 9,
      items: 0,
    },
    { concept: 'Growth phases', text: 'Greiner has five phases.', slide: 12, items: 5 },
    { concept: 'IPO', text: 'An IPO sells shares on a stock market.', slide: 14, items: 0 },
  ]
  const id = (i: number) => `F${i + 1}`

  it('puts each fact under the concept the model sorted it into', () => {
    const map = fromGroups(
      facts,
      {
        title: 'Growth',
        topics: [
          { name: 'Phases', concepts: [{ name: 'Greiner growth phases', facts: ['F1', 'F2'] }] },
          { name: 'Exit', concepts: [{ name: 'IPO', facts: ['F4'] }] },
        ],
        repeats: ['F3'],
      },
      id,
    )
    expect(map).toEqual({
      title: 'Growth',
      topics: [
        {
          name: 'Phases',
          concepts: [
            {
              name: 'Greiner growth phases',
              facts: [
                { text: 'Greiner names five phases.', slide: 9, items: 5 },
                { text: 'Creativity ends in a crisis of leadership.', slide: 9, items: 0 },
              ],
            },
          ],
        },
        {
          name: 'Exit',
          concepts: [
            {
              name: 'IPO',
              facts: [{ text: 'An IPO sells shares on a stock market.', slide: 14, items: 0 }],
            },
          ],
        },
      ],
    })
  })

  it('keeps a fact the model forgot, under the concept the reading named, and counts an id once', () => {
    const map = fromGroups(
      facts,
      {
        title: 'Growth',
        topics: [
          { name: 'Phases', concepts: [{ name: 'growth phases', facts: ['F1', 'F1', 'F9'] }] },
        ],
        repeats: [],
      },
      id,
    )
    expect(map.topics[0]!.concepts.map((c) => [c.name, c.facts.map((f) => f.slide)])).toEqual([
      ['growth phases', [9, 12]],
      ['Creativity', [9]],
      ['IPO', [14]],
    ])
  })
})
