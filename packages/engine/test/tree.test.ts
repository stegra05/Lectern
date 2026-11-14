import { describe, expect, it } from 'vitest'
import { assignNumbers, inCourseOrder } from '../src/course.ts'
import type { SlideKind } from '../src/decide.ts'
import { FACTS_PER_CONCEPT, settleMap, type MapContext, type MapOutput } from '../src/tree.ts'

const kinds: SlideKind[] = ['title', 'content', 'content', 'agenda', 'content', 'content']
const ctx: MapContext = {
  kinds,
  contentOnly: false,
  earlier: new Map([['risk', { name: 'risk', lecture: 1 }]]),
  fallbackTitle: 'Slides',
}
const fact = (slide: number, text = `A fact on slide ${slide}.`) => ({ text, slide })
const concept = (name: string, slides: number[], core = true) => ({
  name,
  core,
  facts: slides.map((s) => fact(s)),
})
const good: MapOutput = {
  title: 'Effectuation',
  topics: [
    {
      name: 'Principles',
      concepts: [concept('effectual principles', [2]), concept('bird in hand', [3, 2], false)],
    },
    { name: 'More', concepts: [concept('affordable loss', [5, 6])] },
  ],
}

describe('settleMap', () => {
  it('keeps a clean map: concepts with their facts and the slides those sit on', () => {
    const settled = settleMap(good, ctx)
    expect(settled.problems).toEqual([])
    expect(settled.title).toBe('Effectuation')
    expect(settled.topics[0]).toEqual({
      name: 'Principles',
      concepts: [
        {
          id: 'effectual-principles',
          name: 'effectual principles',
          slides: [2],
          core: true,
          facts: [{ text: 'A fact on slide 2.', slide: 2, kind: 'definition' }],
        },
        {
          id: 'bird-in-hand',
          name: 'bird in hand',
          slides: [2, 3],
          core: false,
          facts: [
            { text: 'A fact on slide 3.', slide: 3, kind: 'definition' },
            { text: 'A fact on slide 2.', slide: 2, kind: 'definition' },
          ],
        },
      ],
    })
  })

  it('leaves out every unused slide, with its kind as the reason', () => {
    expect(settleMap(good, ctx).leftOut).toEqual([
      { slide: 1, reason: 'Title slide' },
      { slide: 4, reason: 'Agenda slide' },
    ])
  })

  it('reports content slides without a fact and gives them a reason from code', () => {
    const settled = settleMap({ ...good, topics: good.topics.slice(0, 1) }, ctx)
    expect(settled.problems).toEqual(['slides 5 to 6: content slides without any fact'])
    expect(settled.leftOut.slice(-2)).toEqual([
      { slide: 5, reason: 'No testable fact found on this slide' },
      { slide: 6, reason: 'No testable fact found on this slide' },
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

  it('lets facts sit on any slide until the slide labels are calibrated', () => {
    const out = {
      ...good,
      topics: [
        { name: 'T', concepts: [concept('a', [1, 2]), concept('b', [4]), concept('c', [3, 5, 6])] },
      ],
    }
    expect(settleMap(out, ctx).problems).toEqual([])
    const strict = settleMap(out, { ...ctx, contentOnly: true })
    expect(strict.problems).toEqual([
      'concept "a" takes facts from slide 1, which are not content slides',
      'concept "b" takes facts from slide 4, which are not content slides',
      'concept "b" has no fact',
    ])
    expect(strict.topics[0]!.concepts.map((c) => [c.id, c.slides])).toEqual([
      ['a', [2]],
      ['c', [3, 5, 6]],
    ])
  })

  it('reports and drops facts on slides the lecture does not have', () => {
    const out = {
      ...good,
      topics: [
        { name: 'T', concepts: [concept('a', [2, 9]), concept('b', [7]), concept('c', [3, 5, 6])] },
      ],
    }
    const settled = settleMap(out, ctx)
    expect(settled.problems).toEqual([
      'concept "a" takes facts from slide 9, which the lecture does not have',
      'concept "b" takes facts from slide 7, which the lecture does not have',
      'concept "b" has no fact',
    ])
  })

  it('cuts a concept with too many facts: a map split too finely', () => {
    const out = {
      ...good,
      topics: [{ name: 'T', concepts: [concept('a', [2, 2, 2, 3, 3, 3, 5, 5, 6])] }],
    }
    const kept = settleMap(out, ctx).topics[0]!.concepts[0]!
    expect(kept.facts).toHaveLength(FACTS_PER_CONCEPT)
    expect(kept.slides).toEqual([2, 3])
  })

  it('reports a repeated concept, an empty topic and a long name', () => {
    const out: MapOutput = {
      title: 'Effectuation',
      topics: [
        { name: 'A', concepts: [concept('Bird in hand', [2]), concept('bird in hand', [3])] },
        { name: 'B', concepts: [] },
        { name: 'C', concepts: [concept('one two three four five six seven', [3, 5, 6])] },
      ],
    }
    const settled = settleMap(out, ctx)
    expect(settled.problems).toEqual([
      'concept "bird in hand" appears twice',
      'topic "B" has no concepts',
      'concept "one two three four five six seven" has more than 6 words',
    ])
    expect(settled.topics.map((t) => t.name)).toEqual(['A', 'C'])
  })

  it('needs a core: when nothing is marked, everything counts as core', () => {
    const out = {
      ...good,
      topics: [{ name: 'T', concepts: [concept('a', [2, 3], false), concept('b', [5, 6], false)] }],
    }
    const settled = settleMap(out, ctx)
    expect(settled.problems).toEqual([
      'no concept is marked as core; mark the ones a student needs to pass',
    ])
    expect(settled.topics[0]!.concepts.every((c) => c.core)).toBe(true)
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
    const settled = settleMap({ title: 'Welcome', topics: [] }, ctx)
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
