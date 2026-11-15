/**
 * The course as a winding track: stops in course order along rows that alternate direction,
 * joined by round turns, ending at the flag stop "In Anki". Pure geometry in map units, where
 * an 11-lecture course at 1100 by 720 is exactly the canvas (KIT.md, "The map").
 */

export interface Point {
  x: number
  y: number
}

export interface TrackStop extends Point {
  row: number
  /** 1 when the stop's row runs left to right, -1 when it runs right to left. */
  dir: 1 | -1
}

export interface Track {
  /** One stop per lecture, in course order. */
  stops: TrackStop[]
  /** The flag stop after the last lecture. */
  flag: TrackStop
  perRow: number
  /** Horizontal distance between neighbouring stops of a row. */
  step: number
  /** The band as an SVG path in map units, with half-circle turns between rows. */
  band: string
}

const LEFT = 160
const TOP = 190
const WIDTH = 780
const ROW_GAP = 160

const n = (v: number) => String(Math.round(v * 100) / 100)

export function layoutTrack(lectures: number): Track {
  const perRow = lectures >= 17 ? 5 : 4
  const step = WIDTH / (perRow - 1)
  const all: TrackStop[] = Array.from({ length: lectures + 1 }, (_, i) => {
    const row = Math.floor(i / perRow)
    const col = i % perRow
    const dir = row % 2 === 0 ? 1 : -1
    return {
      x: dir === 1 ? LEFT + col * step : LEFT + WIDTH - col * step,
      y: TOP + row * ROW_GAP,
      row,
      dir,
    }
  })
  const flag = all[all.length - 1]!

  const stops = all.slice(0, -1)
  return { stops, flag, perRow, step, band: bandPath({ stops, flag }, (p) => p, 1) }
}

/**
 * The band through the stops as an SVG path, drawn through `map` at zoom `k`: straight along
 * each row, a half circle between rows, ending at the flag. The same commands at every zoom, so
 * the path can glide from one zoom to the next.
 */
export function bandPath(
  track: Pick<Track, 'stops' | 'flag'>,
  map: (p: Point) => Point,
  k: number,
): string {
  const first = map(track.stops[0] ?? track.flag)
  const parts = [`M${n(first.x)},${n(first.y)}`]
  const { flag } = track
  for (let row = 0; row <= flag.row; row++) {
    const dir = row % 2 === 0 ? 1 : -1
    const y = TOP + row * ROW_GAP
    const end = map({ x: row === flag.row ? flag.x : dir === 1 ? LEFT + WIDTH : LEFT, y })
    parts.push(`H${n(end.x)}`)
    if (row < flag.row) {
      const r = (ROW_GAP / 2) * k
      const next = map({ x: dir === 1 ? LEFT + WIDTH : LEFT, y: y + ROW_GAP })
      parts.push(`A${n(r)} ${n(r)} 0 0 ${dir === 1 ? 1 : 0} ${n(next.x)},${n(next.y)}`)
    }
  }
  return parts.join(' ')
}

/**
 * How wide a stop's title may be at zoom `k`: one line, ending in an ellipsis, so it never runs
 * into the next stop of its row.
 */
export function labelWidth(k: number, step: number): number {
  return Math.floor(Math.min(200, k * step - 12))
}

/** Where the map sits on screen: a map point p is drawn at `centre + k * (p - origin)`. */
export interface Fit {
  k: number
  centre: Point
  origin: Point
}

/** The free part of the window the map may use, in screen pixels. */
export interface Area {
  left: number
  top: number
  right: number
  bottom: number
}

/** Room a stop needs around its centre that does not scale: fan above, two lines below. */
const ROOM = { side: 100, above: 50, below: 60 }

/** Fits the track's stops into the area. `maxK` caps the spread: 1 at the reference window. */
export function fitTrack(track: Track, area: Area, maxK: number): Fit {
  const points = [...track.stops, track.flag]
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const width = area.right - area.left - 2 * ROOM.side
  const height = area.bottom - area.top - ROOM.above - ROOM.below
  const kx = maxX > minX ? width / (maxX - minX) : Infinity
  const ky = maxY > minY ? height / (maxY - minY) : Infinity
  const k = Math.max(0.2, Math.min(maxK, kx, ky))
  return {
    k,
    centre: {
      x: (area.left + area.right) / 2,
      y: (area.top + area.bottom) / 2 + (ROOM.below - ROOM.above) / 2,
    },
    origin: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  }
}

export interface FanDot {
  /** Where the spoke starts and ends, and the dot's centre, relative to the stop's centre. */
  from: Point
  to: Point
  dot: Point
  r: number
}

/**
 * The short fan above a stop: one dot per topic, sized by the topic's cards. The spread is 30
 * degrees between dots, narrower once there are more than three, as on the canvas.
 */
export function fan(topicCards: number[]): FanDot[] {
  const count = topicCards.length
  if (count === 0) return []
  const spread = count === 1 ? 0 : count <= 3 ? 30 : Math.max(22, 78 / (count - 1))
  const reach = count <= 4 ? 37 : 40
  return topicCards.map((cards, i) => {
    const angle = ((i - (count - 1) / 2) * spread * Math.PI) / 180
    const r = Math.min(6.3, Math.max(3.6, 3.4 + 0.16 * cards))
    const at = (d: number) => ({ x: round(Math.sin(angle) * d), y: round(-Math.cos(angle) * d) })
    return { from: at(24), to: at(reach - r - 1), dot: at(reach), r: round(r) }
  })
}

const round = (v: number) => Math.round(v * 10) / 10
