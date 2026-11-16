import { describe, expect, it } from 'vitest'
import type { Box, Frame, Placed, Rings, RingsInput } from './rings.ts'
import {
  LABEL_MAX,
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
      concepts.flatMap(([, n], i) =>
        Array.from({ length: n }, () => ({ concept: { id: ids[t]![i]! } })),
      ),
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

/** Lecture 02 of the real course: seven topics, 16 concepts. */
const dense = lecture('Who are these entrepreneurs?', [
  [
    'Session context',
    [
      ['Previous session topics', 1],
      ['Alex Krapp case', 1],
    ],
  ],
  [
    'Entrepreneurial intentions',
    [
      ['Entrepreneurial intentions', 2],
      ['Entrepreneurial self-efficacy', 2],
      ['Perceived desirability', 1],
    ],
  ],
  [
    'Richard Branson case',
    [
      ['Mini case: Richard Branson', 6],
      ['Some of Branson’s ventures', 1],
    ],
  ],
  [
    'Entrepreneurial traits and passion',
    [
      ['Entrepreneurs and personal traits', 1],
      ['Entrepreneurial passion', 2],
    ],
  ],
  [
    'Support networks',
    [
      ['Role models', 4],
      ['Moral support network', 3],
      ['Professional support network', 2],
    ],
  ],
  [
    'Education and work experience',
    [
      ['Education and entrepreneurial intentions', 3],
      ['Ex-IBMers’ firm', 1],
      ['Work experience and entrepreneurial intentions', 4],
    ],
  ],
  ['Wrap-up', [['Entrepreneurial intentions recap', 1]]],
])
/** Lecture 01: 51 concepts. */
const huge = lecture('Entrepreneurship in a Digital', [
  [
    'Course introduction and mechanics',
    [
      ['Course start', 1],
      ['The TUM Advantage', 1],
      ['TUM Entrepreneurship Research Institute', 1],
      ['Course outline', 3],
      ['Course expectations', 3],
      ['Textbook', 3],
      ['Written exam', 4],
      ['Mid-term assignments', 4],
      ['Class interaction', 3],
      ['Getting in touch', 3],
      ['Inputs from practice', 3],
      ['Teaching cases', 3],
      ['Questions', 1],
      ['Starting or joining a firm', 1],
      ['Entrepreneurship and its importance', 1],
    ],
  ],
  [
    'Entrepreneurship: definitions and forms',
    [
      ['Who is an entrepreneur?', 2],
      ['Definition of entrepreneurship', 3],
      ['Special forms of entrepreneurship', 3],
      ['Degrees of unicorn founders', 2],
      ['Founder age', 1],
      ['Interpreting averages', 1],
    ],
  ],
  [
    'Entrepreneurship outcomes',
    [
      ['Outcomes', 1],
      ['Most entrepreneurs fail', 3],
      ['Failure is preventable', 3],
      ['Start-up employee earnings', 6],
    ],
  ],
  [
    'The entrepreneur',
    [
      ['The entrepreneur', 1],
      ['Entrepreneurs and personal traits', 4],
      ['Independent entrepreneurs and training', 3],
      ['Entrepreneurs as lone wolves', 3],
      ['Ex-IBMers’ firm', 1],
      ['Entrepreneurs and happiness', 1],
      ['Entrepreneurs and money', 1],
      ['Types of entrepreneurial ventures', 4],
    ],
  ],
  [
    'Entrepreneurship surroundings',
    [
      ['Surroundings', 1],
      ['Start-up funding', 1],
      ['Business degrees', 2],
      ['Investor bias', 2],
      ['Germany and entrepreneurship', 2],
      ['Entrepreneurial location', 3],
    ],
  ],
  ['Wrap-up', [['Entrepreneurship as a process', 4]]],
  [
    'Backup: entrepreneurial psychology',
    [
      ['Entrepreneurial psychology', 1],
      ['Big Five meta-analysis', 1],
      ['Personality traits', 3],
      ['The Big Five', 1],
      ['Openness to experience', 1],
      ['Conscientiousness', 1],
      ['Extraversion', 1],
      ['Agreeableness', 1],
      ['Neuroticism', 1],
      ['Big Five tendencies', 2],
      ['Motives', 4],
    ],
  ],
])

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
    for (const [i, t] of rings.topics.entries()) {
      const own = rings.concepts.filter((c) => c.topic === i)
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

  it('cuts a single very long word with an ellipsis, inside the disc', () => {
    const { lines, disc } = wrapTitle('Wahrscheinlichkeitsrechnungsgrundlagen', measure)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.endsWith('…')).toBe(true)
    expect((measure(lines[0]!, 600) * 14) / 13).toBeLessThanOrEqual(2 * disc)
  })

  it('cuts a long first word and keeps the words after it', () => {
    const { lines } = wrapTitle('Wahrscheinlichkeitsrechnungsgrundlagen und mehr', measure)
    expect(lines).toHaveLength(2)
    expect(lines[0]!.endsWith('…')).toBe(true)
    expect(lines[1]).toBe('und mehr')
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
    const count = (t: number) => rings.concepts.filter((c) => c.topic === t).length
    const topic = rings.topics.reduce((a, _, i) => (count(i) > count(a) ? i : a), 0)
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

describe('the smallest window with the panel open', () => {
  for (const per of [1, 4, 6, 0]) {
    for (let count = 2; count <= 8; count++) {
      it(`${count} topics of ${per || 'mixed'} concepts: no dot centre lies under a pill`, () => {
        const topics = Array.from({ length: count }, (_, t): [string, [string, number][]] => [
          `Topic number ${t + 1} of the lecture`,
          Array.from({ length: per || (t % 6) + 1 }, (_, c): [string, number] => [
            `Concept ${t + 1}.${c + 1} with a name`,
            1 + ((t + c) % 5),
          ]),
        ])
        const rings = layoutRings(lecture('Small window', topics), measure)
        const f = frame(rings, true, 900, 600)
        const { pills, dots } = drawn(rings, f, placeRings(rings, f))
        for (const d of dots) {
          const x = (d.left + d.right) / 2
          const y = (d.top + d.bottom) / 2
          pills.forEach((p) =>
            expect(x >= p.left && x <= p.right && y >= p.top && y <= p.bottom).toBe(false),
          )
        }
      })
    }
  }
})

describe('layoutRings edge cases', () => {
  it('lays out a lecture without topics as empty rings', () => {
    const rings = layoutRings({ title: 'Empty', topics: [], cards: [] }, measure)
    expect(rings.topics).toEqual([])
    expect(rings.concepts).toEqual([])
    expect(Number.isFinite(rings.disc)).toBe(true)
    const f = frame(rings, true)
    expect(Number.isFinite(f.k)).toBe(true)
    expect(placeRings(rings, f).concepts).toEqual([])
  })

  it('keeps a very long concept name within the label limit', () => {
    const name = 'A very long concept name that runs on and on without any end'
    expect(name.length).toBe(60)
    const rings = layoutRings(lecture('Long', [['Topic', [[name, 3]]]]), measure)
    expect(rings.concepts[0]!.width).toBeGreaterThan(LABEL_MAX)
    const label = placeRings(rings, frame(rings, true)).concepts[0]!.label
    expect(label!.width).toBeLessThanOrEqual(LABEL_MAX)
  })

  it('keeps two topics of the same name apart', () => {
    const rings = layoutRings(
      lecture('Twins', [
        ['Overview', [['One', 2]]],
        [
          'Overview',
          [
            ['Two', 2],
            ['Three', 1],
          ],
        ],
      ]),
      measure,
    )
    expect(rings.topics).toHaveLength(2)
    expect(rings.concepts.map((c) => c.topic)).toEqual([0, 1, 1])
    const placed = placeRings(rings, frame(rings, true), { topic: 1 })
    expect(placed.topics).toHaveLength(2)
    expect(placed.concepts.slice(1).every((c) => c.label)).toBe(true)
  })
})
