import { describe, expect, it } from 'vitest'
import type { Box, RingsInput } from './rings.ts'
import {
  DISC,
  baseline,
  dotRadius,
  fitRings,
  labelBox,
  layoutRings,
  pillBox,
  pillFloor,
  placeLabels,
} from './rings.ts'

const measure = (text: string, weight: 400 | 600) => text.length * (weight === 600 ? 7.4 : 6.9)

function lecture(topics: [string, [string, number][]][]): RingsInput {
  return {
    topics: topics.map(([name, concepts]) => ({
      name,
      concepts: concepts.map(([c]) => ({ id: c, name: c })),
    })),
    cards: topics.flatMap(([, concepts]) =>
      concepts.flatMap(([c, n]) => Array.from({ length: n }, () => ({ concept: c }))),
    ),
  }
}

/** Lecture 02 as the canvas draws it. */
const effectuation = lecture([
  [
    'Deciding under uncertainty',
    [
      ['Knight: risk vs uncertainty', 6],
      ['Causation vs effectuation', 9],
    ],
  ],
  [
    'Start with what you have',
    [
      ['Bird in hand', 8],
      ['Affordable loss', 8],
      ['Crazy quilt', 7],
    ],
  ],
  [
    'Shape the future',
    [
      ['Lemonade', 7],
      ['Pilot in the plane', 7],
    ],
  ],
])

/** Lecture 05 of the large canvas: four topics, twelve concepts. */
const lean = lecture([
  [
    'Build, measure, learn',
    [
      ['Build-measure-learn loop', 6],
      ['Minimum viable product', 7],
      ['Validated learning', 5],
    ],
  ],
  [
    'Testing assumptions',
    [
      ['Leap-of-faith assumptions', 4],
      ['Value hypothesis', 3],
      ['Growth hypothesis', 3],
      ['Split testing', 4],
    ],
  ],
  [
    'Customer development',
    [
      ['Customer discovery', 5],
      ['Problem interview', 4],
      ['Early adopters', 3],
    ],
  ],
  [
    'Pivot or persevere',
    [
      ['Pivot types', 6],
      ['Innovation accounting', 4],
    ],
  ],
])

const deg = (a: number) => ((((a * 180) / Math.PI) % 360) + 360) % 360
const gap = (a: number, b: number) => (deg(b) - deg(a) + 360) % 360

const overlaps = (a: Box, b: Box) =>
  Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
  Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)

describe('layoutRings', () => {
  it('puts topics on the inner ring and concepts on the outer ring', () => {
    const rings = layoutRings(effectuation, measure)
    for (const t of rings.topics) expect(Math.hypot(t.x, t.y)).toBeCloseTo(135, 6)
    for (const c of rings.concepts) expect(Math.hypot(c.x, c.y)).toBeCloseTo(225, 6)
  })

  it('spaces concepts as the canvas: 43.9 degrees apart, 17.6 more between sectors', () => {
    const { concepts } = layoutRings(effectuation, measure)
    const steps = concepts.map((c, i) => gap(c.angle, concepts[(i + 1) % concepts.length]!.angle))
    expect(steps.map((s) => Math.round(s * 10) / 10)).toEqual([
      43.9, 61.5, 43.9, 43.9, 61.5, 43.9, 61.5,
    ])
  })

  it('keeps every concept in its topic sector, with the topic in the middle', () => {
    const rings = layoutRings(lean, measure)
    for (const t of rings.topics) {
      const own = rings.concepts.filter((c) => c.topic === t.name)
      const first = own[0]!
      const last = own[own.length - 1]!
      expect(gap(first.angle, t.angle)).toBeCloseTo(gap(t.angle, last.angle), 6)
    }
  })

  it('sizes dots by cards', () => {
    expect(dotRadius(3)).toBe(3.9)
    expect(dotRadius(6)).toBe(5.1)
    expect(dotRadius(7)).toBe(5.5)
    expect(dotRadius(0)).toBe(3.5)
    expect(dotRadius(100)).toBe(8)
  })

  it('puts labels outside, left-aligned on the right half and right-aligned on the left', () => {
    const rings = layoutRings(lean, measure)
    for (const c of rings.concepts) {
      const box = labelBox(c, baseline(c.angle))
      if (c.x > 0) expect(box.left).toBeGreaterThan(0)
      if (c.x < 0) expect(box.right).toBeLessThan(0)
    }
  })

  it('places the label above the dot at the top and below it at the bottom', () => {
    expect(baseline(-Math.PI / 2)).toBeCloseTo(-17.3, 1)
    expect(baseline(Math.PI / 2)).toBeCloseTo(11.3, 1)
  })

  it('gives a lecture without concepts in a topic a slot for its pill', () => {
    const rings = layoutRings(
      lecture([
        ['Alone', []],
        [
          'Pair',
          [
            ['A', 2],
            ['B', 2],
          ],
        ],
      ]),
      measure,
    )
    expect(rings.topics).toHaveLength(2)
    expect(rings.concepts).toHaveLength(2)
  })
})

describe('labels never overlap', () => {
  for (const [name, input] of [
    ['three topics', effectuation],
    ['four topics, twelve concepts', lean],
  ] as const) {
    for (const k of [1, 0.8, 0.6]) {
      it(`${name} at zoom ${k}`, () => {
        const rings = layoutRings(input, measure)
        const bases = placeLabels(rings, k, rings.concepts[0]!.id)
        const boxes = rings.concepts.map((c) => {
          const b = labelBox(c, bases.get(c.id)!, c.id === rings.concepts[0]!.id)
          return {
            left: b.left + k * c.x,
            right: b.right + k * c.x,
            top: b.top + k * c.y,
            bottom: b.bottom + k * c.y,
          }
        })
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++)
            expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false)
        }
      })
    }
  }

  it('keeps pills clear of each other and of the centre at full size', () => {
    for (const input of [effectuation, lean]) {
      const rings = layoutRings(input, measure)
      const disc = { left: -DISC, right: DISC, top: -DISC, bottom: DISC }
      const pills = rings.topics.map((t) => pillBox(t))
      for (const p of pills) expect(overlaps(p, disc)).toBe(false)
      for (let i = 0; i < pills.length; i++) {
        for (let j = i + 1; j < pills.length; j++)
          expect(overlaps(pills[i]!, pills[j]!)).toBe(false)
      }
    }
  })
})

describe('fitRings', () => {
  it('keeps full size when there is room', () => {
    const rings = layoutRings(effectuation, measure)
    expect(fitRings(rings, 490, 300, 1)).toBe(1)
  })

  it('zooms out until every label is inside the area', () => {
    const short = { ...lean, topics: lean.topics.map((t, i) => ({ ...t, name: `T${i}` })) }
    const rings = layoutRings(short, measure)
    const k = fitRings(rings, 340, 300, 1)
    expect(k).toBeLessThan(1)
    for (const c of rings.concepts) {
      const b = labelBox(c, baseline(c.angle))
      expect(k * c.x + b.right).toBeLessThanOrEqual(340.001)
      expect(k * c.x + b.left).toBeGreaterThanOrEqual(-340.001)
    }
  })
})

describe('pillFloor', () => {
  it('stops zooming out before pills cover the centre or each other', () => {
    const rings = layoutRings(lean, measure)
    const floor = pillFloor(rings)
    expect(fitRings(rings, 100, 100, 1)).toBeGreaterThanOrEqual(Math.min(1, floor))
    const pills = rings.topics.map((t) => pillBox(t, floor))
    for (let i = 0; i < pills.length; i++) {
      for (let j = i + 1; j < pills.length; j++) expect(overlaps(pills[i]!, pills[j]!)).toBe(false)
    }
  })
})
