import type { Concept, ConceptMap, Importance } from '../engine/types'

/**
 * Deterministic force layout for the concept map. Node positions come from a
 * small Fruchterman–Reingold-style simulation seeded by hashing concept ids,
 * so the same map always lays out the same way — no jiggle between opens, no
 * Math.random. High-importance concepts feel stronger gravity and settle at
 * the center; relations act as springs; a final pass separates label boxes.
 */

export interface LayoutNode {
  concept: Concept
  x: number
  y: number
}

export interface LayoutEdge {
  /** Concept ids, in the reading direction of the first relation found. */
  source: string
  target: string
  /** Distinct relation types between the pair, e.g. ["is_a", "part_of"]. */
  types: string[]
}

export interface ConceptLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  width: number
  height: number
}

/** Node radius in layout units, by importance. */
export const NODE_RADIUS: Record<Importance, number> = { high: 7, medium: 5, low: 3.5 }

const GRAVITY: Record<Importance, number> = { high: 0.08, medium: 0.05, low: 0.035 }
const ITERATIONS = 260
const SEPARATION_PASSES = 40
const PADDING = 52

/** Deterministic hash of a string into [0, 1). */
function hash01(s: string, salt: number): number {
  let h = 2166136261 ^ Math.imul(salt, 2654435761)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

/** Half-width of a node's label box in layout units (11px sans, centered). */
function labelHalfWidth(c: Concept): number {
  return Math.max(18, c.name.length * 2.9 + 8)
}

const cache = new WeakMap<ConceptMap, ConceptLayout>()

export function layoutConceptMap(map: ConceptMap): ConceptLayout {
  const hit = cache.get(map)
  if (hit) return hit
  const layout = compute(map)
  cache.set(map, layout)
  return layout
}

function compute(map: ConceptMap): ConceptLayout {
  const concepts = map.concepts
  const n = concepts.length
  const index = new Map(concepts.map((c, i) => [c.id, i]))

  // Merge parallel relations into one edge per unordered pair; drop
  // self-loops and relations pointing at unknown ids.
  const edgeByPair = new Map<string, LayoutEdge>()
  for (const r of map.relations) {
    const a = index.get(r.source)
    const b = index.get(r.target)
    if (a === undefined || b === undefined || a === b) continue
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    const existing = edgeByPair.get(key)
    if (existing) {
      if (!existing.types.includes(r.type)) existing.types.push(r.type)
    } else {
      edgeByPair.set(key, { source: r.source, target: r.target, types: [r.type] })
    }
  }
  const edges = [...edgeByPair.values()]
  const springs = edges.map((e) => [index.get(e.source)!, index.get(e.target)!] as const)

  // Seeded start, biased landscape to suit the sheet's canvas.
  const spread = Math.sqrt(n + 1) * 64
  const x = concepts.map((c) => (hash01(c.id, 1) - 0.5) * spread * 1.7)
  const y = concepts.map((c) => (hash01(c.id, 2) - 0.5) * spread)
  const dx = new Float64Array(n)
  const dy = new Float64Array(n)
  const k = 62 // ideal edge length

  for (let iter = 0; iter < ITERATIONS; iter++) {
    dx.fill(0)
    dy.fill(0)

    // Pairwise repulsion, local only: beyond ~2 ideal edge lengths nodes stop
    // pushing, so disconnected subgraphs pack near each other under gravity
    // instead of drifting to the corners.
    const range2 = (k * 2.2) ** 2
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = x[i] - x[j]
        let vy = y[i] - y[j]
        let d2 = vx * vx + vy * vy
        if (d2 > range2) continue
        if (d2 < 0.01) {
          // Coincident seeds: nudge apart deterministically by index.
          vx = 0.1 * (i - j)
          vy = 0.05
          d2 = vx * vx + vy * vy
        }
        const d = Math.sqrt(d2)
        const f = Math.min((k * k) / d, 240) / d
        dx[i] += vx * f
        dy[i] += vy * f
        dx[j] -= vx * f
        dy[j] -= vy * f
      }
    }

    // Spring attraction along relations.
    for (const [a, b] of springs) {
      const vx = x[a] - x[b]
      const vy = y[a] - y[b]
      const d = Math.max(0.1, Math.hypot(vx, vy))
      const f = (d * d) / k / d
      dx[a] -= vx * f
      dy[a] -= vy * f
      dx[b] += vx * f
      dy[b] += vy * f
    }

    // Importance-weighted gravity: key concepts sink to the center. The pull
    // is stronger vertically so the cloud settles into a landscape shape.
    for (let i = 0; i < n; i++) {
      const g = GRAVITY[concepts[i].importance]
      dx[i] -= x[i] * g
      dy[i] -= y[i] * g * 1.7
    }

    // Cooling limits how far a node may move per step.
    const temp = 26 * (1 - iter / ITERATIONS) + 1.5
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(dx[i], dy[i])
      if (d > temp) {
        dx[i] *= temp / d
        dy[i] *= temp / d
      }
      x[i] += dx[i]
      y[i] += dy[i]
    }
  }

  // Separate overlapping label boxes (label sits centered under its node).
  const hw = concepts.map(labelHalfWidth)
  const hh = 15
  for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
    let moved = false
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ox = hw[i] + hw[j] - Math.abs(x[i] - x[j])
        const oy = hh * 2 - Math.abs(y[i] - y[j])
        if (ox <= 0 || oy <= 0) continue
        moved = true
        if (ox < oy) {
          const push = (ox / 2 + 0.5) * (x[i] >= x[j] ? 1 : -1)
          x[i] += push
          x[j] -= push
        } else {
          const push = (oy / 2 + 0.5) * (y[i] >= y[j] ? 1 : -1)
          y[i] += push
          y[j] -= push
        }
      }
    }
    if (!moved) break
  }

  // Normalize into a padded box.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, x[i] - hw[i])
    maxX = Math.max(maxX, x[i] + hw[i])
    minY = Math.min(minY, y[i])
    maxY = Math.max(maxY, y[i])
  }
  if (n === 0) {
    minX = minY = 0
    maxX = maxY = 100
  }

  const nodes: LayoutNode[] = concepts.map((c, i) => ({
    concept: c,
    x: x[i] - minX + PADDING,
    y: y[i] - minY + PADDING,
  }))

  return {
    nodes,
    edges,
    width: maxX - minX + PADDING * 2,
    height: maxY - minY + PADDING * 2 + 16,
  }
}
