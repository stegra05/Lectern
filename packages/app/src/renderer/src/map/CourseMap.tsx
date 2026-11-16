import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react'
import type { Lecture, Pending, Phase } from '../../../shared/contract.ts'
import { lectureColour, plural, two } from '../lecture.ts'
import { fromInput, type Picked } from '../picked.ts'
import { currentPhase, useStore } from '../store.ts'
import { Icon } from '../ui/Icon.tsx'
import { MapTools } from './MapTools.tsx'
import type { Box, Frame, Measure, Rings } from './rings.ts'
import { LABEL_MAX, baseline, fitRings, layoutRings, placeRings, plateBox } from './rings.ts'
import type { Area, Fit, Point, Track } from './track.ts'
import { bandPath, fan, fitTrack, labelWidth, layoutTrack } from './track.ts'
import './map.css'

const REFERENCE = { w: 1100, h: 720 }
/** The height of the map tools, and the space under them before the rings' labels may start. */
const TOOLS = 30
const TOOLS_GAP = 6
const ZOOM_STEP = 1.25

type Stop = { kind: 'lecture'; lecture: Lecture } | { kind: 'pending'; pending: Pending }

/** What a stop says while the engine is on its lecture. */
const NOW: Record<Phase, string> = {
  read: 'Reading now',
  map: 'Finding its topics',
  write: 'Writing its cards',
  check: 'Checking its cards',
}

/** What the title bar, the bottom bar and the side panel cover, read from the tokens of KIT.md. */
function readFrame() {
  const style = getComputedStyle(document.documentElement)
  const px = (name: string) => parseFloat(style.getPropertyValue(name))
  const gutter = px('--gutter')
  return {
    titlebar: px('--titlebar-h'),
    gutter,
    bar: px('--bar-h') + gutter,
    panel: px('--panel-w') + gutter,
  }
}

/** The user's own zoom and pan on top of the fitted view. It belongs to one view and panel. */
interface Adjust {
  key: string
  z: number
  dx: number
  dy: number
}

/**
 * The map under the title bar: the course as a winding track, or one lecture as rings. The map
 * never reshuffles: the side panel, the window size and the user's zoom only move the viewport,
 * and zooming moves positions while stops, dots and labels keep their size.
 */
export function CourseMap() {
  const course = useStore((s) => s.course)
  const view = useStore((s) => s.view)
  const panelOpen = useStore((s) => s.panel !== null)
  const openLecture = useStore((s) => s.openLecture)
  const selectTopic = useStore((s) => s.selectTopic)
  const selectConcept = useStore((s) => s.selectConcept)
  const showCourse = useStore((s) => s.showCourse)
  const addFiles = useStore((s) => s.addFiles)
  const run = useStore((s) => s.run)
  // During a run of this course the engine names the lecture it is on.
  const phase = run && run.course === course?.id ? currentPhase(run) : null
  const now = run?.lecture && phase ? { lecture: run.lecture, phase } : null

  const covered = useMemo(() => readFrame(), [])
  const root = useRef<HTMLElement>(null)
  const [size, setSize] = useState(REFERENCE)
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const measureSize = () => setSize({ w: element.clientWidth, h: element.clientHeight })
    const observer = new ResizeObserver(measureSize)
    observer.observe(element)
    measureSize()
    return () => observer.disconnect()
  }, [])

  const stops: Stop[] = useMemo(() => {
    if (!course) return []
    return [
      ...course.lectures.map((lecture) => ({ kind: 'lecture' as const, lecture })),
      ...course.pending.map((pending) => ({ kind: 'pending' as const, pending })),
    ].sort((a, b) => numberOf(a) - numberOf(b))
  }, [course])
  const track = useMemo(() => layoutTrack(stops.length), [stops.length])

  const lecture =
    view.level === 'lecture' ? course?.lectures.find((l) => l.number === view.lecture) : undefined
  const rings = useMemo(() => (lecture ? layoutRings(lecture, measure) : null), [lecture])

  const area: Area = {
    left: 0,
    top: covered.titlebar,
    right: size.w - (panelOpen ? covered.panel : 0),
    bottom: size.h - covered.bar,
  }
  const maxK = Math.max(1, Math.min(size.w / REFERENCE.w, size.h / REFERENCE.h))
  const centre = { x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 }
  // The rings keep clear of the window edge, the panel, the tools and the bottom bar.
  const bounds: Box = {
    left: area.left + 8,
    right: area.right - 8,
    top: covered.titlebar + covered.gutter + TOOLS + TOOLS_GAP,
    bottom: area.bottom - 6,
  }
  const fit: Fit = rings
    ? { k: fitRings(rings, centre, bounds, maxK), centre, origin: { x: 0, y: 0 } }
    : fitTrack(track, area, maxK)

  const key = `${lecture ? lecture.number : 'course'}:${panelOpen}`
  const [stored, setAdjust] = useState<Adjust>({ key, z: 1, dx: 0, dy: 0 })
  // Another lecture, the course again or the panel opening or closing starts from the fitted view.
  const adjust = stored.key === key ? stored : { key, z: 1, dx: 0, dy: 0 }
  if (stored !== adjust) setAdjust(adjust)
  const k = fit.k * adjust.z
  const toScreen = (p: Point): Point => ({
    x: fit.centre.x + k * (p.x - fit.origin.x) + adjust.dx,
    y: fit.centre.y + k * (p.y - fit.origin.y) + adjust.dy,
  })
  const shift = toScreen({ x: 0, y: 0 })

  const minZoom = lecture ? 0.85 : 0.5
  const zoomTo = (z: number, at: Point = centre) => {
    const next = Math.min(4, Math.max(minZoom, z))
    const ratio = next / adjust.z
    setAdjust({
      key,
      z: next,
      dx: at.x - fit.centre.x - ratio * (at.x - fit.centre.x - adjust.dx),
      dy: at.y - fit.centre.y - ratio * (at.y - fit.centre.y - adjust.dy),
    })
  }
  // Inside a lecture, zooming out past the fitted view goes back to the whole course.
  const backOut = lecture !== undefined && adjust.z / ZOOM_STEP < 0.999
  const zoomOut = () => {
    if (backOut) showCourse()
    else zoomTo(adjust.z / ZOOM_STEP)
  }

  // Wheel and pinch: a native listener, because React's is passive and pinching would zoom the page.
  const [moving, setMoving] = useState(false)
  const settle = useRef<number | undefined>(undefined)
  // After a wheel took the map back to the course, the rest of that gesture must not zoom on.
  const wheelHold = useRef(0)
  const onWheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault()
    if (stops.length === 0) return
    if (event.timeStamp < wheelHold.current) {
      wheelHold.current = event.timeStamp + 250
      return
    }
    const rect = root.current!.getBoundingClientRect()
    const z = adjust.z * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015))
    if (lecture && z < minZoom) {
      wheelHold.current = event.timeStamp + 400
      showCourse()
      return
    }
    setMoving(true)
    window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => setMoving(false), 160)
    zoomTo(z, { x: event.clientX - rect.left, y: event.clientY - rect.top })
  })
  useEffect(() => {
    const element = root.current
    if (!element) return
    const listener = (event: WheelEvent) => onWheel(event)
    element.addEventListener('wheel', listener, { passive: false })
    return () => element.removeEventListener('wheel', listener)
  }, [])

  // Dragging pans. A drag that started on a node must not also click it.
  const drag = useRef<{ x: number; y: number; dx: number; dy: number; moved: boolean } | null>(null)
  const swallowClick = useRef(false)
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || (event.target as Element).closest('.map-tools, .map-empty')) return
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      dx: adjust.dx,
      dy: adjust.dy,
      moved: false,
    }
  }
  const onPointerMove = (event: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const mx = event.clientX - d.x
    const my = event.clientY - d.y
    if (!d.moved) {
      if (Math.hypot(mx, my) < 4) return
      d.moved = true
      root.current?.setPointerCapture(event.pointerId)
      setMoving(true)
    }
    setAdjust({ key, z: adjust.z, dx: d.dx + mx, dy: d.dy + my })
  }
  const onPointerUp = () => {
    if (drag.current?.moved) {
      swallowClick.current = true
      setMoving(false)
    }
    drag.current = null
  }

  // Where the zoom of a level change starts: the stop of the lecture that was open.
  const [lastLecture, setLastLecture] = useState<number | null>(null)
  if (lecture && lecture.number !== lastLecture) setLastLecture(lecture.number)

  if (!course) return null
  const empty = stops.length === 0

  let layer = null
  if (lecture && rings) {
    const index = stops.findIndex(
      (s) => s.kind === 'lecture' && s.lecture.number === lecture.number,
    )
    // The neighbours follow the track: on a row that runs right to left, the previous is right.
    const dir = track.stops[index]?.dir ?? 1
    const before = stops[index - 1]
    const after = stops[index + 1]
    const edges = [
      { stop: dir === 1 ? before : after, side: -1 as const, x: area.left + 36 },
      { stop: dir === 1 ? after : before, side: 1 as const, x: area.right - 36 },
    ].flatMap(({ stop, side, x }) => (stop ? [{ stop, side, at: { x, y: centre.y } }] : []))
    layer = (
      <div
        key={`lecture-${lecture.number}`}
        className="map-layer map-enter-in"
        style={{ transformOrigin: `${shift.x}px ${shift.y}px` }}
      >
        <RingsView
          lecture={lecture}
          rings={rings}
          frame={{
            centre: shift,
            k,
            bounds,
            neighbours: edges.map((e) => neighbourBox(e.at, e.side)),
          }}
          edges={edges}
          topic={view.level === 'lecture' ? view.topic : undefined}
          concept={view.level === 'lecture' ? view.concept : undefined}
          onCentre={() => openLecture(lecture.number)}
          onTopic={selectTopic}
          onConcept={selectConcept}
          onOpen={openLecture}
        />
      </div>
    )
  } else if (!empty) {
    const from = stops.findIndex((s) => s.kind === 'lecture' && s.lecture.number === lastLecture)
    const origin = from >= 0 ? toScreen(track.stops[from]!) : centre
    layer = (
      <div
        key="course"
        className="map-layer map-enter-out"
        style={{ transformOrigin: `${origin.x}px ${origin.y}px` }}
      >
        <TrackView
          stops={stops}
          track={track}
          k={k}
          toScreen={toScreen}
          onOpen={openLecture}
          now={now}
        />
      </div>
    )
  }

  return (
    <section
      ref={root}
      className={`map${moving ? ' is-moving' : ''}`}
      aria-label={lecture ? `Lecture ${two(lecture.number)} ${lecture.title}` : 'Lectures'}
      style={{ backgroundPosition: `${adjust.dx}px ${adjust.dy}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={(event) => {
        if (!swallowClick.current) return
        swallowClick.current = false
        event.stopPropagation()
        event.preventDefault()
      }}
    >
      {layer}
      {empty && <EmptyPrompt area={area} onFiles={(files) => void addFiles(files)} />}
      {!empty && (
        <MapTools
          level={lecture ? `${two(lecture.number)} ${lecture.title}` : 'Whole course'}
          zoomOutLabel={backOut ? 'Zoom out to the whole course' : 'Zoom out'}
          fitLabel={lecture ? 'Fit the lecture' : 'Fit the whole course'}
          onZoomOut={zoomOut}
          onZoomIn={() => zoomTo(adjust.z * ZOOM_STEP)}
          onFit={() => setAdjust({ key, z: 1, dx: 0, dy: 0 })}
        />
      )}
    </section>
  )
}

function numberOf(stop: Stop): number {
  return stop.kind === 'lecture' ? stop.lecture.number : stop.pending.number
}

const widths = new Map<string, number>()
let ruler: CanvasRenderingContext2D | null | undefined

/** Text widths for the rings' labels, measured with the app's own font. */
const measure: Measure = (text, weight) => {
  const id = `${weight}|${text}`
  let width = widths.get(id)
  if (width === undefined) {
    ruler ??= document.createElement('canvas').getContext('2d')
    if (ruler) ruler.font = `${weight} 13px ${getComputedStyle(document.body).fontFamily}`
    width = ruler ? ruler.measureText(text).width : text.length * 7
    widths.set(id, width)
  }
  return width
}

const at = (p: Point): CSSProperties => ({ transform: `translate(${p.x}px, ${p.y}px)` })
const colourOf = (n: number) => ({ '--lec': lectureColour(n) }) as CSSProperties

function topicCards(lecture: Lecture): number[] {
  return lecture.topics.map((t) => {
    const ids = new Set(t.concepts.map((c) => c.id))
    return lecture.cards.filter((c) => ids.has(c.concept)).length
  })
}

function TrackView({
  stops,
  track,
  k,
  toScreen,
  onOpen,
  now,
}: {
  stops: Stop[]
  track: Track
  k: number
  toScreen: (p: Point) => Point
  onOpen: (lecture: number) => void
  /** During a run: the lecture the engine is on, and what it is doing there. */
  now: { lecture: number; phase: Phase } | null
}) {
  const width = labelWidth(k, track.step)
  const lectures = stops.flatMap((stop) => (stop.kind === 'lecture' ? [stop.lecture] : []))
  const made = lectures.reduce((sum, l) => sum + l.cards.length, 0)
  const sent = lectures.reduce((sum, l) => sum + l.sent, 0)
  const flag =
    sent === 0
      ? 'Not sent yet'
      : sent === made
        ? plural(sent, 'card')
        : `${sent} of ${plural(made, 'card')}`
  return (
    <>
      <svg className="map-svg" aria-hidden="true">
        <path className="map-band map-move" style={pathStyle(bandPath(track, toScreen, k))} />
      </svg>
      {stops.map((stop, i) => {
        const p = toScreen(track.stops[i]!)
        if (stop.kind === 'pending') {
          const { number, title, slides } = stop.pending
          const phase = now?.lecture === number ? now.phase : null
          return (
            <div
              key={`p${number}`}
              className={phase ? 'map-stop map-move map-stop-now' : 'map-stop map-move'}
              style={{ ...at(p), ...colourOf(number) }}
              role="img"
              aria-label={
                phase
                  ? `Lecture ${two(number)} ${title}, ${NOW[phase]}`
                  : `Lecture ${two(number)} ${title}, ${plural(slides, 'slide')}, no cards yet`
              }
              title={measure(title, 600) > width ? title : undefined}
            >
              <span className="map-square">{two(number)}</span>
              <StopLabel
                title={title}
                caption={phase ? NOW[phase] : plural(slides, 'slide')}
                width={width}
              />
            </div>
          )
        }
        const { number, title, cards, topics } = stop.lecture
        // Once part of the course is in Anki, a lecture that is not says so.
        const fresh = sent > 0 && stop.lecture.sent < cards.length
        const caption = plural(cards.length, fresh ? 'new card' : 'card')
        return (
          <button
            key={`l${number}`}
            type="button"
            className="map-stop map-move"
            style={{ ...at(p), ...colourOf(number) }}
            aria-label={`Open lecture ${two(number)} ${title}, ${caption}${fresh ? ', ready to send' : ''}, ${plural(topics.length, 'topic')}`}
            title={measure(title, 600) > width ? title : undefined}
            onClick={() => onOpen(number)}
          >
            <Fan cards={topicCards(stop.lecture)} />
            <span className="map-square">{two(number)}</span>
            <StopLabel title={title} caption={caption} width={width} />
          </button>
        )
      })}
      <div
        className={sent > 0 ? 'map-stop map-move is-flag is-sent' : 'map-stop map-move is-flag'}
        style={at(toScreen(track.flag))}
        role="img"
        aria-label={`In Anki, ${flag.charAt(0).toLowerCase()}${flag.slice(1)}`}
      >
        <svg className="map-square" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
          <rect className="map-flag-box" x="0.75" y="0.75" width="38.5" height="38.5" rx="11.25" />
          <g className="map-flag-icon" transform="translate(12 11)">
            <path d="M2 18V1" />
            <path d="M2 2h11l-2.6 3.6L13 9.2H2" />
          </g>
        </svg>
        <StopLabel title="In Anki" caption={flag} width={width} />
      </div>
    </>
  )
}

function StopLabel({ title, caption, width }: { title: string; caption: string; width: number }) {
  return (
    <span className="map-stop-label" style={{ width, left: 20 - width / 2 }}>
      <span className="map-stop-title">{title}</span>
      <span className="map-stop-caption">{caption}</span>
    </span>
  )
}

/** The short fan of dots above a stop, one per topic: a hint of the mind map inside. */
function Fan({ cards }: { cards: number[] }) {
  const dots = fan(cards)
  if (dots.length === 0) return null
  return (
    <svg className="map-fan" viewBox="-50 -50 100 50" width="100" height="50" aria-hidden="true">
      {dots.map((d, i) => (
        <g key={i}>
          <line x1={d.from.x} y1={d.from.y} x2={d.to.x} y2={d.to.y} />
          <circle cx={d.dot.x} cy={d.dot.y} r={d.r} />
        </g>
      ))}
    </svg>
  )
}

type Edge = { stop: Stop; side: -1 | 1; at: Point }

/** The box a faded neighbour takes, its stub towards the centre included. */
function neighbourBox(at: Point, side: -1 | 1): Box {
  const stub = 26
  return {
    left: at.x - 22 - (side === 1 ? stub : 0),
    right: at.x + 22 + (side === -1 ? stub : 0),
    top: at.y - 22,
    bottom: at.y + 22,
  }
}

/** An SVG path as a style, so that a change of shape glides like everything else. */
const pathStyle = (d: string) => ({ d: `path("${d}")` }) as CSSProperties

function RingsView({
  lecture,
  rings,
  frame,
  edges,
  topic,
  concept,
  onCentre,
  onTopic,
  onConcept,
  onOpen,
}: {
  lecture: Lecture
  rings: Rings
  frame: Frame
  edges: Edge[]
  topic?: number
  concept?: string
  onCentre: () => void
  onTopic: (topic: number) => void
  onConcept: (concept: string) => void
  onOpen: (lecture: number) => void
}) {
  // A concept under the pointer or the keyboard shows its name even where it has no room.
  const [peek, setPeek] = useState<string | null>(null)
  const placed = placeRings(rings, frame, { concept, topic })
  const selectedTopic = topic ?? rings.concepts.find((c) => c.id === concept)?.topic
  const whole = topic === undefined && !concept
  const { centre } = frame
  const twoLines = rings.title.length > 1
  const disc = rings.disc

  return (
    <div className="map-rings" style={colourOf(lecture.number)}>
      <svg className="map-svg" aria-hidden="true">
        <circle
          className="map-guide map-move"
          style={{ cx: centre.x, cy: centre.y, r: placed.inner }}
        />
        <circle
          className="map-guide map-move"
          style={{ cx: centre.x, cy: centre.y, r: placed.outer }}
        />
        {placed.topics.map((t, i) => (
          <path
            key={i}
            className={`map-spoke map-move${i === selectedTopic ? ' is-on' : ''}`}
            style={pathStyle(`M${centre.x},${centre.y} L${t.x},${t.y}`)}
          />
        ))}
        {placed.concepts.map((p, i) => {
          const c = rings.concepts[i]!
          const t = placed.topics[c.topic]!
          const on = c.id === concept || (!concept && c.topic === topic)
          return (
            <path
              key={c.id}
              className={`map-spoke map-move${on ? ' is-on' : ''}`}
              style={pathStyle(`M${t.x},${t.y} L${p.x},${p.y}`)}
            />
          )
        })}
      </svg>

      <button
        type="button"
        className={`map-centre map-move${whole ? ' is-selected' : ''}`}
        style={{ ...at(centre), left: -disc, top: -disc, width: disc * 2, height: disc * 2 }}
        aria-label={`All cards of lecture ${two(lecture.number)} ${lecture.title}, ${plural(lecture.cards.length, 'card')}`}
        title={rings.title.join(' ') !== lecture.title ? lecture.title : undefined}
        aria-pressed={whole}
        onClick={onCentre}
      >
        <span className="map-square" style={{ left: disc - 20, top: disc - (twoLines ? 56 : 42) }}>
          {two(lecture.number)}
        </span>
        <span className="map-centre-text" style={{ top: disc + (twoLines ? -7 : 5) }}>
          {rings.title.map((line) => (
            <span key={line} className="map-centre-title">
              {line}
            </span>
          ))}
          <span className="map-centre-caption">{plural(lecture.cards.length, 'card')}</span>
        </span>
      </button>

      {placed.concepts.map((p, i) => {
        const c = rings.concepts[i]!
        const selected = c.id === concept
        const shown =
          p.label ??
          (peek === c.id ? { base: baseline(c.angle), width: Math.min(c.width, LABEL_MAX) } : null)
        // The button is the label's box and holds the dot too; the selection fills it. A concept
        // without a label is just its dot, with a little room around it for the pointer.
        const box = shown
          ? plateBox(c, shown.base, shown.width, true)
          : { left: -c.r - 5, right: c.r + 5, top: -c.r - 5, bottom: c.r + 5 }
        const cut = shown !== null && shown.width < c.width - 0.5
        return (
          <button
            key={c.id}
            type="button"
            className={`map-concept map-move${selected ? ' is-selected' : ''}${c.side === -1 ? ' is-left' : ''}${shown && !p.label ? ' is-peek' : ''}`}
            style={{
              ...at(p),
              left: box.left,
              top: box.top,
              width: box.right - box.left,
              height: box.bottom - box.top,
            }}
            aria-label={`${c.name}, ${plural(c.cards, 'card')}`}
            title={cut ? c.name : undefined}
            aria-pressed={selected}
            onClick={() => onConcept(c.id)}
            onPointerEnter={() => setPeek(c.id)}
            onPointerLeave={() => setPeek((id) => (id === c.id ? null : id))}
            onFocus={() => setPeek(c.id)}
            onBlur={() => setPeek((id) => (id === c.id ? null : id))}
          >
            <span
              className="map-dot"
              style={{
                width: 2 * c.r,
                height: 2 * c.r,
                left: -box.left - c.r,
                top: -box.top - c.r,
              }}
            />
            {shown && (
              <span
                className="map-concept-label"
                style={{
                  top: shown.base - 12 - box.top,
                  width: shown.width,
                  [c.side === 1 ? 'left' : 'right']: 2 * c.r + 13,
                }}
              >
                <span className="map-concept-name">{c.name}</span>
                <span className="map-concept-caption">{plural(c.cards, 'card')}</span>
              </span>
            )}
          </button>
        )
      })}

      {placed.topics.map((t, i) => (
        <button
          key={i}
          type="button"
          className={`map-pill map-move${i === topic ? ' is-selected' : ''}`}
          style={{
            transform: `translate(${t.x}px, ${t.y}px) translate(-50%, -50%)`,
            maxWidth: t.width,
          }}
          title={measure(t.name, 600) + 26 > t.width + 0.5 ? t.name : undefined}
          aria-pressed={i === topic}
          onClick={() => onTopic(i)}
        >
          {t.name}
        </button>
      ))}

      {edges.map((e, i) =>
        placed.neighbours[i] ? <Neighbour key={e.side} {...e} onOpen={onOpen} /> : null,
      )}
    </div>
  )
}

/** The previous or next stop of the track, faded at the edge, so a lecture reads as a zoom. */
function Neighbour({
  stop,
  side,
  at: p,
  onOpen,
}: {
  stop: Stop
  side: -1 | 1
  at: Point
  onOpen: (lecture: number) => void
}) {
  const number = numberOf(stop)
  const title = stop.kind === 'lecture' ? stop.lecture.title : stop.pending.title
  const inner = (
    <>
      <span className={`map-stub${side === 1 ? ' is-right' : ''}`} />
      <span className="map-square">{two(number)}</span>
    </>
  )
  const style = { ...at(p), ...colourOf(number) }
  if (stop.kind === 'pending') {
    return (
      <div
        className="map-neighbour"
        style={style}
        role="img"
        aria-label={`Lecture ${two(number)} ${title}, no cards yet`}
      >
        {inner}
      </div>
    )
  }
  return (
    <button
      type="button"
      className="map-neighbour"
      style={style}
      aria-label={`Go to lecture ${two(number)} ${title}`}
      title={`${two(number)} ${title}`}
      onClick={() => onOpen(number)}
    >
      {inner}
    </button>
  )
}

/** A course without lectures: one calm invitation to bring the slides, as PDFs or a folder. */
function EmptyPrompt({ area, onFiles }: { area: Area; onFiles: (files: Picked[]) => void }) {
  const pdfs = useRef<HTMLInputElement>(null)
  const folder = useRef<HTMLInputElement>(null)
  const pick = (input: HTMLInputElement) => {
    const files = fromInput(input.files)
    input.value = ''
    if (files.length > 0) onFiles(files)
  }
  return (
    <div
      className="map-empty"
      style={{
        left: area.left,
        top: area.top,
        width: area.right - area.left,
        height: area.bottom - area.top,
      }}
    >
      <div className="map-empty-track" aria-hidden="true">
        <span className="map-empty-band" />
        <span className="map-empty-stop">
          <Icon name="doc" size={18} stroke={1.4} />
        </span>
        <span className="map-empty-stop" />
        <span className="map-empty-stop">
          <Icon name="flag" size={18} stroke={1.4} />
        </span>
      </div>
      <h2 className="t-heading">Bring your lecture slides</h2>
      <p className="map-empty-text">
        Drop the PDFs or their folder anywhere on this window, one file per lecture. Each one
        becomes a stop on your course track.
      </p>
      <div className="map-empty-actions">
        <button type="button" className="btn" onClick={() => pdfs.current?.click()}>
          Choose PDFs
        </button>
        <button type="button" className="btn" onClick={() => folder.current?.click()}>
          Choose a folder
        </button>
      </div>
      <input
        ref={pdfs}
        type="file"
        accept=".pdf"
        multiple
        hidden
        aria-label="Lecture PDFs"
        onChange={(event) => pick(event.target)}
      />
      <input
        ref={(input) => {
          folder.current = input
          // React has no prop for a folder picker; the attribute makes the input choose folders.
          input?.setAttribute('webkitdirectory', '')
        }}
        type="file"
        hidden
        aria-label="Folder of lecture PDFs"
        onChange={(event) => pick(event.target)}
      />
    </div>
  )
}
