import { describe, expect, it } from 'vitest'
import { REAL_TITLES, REAL_TOPICS } from '../dev/real.ts'
import type { Box, Frame, Placed, Rings, RingsInput } from './rings.ts'
import {
  LABEL_MIN,
  OUTER,
  PILL_H,
  baseline,
  dotRadius,
  fitRings,
  labelBox,
  layoutRings,
  overlaps,
  placePills,
  placeRings,
  plateBox,
  wrapTitle,
} from './rings.ts'

/** A little wider than the system font, so the tests err on the crowded side. */
const measure = (text: string, weight: 400 | 600) => text.length * (weight === 600 ? 7.4 : 6.9)

function lecture(title: string, topics: [string, [string, number][]][]): RingsInput {
  let id = 0
  const ids = topics.map(([, concepts]) => concepts.map(() => `c${id++}`))
  return {
    title,
    topics: topics.map(([name, concepts], t) => ({
      name,
      concepts: concepts.map(([c], i) => ({ id: ids[t]![i]!, name: c })),
    })),
    cards: topics.flatMap(([, concepts], t) =>
      concepts.flatMap(([, n], i) => Array.from({ length: n }, () => ({ concept: ids[t]![i]! }))),
    ),
  }
}

/** Lecture 02 as the canvas draws it. */
const effectuation = lecture('Effectuation', [
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
const lean = lecture('Lean startup', [
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

/** The real lectures: 02 with seven topics and 16 concepts, 01 with 51 concepts. */
const dense = lecture(REAL_TITLES[1]!, REAL_TOPICS[2]!)
const huge = lecture(REAL_TITLES[0]!, REAL_TOPICS[1]!)

const deg = (a: number) => ((((a * 180) / Math.PI) % 360) + 360) % 360
const gap = (a: number, b: number) => (deg(b) - deg(a) + 360) % 360

/** The frame of the app at a window size, with the side panel open or closed. */
function frame(rings: Rings, panel: boolean, w = 1100, h = 720): Frame {
  const right = w - (panel ? 356 : 0)
  const centre = { x: right / 2, y: (38 + h - 68) / 2 }
  const bounds = { left: 8, right: right - 8, top: 86, bottom: h - 68 - 6 }
  const k = fitRings(rings, centre, bounds, 1)
  const neighbours = [16, right - 56].map((x) => ({
    left: x,
    right: x + 40,
    top: centre.y - 20,
    bottom: centre.y + 20,
  }))
  return { centre, k, bounds, neighbours }
}

/** Every box the placed rings draw, to check that nothing overlaps and nothing leaves the area. */
function drawn(rings: Rings, f: Frame, placed: Placed, selected?: string) {
  const pills = placed.topics.map((t) => ({
    left: t.x - t.width / 2,
    right: t.x + t.width / 2,
    top: t.y - PILL_H / 2,
    bottom: t.y + PILL_H / 2,
  }))
  const dots = placed.concepts.map((p, i) => {
    const r = rings.concepts[i]!.r
    return { left: p.x - r, right: p.x + r, top: p.y - r, bottom: p.y + r }
  })
  const labels: { box: Box; owner: number }[] = []
  placed.concepts.forEach((p, i) => {
    if (!p.label) return
    const c = rings.concepts[i]!
    const b = plateBox(c, p.label.base, p.label.width, c.id === selected)
    labels.push({
      owner: i,
      box: { left: b.left + p.x, right: b.right + p.x, top: b.top + p.y, bottom: b.bottom + p.y },
    })
  })
  const d = rings.disc
  const disc = {
    left: f.centre.x - d,
    right: f.centre.x + d,
    top: f.centre.y - d,
    bottom: f.centre.y + d,
  }
  const neighbours = f.neighbours.filter((_, i) => placed.neighbours[i])
  return { pills, dots, labels, disc, neighbours }
}

function expectClean(rings: Rings, f: Frame, placed: Placed, selected?: string) {
  const { pills, dots, labels, disc, neighbours } = drawn(rings, f, placed, selected)
  const reach = (b: Box) =>
    Math.hypot(
      Math.max(b.left - f.centre.x, 0, f.centre.x - b.right),
      Math.max(b.top - f.centre.y, 0, f.centre.y - b.bottom),
    )
  pills.forEach((p, i) => {
    expect(reach(p), 'pill clear of the centre').toBeGreaterThanOrEqual(rings.disc)
    pills.forEach((q, j) => j > i && expect(overlaps(p, q), 'pills overlap').toBe(false))
    dots.forEach((q) => expect(overlaps(p, q), 'pill on a dot').toBe(false))
  })
  for (const { box, owner } of labels) {
    expect(box.left).toBeGreaterThanOrEqual(f.bounds.left)
    expect(box.right).toBeLessThanOrEqual(f.bounds.right)
    expect(box.top).toBeGreaterThanOrEqual(f.bounds.top)
    expect(box.bottom).toBeLessThanOrEqual(f.bounds.bottom)
    expect(overlaps(box, disc), 'label on the centre').toBe(false)
    pills.forEach((p) => expect(overlaps(box, p), 'label on a pill').toBe(false))
    dots.forEach((p, j) => j !== owner && expect(overlaps(box, p), 'label on a dot').toBe(false))
    labels.forEach(
      (o) => o.owner > owner && expect(overlaps(box, o.box), 'labels overlap').toBe(false),
    )
  }
  for (const n of neighbours) {
    for (const b of [...pills, ...dots, disc, ...labels.map((l) => l.box)]) {
      expect(overlaps(n, b), 'neighbour covers something').toBe(false)
    }
  }
  for (const d of dots) {
    expect(d.left).toBeGreaterThanOrEqual(f.bounds.left)
    expect(d.right).toBeLessThanOrEqual(f.bounds.right)
    expect(d.top).toBeGreaterThanOrEqual(f.bounds.top)
    expect(d.bottom).toBeLessThanOrEqual(f.bounds.bottom)
  }
}

describe('layoutRings', () => {
  it('spaces concepts as the canvas: 43.9 degrees apart, 17.6 more between sectors', () => {
    const { concepts } = layoutRings(effectuation, measure)
    const steps = concepts.map((c, i) => gap(c.angle, concepts[(i + 1) % concepts.length]!.angle))
    expect(steps.map((s) => Math.round(s * 10) / 10)).toEqual([
      43.9, 61.5, 43.9, 43.9, 61.5, 43.9, 61.5,
    ])
  })

  it('keeps every topic in the middle of its sector', () => {
    const rings = layoutRings(lean, measure)
    for (const t of rings.topics) {
      const own = rings.concepts.filter((c) => c.topic === t.name)
      expect(gap(own[0]!.angle, t.angle)).toBeCloseTo(gap(t.angle, own[own.length - 1]!.angle), 6)
    }
  })

  it('sizes dots by cards', () => {
    expect(dotRadius(3)).toBe(3.9)
    expect(dotRadius(7)).toBe(5.5)
    expect(dotRadius(0)).toBe(3.5)
    expect(dotRadius(100)).toBe(8)
  })

  it('puts labels outside, left-aligned on the right half and right-aligned on the left', () => {
    const rings = layoutRings(lean, measure)
    for (const c of rings.concepts) {
      const box = labelBox(c, baseline(c.angle), c.width)
      if (Math.cos(c.angle) > 0) expect(box.left).toBeGreaterThan(0)
      if (Math.cos(c.angle) < 0) expect(box.right).toBeLessThan(0)
    }
  })

  it('places the label above the dot at the top and below it at the bottom', () => {
    expect(baseline(-Math.PI / 2)).toBeCloseTo(-17.3, 1)
    expect(baseline(Math.PI / 2)).toBeCloseTo(11.3, 1)
  })
})

describe('wrapTitle', () => {
  it('keeps a short title on one line in the canvas disc', () => {
    expect(wrapTitle('Effectuation', measure)).toEqual({ lines: ['Effectuation'], disc: 58 })
  })

  it('wraps a long title into two lines and a larger disc', () => {
    const { lines, disc } = wrapTitle('Who are these entrepreneurs?', measure)
    expect(lines).toEqual(['Who are these', 'entrepreneurs?'])
    expect(disc).toBe(72)
  })

  it('ends a title that needs more than two lines in an ellipsis', () => {
    const { lines } = wrapTitle('A very long lecture title that goes on and on and on', measure)
    expect(lines).toHaveLength(2)
    expect(lines[1]!.endsWith('…')).toBe(true)
  })
})

describe('placeRings', () => {
  const cases = { effectuation, lean, dense, huge }
  for (const [name, input] of Object.entries(cases)) {
    for (const panel of [true, false]) {
      it(`${name}, panel ${panel ? 'open' : 'closed'}: nothing overlaps, nothing leaves the area`, () => {
        const rings = layoutRings(input, measure)
        const f = frame(rings, panel)
        expectClean(rings, f, placeRings(rings, f))
        const selected = rings.concepts[Math.floor(rings.concepts.length / 3)]!
        const withSelection = placeRings(rings, f, { concept: selected.id })
        expect(withSelection.concepts.find((c) => c.id === selected.id)!.label).toBeDefined()
        expectClean(rings, f, withSelection, selected.id)
      })
    }
  }

  it('keeps the canvas lecture at full size beside the panel, every concept named', () => {
    const rings = layoutRings(effectuation, measure)
    const f = frame(rings, true)
    expect(f.k).toBeGreaterThan(0.9)
    expect(placeRings(rings, f).concepts.every((c) => c.label)).toBe(true)
  })

  it('names every concept of the selected topic', () => {
    const rings = layoutRings(dense, measure)
    const topic = rings.topics.reduce((a, b) =>
      rings.concepts.filter((c) => c.topic === b.name).length >
      rings.concepts.filter((c) => c.topic === a.name).length
        ? b
        : a,
    ).name
    const placed = placeRings(rings, frame(rings, true), { topic })
    const own = placed.concepts.filter((_, i) => rings.concepts[i]!.topic === topic)
    expect(own.length).toBeGreaterThan(2)
    expect(own.every((c) => c.label)).toBe(true)
  })

  it('shows a dense lecture as dots, with more names when zoomed in', () => {
    const rings = layoutRings(huge, measure)
    const f = frame(rings, true)
    // Zooming in by 1.6 spreads the same rings over 1.6 times the room, as panning around shows.
    const named = (zoom: number) => {
      const { x, y } = f.centre
      const b = f.bounds
      const bounds = {
        left: x - (x - b.left) * zoom,
        right: x + (b.right - x) * zoom,
        top: y - (y - b.top) * zoom,
        bottom: y + (b.bottom - y) * zoom,
      }
      const placed = placeRings(rings, { ...f, k: f.k * zoom, bounds, neighbours: [] })
      return placed.concepts.filter((c) => c.label).length
    }
    expect(named(1)).toBeLessThan(rings.concepts.length)
    expect(named(1)).toBeGreaterThan(12)
    expect(named(1.6)).toBeGreaterThan(named(1))
  })

  it('never cuts a label below a useful width', () => {
    const rings = layoutRings(dense, measure)
    const f = frame(rings, true)
    placeRings(rings, f).concepts.forEach((c, i) => {
      if (c.label)
        expect(c.label.width).toBeGreaterThanOrEqual(Math.min(LABEL_MIN, rings.concepts[i]!.width))
    })
  })

  it('drops a neighbour that would cover a dot', () => {
    const rings = layoutRings(dense, measure)
    const f = frame(rings, true)
    const p = placeRings(rings, f).concepts[0]!
    const onDot = { left: p.x - 20, right: p.x + 20, top: p.y - 20, bottom: p.y + 20 }
    expect(placeRings(rings, { ...f, neighbours: [onDot] }).neighbours).toEqual([false])
  })
})

describe('placePills', () => {
  for (const [name, input] of Object.entries({ effectuation, lean, dense, huge })) {
    it(`${name}: pills never overlap and stay inside the outer ring at any zoom`, () => {
      const rings = layoutRings(input, measure)
      for (const k of [0.6, 0.8, 1, 1.4]) {
        const { inner, angles, widths } = placePills(rings, k)
        expect(inner).toBeLessThan(OUTER * k)
        const boxes = angles.map((a, i) => ({
          left: inner * Math.cos(a) - widths[i]! / 2,
          right: inner * Math.cos(a) + widths[i]! / 2,
          top: inner * Math.sin(a) - PILL_H / 2,
          bottom: inner * Math.sin(a) + PILL_H / 2,
        }))
        boxes.forEach((b, i) =>
          boxes.forEach((o, j) => j > i && expect(overlaps(b, o)).toBe(false)),
        )
      }
    })
  }

  it('keeps the canvas pills whole at full size', () => {
    const rings = layoutRings(effectuation, measure)
    const { widths } = placePills(rings, 1)
    widths.forEach((w, i) => expect(w).toBeGreaterThan(rings.topics[i]!.width * 0.95))
  })
})
