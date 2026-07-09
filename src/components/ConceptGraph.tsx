import { useEffect, useMemo, useRef, useState } from 'react'
import type { Concept, ConceptMap } from '../engine/types'
import { layoutConceptMap, NODE_RADIUS } from './conceptLayout'

export type ConceptState = 'covered' | 'inferred' | 'open'

const STATE_LABEL: Record<ConceptState, string> = {
  covered: 'covered by a card',
  inferred: 'likely covered',
  open: 'no card yet',
}

export const humanizeRelation = (type: string) => type.replace(/_/g, ' ')

const MIN_ZOOM = 0.5
const MAX_ZOOM = 5

interface Transform {
  k: number
  x: number
  y: number
}

/**
 * The concept map as a constellation on the desk: concepts laid out by a
 * deterministic force simulation, sized by importance, lit amber where the
 * coverage ledger says a card exists. Relations are faint chalk lines whose
 * type labels appear when a node is hovered, focused, or selected.
 *
 * Navigation: scroll or pinch to zoom toward the cursor, drag to pan,
 * double-click the background (or the fit button) to reset.
 */
export function ConceptGraph({
  conceptMap,
  stateOf,
  selectedId,
  onSelect,
}: {
  conceptMap: ConceptMap
  stateOf: (c: Concept) => ConceptState
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const layout = useMemo(() => layoutConceptMap(conceptMap), [conceptMap])
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [t, setT] = useState<Transform>({ k: 1, x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ pointerId: number; start: Transform; x0: number; y0: number } | null>(null)
  const didPan = useRef(false)
  // Mirrors `drag` for the cursor class — refs must not be read during render.
  const [panning, setPanning] = useState(false)
  const activeId = hoverId ?? selectedId

  const neighbors = useMemo(() => {
    if (!activeId) return null
    const set = new Set([activeId])
    for (const e of layout.edges) {
      if (e.source === activeId) set.add(e.target)
      if (e.target === activeId) set.add(e.source)
    }
    return set
  }, [activeId, layout.edges])

  const pos = useMemo(() => new Map(layout.nodes.map((n) => [n.concept.id, n])), [layout.nodes])

  /** Pointer event position in the svg's (untransformed) viewBox space. */
  const toViewBox = (clientX: number, clientY: number) => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    return pt.matrixTransform(svg.getScreenCTM()!.inverse())
  }

  const zoomAt = (px: number, py: number, factor: number) => {
    setT((prev) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.k * factor))
      const s = k / prev.k
      return { k, x: px - (px - prev.x) * s, y: py - (py - prev.y) * s }
    })
  }

  const zoomFromCenter = (factor: number) => zoomAt(layout.width / 2, layout.height / 2, factor)
  const resetView = () => setT({ k: 1, x: 0, y: 0 })

  // Wheel zoom needs a non-passive listener to be allowed to preventDefault.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = toViewBox(e.clientX, e.clientY)
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0022))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const p = toViewBox(e.clientX, e.clientY)
    drag.current = { pointerId: e.pointerId, start: t, x0: p.x, y0: p.y }
    didPan.current = false
    setPanning(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    // The svg's CTM is transform-independent (the pan lives on an inner <g>),
    // so start coordinates stay comparable while dragging.
    const p = toViewBox(e.clientX, e.clientY)
    const dx = p.x - d.x0
    const dy = p.y - d.y0
    if (Math.abs(dx) + Math.abs(dy) > 2) didPan.current = true
    setT({ k: d.start.k, x: d.start.x + dx, y: d.start.y + dy })
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId === e.pointerId) {
      drag.current = null
      setPanning(false)
    }
  }

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        className={`h-full w-full ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
        role="group"
        aria-label="Concept map graph"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget || (e.target as Element).tagName === 'rect') resetView()
        }}
      >
        {/* Click-away to clear the selection (unless the press was a pan). */}
        <rect
          x={-layout.width * 4}
          y={-layout.height * 4}
          width={layout.width * 9}
          height={layout.height * 9}
          fill="transparent"
          onClick={() => {
            if (!didPan.current) onSelect(null)
          }}
        />

        <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
          {layout.edges.map((e) => {
            const a = pos.get(e.source)
            const b = pos.get(e.target)
            if (!a || !b) return null
            const lit = activeId !== null && (e.source === activeId || e.target === activeId)
            const dimmed = activeId !== null && !lit
            return (
              <g key={`${e.source}|${e.target}`} className="pointer-events-none">
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  strokeWidth={lit ? 1.5 : 1}
                  className={`transition-opacity duration-150 ${
                    lit ? 'stroke-lamp/60' : 'stroke-desk-edge'
                  } ${dimmed ? 'opacity-30' : ''}`}
                />
                {lit && (
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 4}
                    textAnchor="middle"
                    fontSize={10}
                    strokeWidth={3}
                    stroke="var(--color-desk-raised)"
                    style={{ paintOrder: 'stroke' }}
                    className="font-data fill-chalk-dim"
                  >
                    {e.types.map(humanizeRelation).join(' · ')}
                  </text>
                )}
              </g>
            )
          })}

          {layout.nodes.map(({ concept: c, x, y }) => {
            const state = stateOf(c)
            const r = NODE_RADIUS[c.importance]
            const active = c.id === activeId
            const dimmed = neighbors !== null && !neighbors.has(c.id)
            return (
              <g
                key={c.id}
                transform={`translate(${x} ${y})`}
                role="button"
                tabIndex={0}
                aria-pressed={c.id === selectedId}
                aria-label={`${c.name} — ${STATE_LABEL[state]}`}
                className={`cursor-pointer outline-none transition-opacity duration-150 ${
                  dimmed ? 'opacity-30' : ''
                }`}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseEnter={() => setHoverId(c.id)}
                onMouseLeave={() => setHoverId(null)}
                onFocus={() => setHoverId(c.id)}
                onBlur={() => setHoverId(null)}
                onClick={() => onSelect(c.id === selectedId ? null : c.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(c.id === selectedId ? null : c.id)
                  }
                }}
              >
                {/* Generous hit area. */}
                <circle r={Math.max(14, r + 8)} fill="transparent" />
                {active && (
                  <circle r={r + 4.5} className="fill-none stroke-lamp/70" strokeWidth={1} />
                )}
                {state === 'covered' && c.importance === 'high' && (
                  <circle r={r + 5} className="fill-lamp/15" />
                )}
                <circle
                  r={r}
                  strokeWidth={state === 'open' ? 1.25 : 0}
                  className={
                    state === 'covered'
                      ? 'fill-lamp'
                      : state === 'inferred'
                        ? 'fill-lamp/40'
                        : 'fill-desk-raised stroke-chalk-dim/80'
                  }
                />
                <text
                  y={r + 13}
                  textAnchor="middle"
                  fontSize={11}
                  strokeWidth={3.5}
                  stroke="var(--color-desk-raised)"
                  style={{ paintOrder: 'stroke' }}
                  className={c.importance === 'high' ? 'fill-chalk font-medium' : 'fill-chalk-dim'}
                >
                  {c.name}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      {/* Zoom controls */}
      <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-md">
        <button
          onClick={() => zoomFromCenter(1.35)}
          className="btn-ghost rounded-none px-2 py-1"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => zoomFromCenter(1 / 1.35)}
          className="btn-ghost rounded-none px-2 py-1"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          onClick={resetView}
          className="btn-ghost rounded-none px-2 py-1 text-xs"
          aria-label="Reset view"
          title="Reset view"
        >
          fit
        </button>
      </div>
    </div>
  )
}

/**
 * Dots-only miniature of the same layout, for the sidebar card. Purely
 * decorative — the button around it carries the label.
 */
export function ConceptMapPreview({
  conceptMap,
  stateOf,
  className,
}: {
  conceptMap: ConceptMap
  stateOf: (c: Concept) => ConceptState
  className?: string
}) {
  const layout = layoutConceptMap(conceptMap)
  const pos = new Map(layout.nodes.map((n) => [n.concept.id, n]))
  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden
    >
      {layout.edges.map((e) => {
        const a = pos.get(e.source)
        const b = pos.get(e.target)
        if (!a || !b) return null
        return (
          <line
            key={`${e.source}|${e.target}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            strokeWidth={2}
            className="stroke-desk-edge/70"
          />
        )
      })}
      {layout.nodes.map(({ concept: c, x, y }) => {
        const state = stateOf(c)
        return (
          <circle
            key={c.id}
            cx={x}
            cy={y}
            r={NODE_RADIUS[c.importance] * 2.2}
            className={`transition-colors duration-300 ${
              state === 'covered'
                ? 'fill-lamp'
                : state === 'inferred'
                  ? 'fill-lamp/45'
                  : 'fill-desk-edge'
            }`}
          />
        )
      })}
    </svg>
  )
}
