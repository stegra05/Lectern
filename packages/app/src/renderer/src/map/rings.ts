/**
 * A lecture as rings: the lecture in the centre, its topics as pills on the inner ring and its
 * concepts as dots on the outer ring, each inside its topic's sector. Pure geometry in map
 * units around the centre (0, 0), with screen-sized labels that never overlap. Numbers from
 * the canvas `V2Lecture.dc.html`.
 */

export const INNER = 135
export const OUTER = 225
/** The gap between two sectors, as a share of one concept's slot. */
const GAP = 0.4
/** The disc in the centre. Pills keep clear of it. */
export const DISC = 58
export const PILL_H = 28
/** Space between a concept's dot and its label. */
const LABEL_GAP = 7
/** A concept label is two lines: the name (13px) and the card count (11px). */
const LABEL_ABOVE = 12
const LABEL_BELOW = 19

/** The room the rings get at the reference window with the side panel open. */
const BESIDE_PANEL = { halfW: 312, halfH: 299 }

/** Width in pixels of a 13px text in the given weight. */
export type Measure = (text: string, weight: 400 | 600) => number

export interface RingsInput {
  topics: { name: string; concepts: { id: string; name: string }[] }[]
  cards: { concept: string }[]
}

export interface RingTopic {
  name: string
  /** Radians, screen orientation: 0 points right, positive turns clockwise. */
  angle: number
  x: number
  y: number
  /** Width of its pill in pixels. */
  width: number
}

export interface RingConcept {
  id: string
  name: string
  topic: string
  angle: number
  x: number
  y: number
  /** Dot radius in pixels, following the number of cards. */
  r: number
  cards: number
  /** 1: the label sits right of the dot, left-aligned. -1: left of it, right-aligned. */
  side: 1 | -1
  /** Width of the label's name in pixels, regular and as the bolder selected name. */
  width: number
  widthSelected: number
}

export interface Rings {
  topics: RingTopic[]
  concepts: RingConcept[]
}

export function dotRadius(cards: number): number {
  return Math.round(Math.min(8, Math.max(3.5, 2.7 + 0.4 * cards)) * 10) / 10
}

/** How far the label's name baseline sits below the dot: above it at the top, below at the bottom. */
export function baseline(angle: number): number {
  return -3 + 14.3 * Math.sin(angle)
}

export function layoutRings(lecture: RingsInput, measure: Measure): Rings {
  const counts = new Map<string, number>()
  for (const card of lecture.cards) counts.set(card.concept, (counts.get(card.concept) ?? 0) + 1)

  const pills = lecture.topics.map((t) => measure(t.name, 600) + 26)
  const widths = lecture.topics.map((t) =>
    t.concepts.map((c) => ({ regular: measure(c.name, 400), selected: measure(c.name, 600) })),
  )

  let best: Rings | null = null
  let bestCost = Infinity
  // Try the whole wheel and keep the turn where labels and pills crowd least and the rings stay
  // largest beside an open side panel, leaning towards the first topic up and to the right.
  // The turn never depends on the window, so the map does not reshuffle.
  for (let deg = -180; deg < 180; deg += 2) {
    const rings = place(lecture, counts, pills, widths, (deg * Math.PI) / 180)
    const first = rings.topics[0]
    const lean = first ? Math.abs(norm(first.angle + (70 * Math.PI) / 180)) : 0
    const cost = crowding(rings) * 20 + (1.5 - roominess(rings)) * 1500 + lean * 60
    if (cost < bestCost) {
      bestCost = cost
      best = rings
    }
  }
  return best ?? { topics: [], concepts: [] }
}

function place(
  lecture: RingsInput,
  counts: Map<string, number>,
  pills: number[],
  widths: { regular: number; selected: number }[][],
  rotation: number,
): Rings {
  const slots = lecture.topics.map((t) => Math.max(1, t.concepts.length))
  const total = slots.reduce((a, b) => a + b, 0)
  const unit = (2 * Math.PI) / (total + GAP * lecture.topics.length)
  const gap = GAP * unit

  const topics: RingTopic[] = []
  const concepts: RingConcept[] = []
  let start = rotation + gap / 2
  lecture.topics.forEach((topic, t) => {
    const angle = start + (slots[t]! * unit) / 2
    topics.push({
      name: topic.name,
      angle,
      x: INNER * Math.cos(angle),
      y: INNER * Math.sin(angle),
      width: pills[t]!,
    })
    topic.concepts.forEach((c, i) => {
      const a = start + (i + 0.5) * unit
      const cards = counts.get(c.id) ?? 0
      concepts.push({
        id: c.id,
        name: c.name,
        topic: topic.name,
        angle: a,
        x: OUTER * Math.cos(a),
        y: OUTER * Math.sin(a),
        r: dotRadius(cards),
        cards,
        side: Math.cos(a) >= 0 ? 1 : -1,
        width: widths[t]![i]!.regular,
        widthSelected: widths[t]![i]!.selected,
      })
    })
    start += slots[t]! * unit + gap
  })
  return { topics, concepts }
}

const norm = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

/** The label of a concept relative to its dot, for a given name baseline. */
export function labelBox(c: RingConcept, base: number, selected = false): Box {
  const width = selected ? c.widthSelected : c.width
  const near = c.r + LABEL_GAP
  return {
    left: c.side === 1 ? near : -near - width,
    right: c.side === 1 ? near + width : -near,
    top: base - LABEL_ABOVE,
    bottom: base + LABEL_BELOW,
  }
}

const shift = (b: Box, x: number, y: number): Box => ({
  left: b.left + x,
  right: b.right + x,
  top: b.top + y,
  bottom: b.bottom + y,
})

export function pillBox(t: RingTopic, k = 1): Box {
  const x = k * t.x
  const y = k * t.y
  return {
    left: x - t.width / 2,
    right: x + t.width / 2,
    top: y - PILL_H / 2,
    bottom: y + PILL_H / 2,
  }
}

/** Overlap area of everything that carries text, at full size. */
function crowding(rings: Rings): number {
  const boxes = [
    ...rings.concepts.map((c) => shift(labelBox(c, baseline(c.angle)), c.x, c.y)),
    ...rings.topics.map((t) => pillBox(t)),
    { left: -DISC, right: DISC, top: -DISC, bottom: DISC },
  ]
  let sum = 0
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) sum += overlap(boxes[i]!, boxes[j]!)
  }
  return sum
}

/**
 * The name baseline of every concept label at zoom `k`, moved apart where two labels on the
 * same side would touch: upper labels move up, lower labels move down, away from the centre.
 */
export function placeLabels(rings: Rings, k: number, selected?: string): Map<string, number> {
  const result = new Map<string, number>()
  for (const side of [1, -1] as const) {
    for (const half of [-1, 1] as const) {
      const group = rings.concepts
        .filter((c) => c.side === side && (half === -1 ? c.y < 0 : c.y >= 0))
        .sort((a, b) => half * (a.y - b.y))
      const placed: Box[] = []
      for (const c of group) {
        let base = baseline(c.angle)
        const at = (b: number) => shift(labelBox(c, b, c.id === selected), k * c.x, k * c.y)
        for (let guard = 0; guard < group.length; guard++) {
          const box = at(base)
          const hit = placed.find((p) => overlap(box, p) > 0)
          if (!hit) break
          base += half === 1 ? hit.bottom + 2 - box.top : hit.top - 2 - box.bottom
        }
        placed.push(at(base))
        result.set(c.id, base)
      }
    }
  }
  return result
}

/**
 * The largest zoom, up to `maxK`, at which every label and pill fits in a box of half-width
 * `halfW` and half-height `halfH` around the centre.
 */
export function fitRings(rings: Rings, halfW: number, halfH: number, maxK: number): number {
  // Pills crowd the centre first. Rather than cover the lecture or each other, the rings stay
  // larger and the outermost labels may reach the edge, where panning brings them back.
  return Math.min(maxK, Math.max(0.3, labelFit(rings, halfW, halfH), pillFloor(rings)))
}

/** The largest zoom at which every label and pill is inside the box. */
function labelFit(rings: Rings, halfW: number, halfH: number): number {
  let k = Infinity
  const limit = (pos: number, near: number, far: number, half: number) => {
    // The box spans pos*k + near .. pos*k + far; both ends must stay within -half .. half.
    if (pos > 0) k = Math.min(k, (half - far) / pos)
    if (pos < 0) k = Math.min(k, (-half - near) / pos)
  }
  for (const c of rings.concepts) {
    const box = labelBox(c, baseline(c.angle))
    limit(c.x, Math.min(box.left, -c.r), Math.max(box.right, c.r), halfW)
    limit(c.y, Math.min(box.top, -c.r), Math.max(box.bottom, c.r), halfH)
  }
  for (const t of rings.topics) {
    limit(t.x, -t.width / 2, t.width / 2, halfW)
    limit(t.y, -PILL_H / 2, PILL_H / 2, halfH)
  }
  return k
}

/**
 * How well a turn of the wheel fits beside the side panel: the larger the rings may be the
 * better, and pills that would need more room than the labels allow count against it.
 */
function roominess(rings: Rings): number {
  const labels = Math.min(1.5, labelFit(rings, BESIDE_PANEL.halfW, BESIDE_PANEL.halfH))
  return labels - 2 * Math.max(0, pillFloor(rings) - labels)
}

/** The smallest zoom at which no pill touches the centre disc or another pill. */
export function pillFloor(rings: Rings): number {
  // Distance from the centre to the nearest point of a box.
  const reach = (b: Box) => Math.hypot(Math.max(b.left, 0, -b.right), Math.max(b.top, 0, -b.bottom))
  const clear = (k: number) => {
    const pills = rings.topics.map((t) => pillBox(t, k))
    return pills.every(
      (p, i) => reach(p) >= DISC + 8 && pills.every((q, j) => j <= i || overlap(p, q) === 0),
    )
  }
  if (clear(0.3)) return 0.3
  let low = 0.3
  let high = 1.5
  if (!clear(high)) return high
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2
    if (clear(mid)) high = mid
    else low = mid
  }
  return high
}
