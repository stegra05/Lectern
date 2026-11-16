/**
 * A lecture as rings: the lecture in the centre, its topics as pills on the inner ring and its
 * concepts as dots on the outer ring, each inside its topic's sector. Numbers from the canvas
 * `V2Lecture.dc.html`.
 *
 * Two steps. `layoutRings` fixes the shape once per lecture in map units around (0, 0): the
 * angle of every topic and concept. `placeRings` puts it on screen at one zoom: zooming moves
 * positions only, so pills and labels keep their size and are placed again at every zoom. Pills
 * slide along the inner ring, and the ring grows, until none overlap. Labels go where they have
 * room; a concept without room shows as its dot, and its name appears under the pointer.
 */

export const INNER = 135
export const OUTER = 225
/** The gap between two sectors, as a share of one concept's slot. */
const GAP = 0.4
export const PILL_H = 28
/** Pills and labels end in an ellipsis past these widths, padding included for pills. */
export const PILL_MAX = 200
export const LABEL_MAX = 210
/** A label narrower than this is not worth showing: the dot stands alone. */
export const LABEL_MIN = 72
/** Space between a concept's dot and its label. */
const LABEL_GAP = 7
/** A concept label is two lines: the name (13px) and the card count (11px). */
const LABEL_ABOVE = 12
const LABEL_BELOW = 19
/** The centre title wraps at this width, in at most two lines. */
const TITLE_MAX = 136

/** Width in pixels of a 13px text in the given weight. */
export type Measure = (text: string, weight: 400 | 600) => number

export interface Point {
  x: number
  y: number
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface RingsInput {
  title: string
  topics: { name: string; concepts: { id: string; name: string }[] }[]
  cards: { concept: string }[]
}

export interface RingTopic {
  name: string
  /** Radians, screen orientation: 0 points right, positive turns clockwise. */
  angle: number
  /** Half the angle of its sector, gap included: how far its pill may slide. */
  spread: number
  /** Width of its pill in pixels, capped at PILL_MAX. */
  width: number
}

export interface RingConcept {
  id: string
  name: string
  /** Index of its topic in the lecture; names may repeat. */
  topic: number
  angle: number
  /** Dot radius in pixels, following the number of cards. */
  r: number
  cards: number
  /** 1: the label sits right of the dot, left-aligned. -1: left of it, right-aligned. */
  side: 1 | -1
  /** Width of the name in pixels, regular and as the bolder selected name. */
  width: number
  widthSelected: number
}

export interface Rings {
  topics: RingTopic[]
  concepts: RingConcept[]
  /** The centre title in one or two lines, and the radius of the disc that holds it. */
  title: string[]
  disc: number
}

export function dotRadius(cards: number): number {
  return Math.round(Math.min(8, Math.max(3.5, 2.7 + 0.4 * cards)) * 10) / 10
}

/** How far the label's name baseline sits below the dot: above it at the top, below at the bottom. */
export function baseline(angle: number): number {
  return -3 + 14.3 * Math.sin(angle)
}

const norm = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

export const overlaps = (a: Box, b: Box) => overlap(a, b) > 0

const inside = (a: Box, b: Box) =>
  a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom

/** Distance from (0, 0) to the nearest point of a box. */
const reach = (b: Box) => Math.hypot(Math.max(b.left, 0, -b.right), Math.max(b.top, 0, -b.bottom))

const pillAt = (x: number, y: number, width: number): Box => ({
  left: x - width / 2,
  right: x + width / 2,
  top: y - PILL_H / 2,
  bottom: y + PILL_H / 2,
})

/** The centre title wrapped into at most two lines of 14px; a line that is too wide ends in an ellipsis. */
export function wrapTitle(title: string, measure: Measure): { lines: string[]; disc: number } {
  const wide = (text: string) => (measure(text, 600) * 14) / 13
  const words = title.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && wide(next) > TITLE_MAX) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  if (lines.length > 2) lines.splice(1, lines.length - 1, lines.slice(1).join(' '))
  lines.forEach((text, i) => {
    if (wide(text) <= TITLE_MAX) return
    let cut = text
    while (cut.length > 1 && wide(`${cut}…`) > TITLE_MAX) cut = cut.slice(0, -1)
    lines[i] = `${cut.trimEnd()}…`
  })
  const widest = Math.max(0, ...lines.map(wide))
  return { lines, disc: lines.length > 1 ? 72 : Math.max(58, Math.min(80, widest / 2 + 10)) }
}

export function layoutRings(lecture: RingsInput, measure: Measure): Rings {
  const counts = new Map<string, number>()
  for (const card of lecture.cards) counts.set(card.concept, (counts.get(card.concept) ?? 0) + 1)
  const { lines, disc } = wrapTitle(lecture.title, measure)
  const pills = lecture.topics.map((t) => Math.min(PILL_MAX, measure(t.name, 600) + 26))
  const widths = lecture.topics.map((t) =>
    t.concepts.map((c) => ({ regular: measure(c.name, 400), selected: measure(c.name, 600) })),
  )

  let best: Rings | null = null
  let bestCost = Infinity
  // Try the whole wheel and keep the turn where labels and pills crowd least at full size,
  // leaning towards the first topic up and to the right, where reading starts. The turn never
  // depends on the window, so the map does not reshuffle.
  for (let deg = -180; deg < 180; deg += 3) {
    const rings = shape(lecture, counts, pills, widths, (deg * Math.PI) / 180, lines, disc)
    const first = rings.topics[0]
    const lean = first ? Math.abs(norm(first.angle + (70 * Math.PI) / 180)) : 0
    // Pills cut short beside the disc cost as much as labels that crowd.
    const pillWidths = placePills(rings, 1).widths
    const cut = rings.topics.reduce((sum, t, i) => sum + t.width - pillWidths[i]!, 0)
    const cost = crowding(rings) + cut * 40 + lean * 60
    if (cost < bestCost) {
      bestCost = cost
      best = rings
    }
  }
  return best ?? { topics: [], concepts: [], title: lines, disc }
}

function shape(
  lecture: RingsInput,
  counts: Map<string, number>,
  pills: number[],
  widths: { regular: number; selected: number }[][],
  rotation: number,
  title: string[],
  disc: number,
): Rings {
  const slots = lecture.topics.map((t) => Math.max(1, t.concepts.length))
  const total = slots.reduce((a, b) => a + b, 0)
  const unit = (2 * Math.PI) / (total + GAP * lecture.topics.length)
  const gap = GAP * unit

  const topics: RingTopic[] = []
  const concepts: RingConcept[] = []
  let start = rotation + gap / 2
  lecture.topics.forEach((topic, t) => {
    const spread = (slots[t]! * unit + gap) / 2
    topics.push({
      name: topic.name,
      angle: start + (slots[t]! * unit) / 2,
      spread,
      width: pills[t]!,
    })
    topic.concepts.forEach((c, i) => {
      const a = start + (i + 0.5) * unit
      const cards = counts.get(c.id) ?? 0
      concepts.push({
        id: c.id,
        name: c.name,
        topic: t,
        angle: a,
        r: dotRadius(cards),
        cards,
        side: Math.cos(a) >= 0 ? 1 : -1,
        width: widths[t]![i]!.regular,
        widthSelected: widths[t]![i]!.selected,
      })
    })
    start += slots[t]! * unit + gap
  })
  return { topics, concepts, title, disc }
}

/** The label of a concept relative to its dot, for a given name baseline and text width. */
export function labelBox(c: RingConcept, base: number, width: number): Box {
  const near = c.r + LABEL_GAP
  return {
    left: c.side === 1 ? near : -near - width,
    right: c.side === 1 ? near + width : -near,
    top: base - LABEL_ABOVE,
    bottom: base + LABEL_BELOW,
  }
}

const shift = (b: Box, p: Point): Box => ({
  left: b.left + p.x,
  right: b.right + p.x,
  top: b.top + p.y,
  bottom: b.bottom + p.y,
})

const grow = (b: Box, by: number): Box => ({
  left: b.left - by,
  right: b.right + by,
  top: b.top - by,
  bottom: b.bottom + by,
})

/** Overlap area of everything that carries text, at full size, for choosing the turn. */
function crowding(rings: Rings): number {
  const boxes = [
    ...rings.concepts.map((c) =>
      shift(labelBox(c, baseline(c.angle), Math.min(c.width, LABEL_MAX)), {
        x: OUTER * Math.cos(c.angle),
        y: OUTER * Math.sin(c.angle),
      }),
    ),
    ...rings.topics.map((t) =>
      pillAt(INNER * Math.cos(t.angle), INNER * Math.sin(t.angle), t.width),
    ),
    { left: -rings.disc, right: rings.disc, top: -rings.disc, bottom: rings.disc },
  ]
  let sum = 0
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) sum += overlap(boxes[i]!, boxes[j]!)
  }
  return sum
}

/** Where the rings go on screen. All boxes are in screen pixels. */
export interface Frame {
  centre: Point
  k: number
  /** Where labels, pills and dots may go: the free area, clear of the tools and the panel. */
  bounds: Box
  /** Where the faded previous and next stops would sit, if nothing is in their way. */
  neighbours: Box[]
}

export interface PlacedTopic {
  name: string
  x: number
  y: number
  width: number
}

export interface PlacedConcept {
  id: string
  x: number
  y: number
  /** The label, when it has room: its name baseline below the dot and its text width. */
  label?: { base: number; width: number }
}

export interface Placed {
  /** Radii of the two guide circles. */
  inner: number
  outer: number
  topics: PlacedTopic[]
  concepts: PlacedConcept[]
  /** For each neighbour of the frame, whether it shows. */
  neighbours: boolean[]
}

/** The box a shown label takes, selection plate included, around its dot. */
export function plateBox(c: RingConcept, base: number, width: number, selected: boolean): Box {
  const label = labelBox(c, base, width)
  if (!selected) return grow(label, 2)
  return {
    left: c.side === 1 ? -c.r - 6 : label.left - 12,
    right: c.side === 1 ? label.right + 12 : c.r + 6,
    top: Math.min(base - 17, -c.r - 6),
    bottom: Math.max(base + 27.3, c.r + 6),
  }
}

export function placeRings(
  rings: Rings,
  frame: Frame,
  selection: { concept?: string; topic?: number } = {},
): Placed {
  const { centre, k, bounds } = frame
  const outer = OUTER * k
  const toScreen = (angle: number, radius: number): Point => ({
    x: centre.x + radius * Math.cos(angle),
    y: centre.y + radius * Math.sin(angle),
  })

  const { inner, angles, widths } = placePills(rings, k)
  const topics = rings.topics.map((t, i) => ({
    name: t.name,
    width: widths[i]!,
    ...toScreen(angles[i]!, inner),
  }))
  const dots = rings.concepts.map((c) => toScreen(c.angle, outer))

  // What a label must keep clear of: pills, the centre disc and the dots of other concepts.
  const blocked: Box[] = [
    ...topics.map((t) => grow(pillAt(t.x, t.y, t.width), 2)),
    grow(pillAt(centre.x, centre.y, 2 * rings.disc), rings.disc - PILL_H / 2),
  ]
  const dotBoxes = dots.map((p, i) => {
    const r = rings.concepts[i]!.r + 2
    return { left: p.x - r, right: p.x + r, top: p.y - r, bottom: p.y + r }
  })

  const labels = new Map<string, { base: number; width: number }>()
  const taken: Box[] = []
  const forced = (c: RingConcept) => c.id === selection.concept || c.topic === selection.topic
  /** Places the label of concept `i` where it is free; `strict` false only keeps it in bounds. */
  const tryLabel = (i: number, also: Box[], strict = true) => {
    const c = rings.concepts[i]!
    const p = dots[i]!
    const selected = c.id === selection.concept
    const text = Math.min(selected ? c.widthSelected : c.width, LABEL_MAX)
    const near = c.r + LABEL_GAP + (selected ? 12 : 2)
    const room = c.side === 1 ? bounds.right - (p.x + near) : p.x - near - bounds.left
    const width = Math.max(Math.min(text, room), strict ? 0 : Math.min(text, LABEL_MIN))
    if (width < Math.min(text, LABEL_MIN)) return false
    const b0 = baseline(c.angle)
    const nudges = strict ? NUDGES : [...NUDGES, -42, 42, -49, 49, -56, 56, 0]
    for (const [n, nudge] of nudges.entries()) {
      const last = !strict && n === nudges.length - 1
      const base = b0 + nudge
      const box = shift(plateBox(c, base, width, selected), p)
      if (strict && !inside(box, bounds)) continue
      const clash =
        blocked.some((b) => overlaps(box, b)) ||
        dotBoxes.some((b, j) => j !== i && overlaps(box, b)) ||
        taken.some((b) => overlaps(box, b)) ||
        also.some((b) => overlaps(box, b))
      if (clash && !last) continue
      labels.set(c.id, { base, width })
      taken.push(box)
      return true
    }
    return false
  }

  // The selected concept and the concepts of the selected topic first, then the rest by size.
  const order = rings.concepts.map((_, i) => i)
  const first = order.filter((i) => forced(rings.concepts[i]!))
  const rest = order
    .filter((i) => !forced(rings.concepts[i]!))
    .sort((a, b) => rings.concepts[b]!.cards - rings.concepts[a]!.cards || a - b)
  for (const i of first) tryLabel(i, [])
  // The selected concept always carries its name, even where it is crowded.
  const chosen = rings.concepts.findIndex((c) => c.id === selection.concept)
  if (chosen >= 0 && !labels.has(selection.concept!)) tryLabel(chosen, [], false)

  // A neighbour shows only where it covers nothing that is already drawn.
  const neighbours = frame.neighbours.map(
    (n) => ![...blocked, ...dotBoxes, ...taken].some((b) => overlaps(n, b)),
  )
  const kept = frame.neighbours.filter((_, i) => neighbours[i])
  for (const i of rest) tryLabel(i, kept)

  return {
    inner,
    outer,
    topics,
    concepts: rings.concepts.map((c, i) => ({ id: c.id, ...dots[i]!, label: labels.get(c.id) })),
    neighbours,
  }
}

/** How far a label may move up or down from its place beside the dot to find room. */
const NUDGES = [0, -7, 7, -14, 14, -21, 21, -28, 28, -35, 35]

/** A pill is never cut shorter than this, padding included. */
const PILL_MIN = 76

/**
 * How wide a pill may be at this point of the inner ring: it stays inside the outer ring, clear
 * of the concepts' dots, and outside the centre disc.
 */
function pillRoom(angle: number, radius: number, outer: number, disc: number): number {
  const px = Math.abs(radius * Math.cos(angle))
  const py = Math.abs(radius * Math.sin(angle))
  const rim = outer - 12
  const out = 2 * (Math.sqrt(Math.max(0, rim * rim - (py + PILL_H / 2) ** 2)) - px)
  const clear = disc + 8
  const low = Math.max(0, py - PILL_H / 2)
  const into = low < clear ? 2 * (px - Math.sqrt(clear * clear - low * low)) : Infinity
  return Math.min(out, into)
}

/**
 * The inner ring's radius, each pill's angle and width at zoom `k`. Pills start in the middle of
 * their sector, are cut to the room they have there, and slide along the ring, never out of
 * their sector, until none overlap; if that is not enough the ring grows, up to just inside the
 * outer ring.
 */
export function placePills(
  rings: Rings,
  k: number,
): { inner: number; angles: number[]; widths: number[] } {
  const outer = OUTER * k
  const limit = Math.max(INNER * k, outer - 30)
  const base = rings.topics.map((t) => t.angle)
  const fitWidths = (angles: number[], radius: number) =>
    rings.topics.map((t, i) =>
      Math.max(PILL_MIN, Math.min(t.width, pillRoom(angles[i]!, radius, outer, rings.disc))),
    )

  // Try every radius from just outside the disc to just inside the outer ring, and keep the
  // one where the pills, without overlapping, are cut least; on a tie the one nearest the
  // canvas ring. Pills beside the disc have most room halfway between disc and dots.
  const start = Math.min(limit, rings.disc + 8 + PILL_H / 2)
  let best: { inner: number; angles: number[]; widths: number[]; score: number } | null = null
  for (let radius = start; radius <= limit + 0.01; radius += 4) {
    let widths = fitWidths(base, radius)
    const angles = relax(rings, base, radius, widths)
    widths = fitWidths(angles, radius)
    const boxes = widths.map((w, i) =>
      pillAt(radius * Math.cos(angles[i]!), radius * Math.sin(angles[i]!), w),
    )
    const clean = boxes.every(
      (b, i) =>
        reach(b) >= rings.disc + 8 &&
        widths[i]! <= pillRoom(angles[i]!, radius, outer, rings.disc) + 0.5 &&
        boxes.every((o, j) => j <= i || !overlaps(b, o)),
    )
    const shown = widths.reduce((sum, w) => sum + w, 0)
    const score = (clean ? 0 : -1e6) + shown - Math.abs(radius - INNER * k) * 0.05
    if (!best || score > best.score) best = { inner: radius, angles, widths, score }
  }
  const { inner, angles, widths } = best!
  return { inner, angles, widths }
}

/** Pushes overlapping neighbours on the ring apart, each pill staying inside its own sector. */
function relax(rings: Rings, base: number[], radius: number, widths: number[]): number[] {
  const angles = [...base]
  const count = angles.length
  if (count < 2) return angles
  const box = (i: number) =>
    pillAt(radius * Math.cos(angles[i]!), radius * Math.sin(angles[i]!), widths[i]!)
  for (let round = 0; round < 150; round++) {
    let moved = false
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count
      if (!overlaps(box(i), box(j))) continue
      moved = true
      const step = 0.01
      angles[i] = Math.max(base[i]! - rings.topics[i]!.spread, angles[i]! - step)
      angles[j] = Math.min(base[j]! + rings.topics[j]!.spread, angles[j]! + step)
    }
    if (!moved) break
  }
  return angles
}

/**
 * The fitted zoom: as large as the area allows for the dots and a label above and below the
 * ring, and with room beside the ring for labels of a useful width.
 */
export function fitRings(rings: Rings, centre: Point, bounds: Box, maxK: number): number {
  const longest = Math.min(LABEL_MAX, Math.max(LABEL_MIN, ...rings.concepts.map((c) => c.width)))
  const beside = Math.min(longest, 130) + LABEL_GAP + 10
  const halfW = Math.min(centre.x - bounds.left, bounds.right - centre.x)
  const halfH = Math.min(centre.y - bounds.top, bounds.bottom - centre.y)
  const k = Math.min(maxK, (halfW - beside) / OUTER, (halfH - 34) / OUTER)
  return Math.max(0.45, k)
}
