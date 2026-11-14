import { describe, expect, it } from 'vitest'
import { assignNumbers, inCourseOrder } from '../src/course.ts'
import { settleMap, type MapContext, type MapOutput } from '../src/tree.ts'

const ctx: MapContext = {
  slideCount: 6,
  emptySlides: [4],
  earlier: new Map([['risk', 1]]),
  fallbackTitle: 'Slides',
}
const good: MapOutput = {
  title: 'Effectuation',
  topics: [
    {
      name: 'Principles',
      concepts: [
        { name: 'effectual principles', slides: [2] },
        { name: 'bird in hand', slides: [3, 2] },
      ],
    },
  ],
  leftOut: [
    { slides: [1], reason: 'Title slide' },
    { slides: [5, 6], reason: 'Organisational' },
  ],
}

describe('settleMap', () => {
  it('keeps a clean map and adds the reason for slides without text', () => {
    const settled = settleMap(good, ctx)
    expect(settled.problems).toEqual([])
    expect(settled.title).toBe('Effectuation')
    expect(settled.topics).toEqual([
      {
        name: 'Principles',
        concepts: [
          { id: 'effectual-principles', name: 'effectual principles', slides: [2] },
          { id: 'bird-in-hand', name: 'bird in hand', slides: [2, 3] },
        ],
      },
    ])
    expect(settled.leftOut).toEqual([
      { slide: 1, reason: 'Title slide' },
      { slide: 4, reason: 'No readable text on this slide' },
      { slide: 5, reason: 'Organisational' },
      { slide: 6, reason: 'Organisational' },
    ])
  })

  it('accounts for every slide: unassigned slides are a problem and get a reason from code', () => {
    const settled = settleMap({ ...good, leftOut: [{ slides: [1], reason: 'Title slide' }] }, ctx)
    expect(settled.problems).toEqual([
      'slides 5 to 6: neither used by a concept nor left out with a reason',
    ])
    expect(settled.leftOut.slice(-2)).toEqual([
      { slide: 5, reason: 'No concept found on this slide' },
      { slide: 6, reason: 'No concept found on this slide' },
    ])
  })

  it('drops a concept an earlier lecture covers and leaves its slides out with that reason', () => {
    const out = { ...good, leftOut: good.leftOut.slice(0, 1) }
    out.topics = [
      {
        name: 'Principles',
        concepts: [...good.topics[0]!.concepts, { name: 'Risk', slides: [5, 6] }],
      },
    ]
    const settled = settleMap(out, ctx)
    expect(settled.problems).toEqual([])
    expect(settled.covered).toEqual([{ name: 'Risk', lecture: 1 }])
    expect(settled.topics[0]!.concepts.map((c) => c.id)).toEqual([
      'effectual-principles',
      'bird-in-hand',
    ])
    expect(settled.leftOut.at(-1)).toEqual({ slide: 6, reason: 'Already covered in lecture 1' })
  })

  it('reports and repairs slide numbers that do not exist or have no text', () => {
    const out = {
      ...good,
      topics: [
        {
          name: 'T',
          concepts: [
            { name: 'a', slides: [2, 4, 9] },
            { name: 'b', slides: [7] },
            { name: 'c', slides: [3] },
          ],
        },
      ],
    }
    const settled = settleMap(out, ctx)
    expect(settled.problems).toEqual([
      'concept "a" names slides 4 and 9 without readable text',
      'concept "b" names slide 7 without readable text',
      'concept "b" has no slide',
    ])
    expect(settled.topics[0]!.concepts).toEqual([
      { id: 'a', name: 'a', slides: [2] },
      { id: 'c', name: 'c', slides: [3] },
    ])
  })

  it('reports a repeated concept, an empty topic, a long name and a missing reason', () => {
    const out: MapOutput = {
      title: 'Effectuation',
      topics: [
        {
          name: 'A',
          concepts: [
            { name: 'Bird in hand', slides: [2] },
            { name: 'bird in hand', slides: [3] },
          ],
        },
        { name: 'B', concepts: [] },
        { name: 'C', concepts: [{ name: 'one two three four five six seven', slides: [3] }] },
      ],
      leftOut: [{ slides: [1, 5, 6], reason: ' ' }],
    }
    const settled = settleMap(out, ctx)
    expect(settled.problems).toEqual([
      'concept "bird in hand" appears twice',
      'topic "B" has no concepts',
      'concept "one two three four five six seven" has more than 6 words',
      'slides 1 and 5 to 6 left out without a reason',
    ])
    expect(settled.topics.map((t) => t.name)).toEqual(['A', 'C'])
  })

  it('keeps the title within 32 characters', () => {
    const settled = settleMap(
      { ...good, title: 'Effectuation and the logic of entrepreneurial expertise' },
      ctx,
    )
    expect(settled.title).toBe('Effectuation and the logic of')
    expect(settled.problems).toEqual(['title has 55 characters; the limit is 32'])
    expect(settleMap({ ...good, title: ' ' }, ctx).title).toBe('Slides')
  })

  it('says so when there is nothing to learn', () => {
    const settled = settleMap({ title: 'Welcome', topics: [], leftOut: [] }, ctx)
    expect(settled.problems).toContain('the map has no concepts')
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
