import { useState, type CSSProperties } from 'react'
import type { CourseSummary } from '../../../shared/contract.ts'
import { lectureColour, plural, two } from '../lecture.ts'
import { useStore } from '../store.ts'
import { Icon } from '../ui/Icon.tsx'
import { TitleBar } from '../ui/TitleBar.tsx'
import './entry.css'

/** The list of courses. Each one shows as a small version of its track. */
export function Courses() {
  const courses = useStore((s) => s.courses)
  const failure = useStore((s) => s.failure)
  const openCourse = useStore((s) => s.openCourse)
  const openSettings = useStore((s) => s.openSettings)
  const [adding, setAdding] = useState(false)

  return (
    <div className="entry">
      <TitleBar
        centre={<span className="entry-wintitle">Lectern</span>}
        right={
          <button
            type="button"
            className="icon-btn"
            aria-label="Settings"
            title="Settings"
            onClick={openSettings}
          >
            <Icon name="gear" size={15} stroke={1.4} />
          </button>
        }
      />
      <main className="entry-scroll">
        {courses.length === 0 ? (
          <div className="courses-first">
            <MiniTrack lectures={[]} pending={[1, 2, 3]} perRow={3} />
            <h1 className="t-title">Start your first course</h1>
            <p className="t-secondary">
              A course is one lecture series, such as Analysis 2. It becomes one deck in Anki that
              grows over the semester: name it, then drop in the slides of each lecture.
            </p>
            {adding ? (
              <NewCourseField onDone={() => setAdding(false)} />
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                New course
              </button>
            )}
            {failure && <FailureNote message={failure.message} fix={failure.fix} />}
          </div>
        ) : (
          <div className="courses">
            <header className="courses-head">
              <div>
                <h1 className="t-title">Courses</h1>
                <p className="t-secondary">
                  Each course is one deck in Anki that grows over the semester.
                </p>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => setAdding(true)}
                disabled={adding}
              >
                <Icon name="plus" size={12} stroke={1.8} />
                New course
              </button>
            </header>
            {failure && <FailureNote message={failure.message} fix={failure.fix} />}
            <ul className="courses-grid">
              {courses.map((course) => (
                <li key={course.id}>
                  <button
                    type="button"
                    className="course-card"
                    onClick={() => void openCourse(course.id)}
                  >
                    <div className="course-track">
                      <MiniTrack lectures={course.built} pending={course.pending} />
                    </div>
                    <div className="course-text">
                      <h2 className="t-heading course-name">{course.name}</h2>
                      <p className="course-status num">{statusOf(course)}</p>
                    </div>
                  </button>
                </li>
              ))}
              {/* A new course joins the end of the list, where it will stay. */}
              {adding && (
                <li className="course-card">
                  <div className="course-track">
                    <MiniTrack lectures={[]} pending={[1]} perRow={1} />
                  </div>
                  <div className="course-text">
                    <NewCourseField onDone={() => setAdding(false)} />
                  </div>
                </li>
              )}
            </ul>
          </div>
        )}
      </main>
    </div>
  )
}

/** One line of real status, from what the store holds. */
function statusOf(course: CourseSummary): string {
  const done = course.built.length
  const waiting = course.pending.length
  if (done === 0 && waiting === 0) return 'No lectures yet'
  if (done === 0) return `${plural(waiting, 'lecture')} waiting for cards`
  const made = `${plural(done, 'lecture')} · ${plural(course.cards, 'card')}`
  return waiting === 0 ? made : `${made}, ${plural(waiting, 'lecture')} waiting`
}

/** The name of a new course, typed in place. Enter creates it, Escape cancels. */
function NewCourseField({ onDone }: { onDone: () => void }) {
  const createCourse = useStore((s) => s.createCourse)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    await createCourse(trimmed)
    // On success the course opens and this is gone. Still here means it failed: try again.
    setBusy(false)
  }

  return (
    <div className="new-course">
      <input
        className="field new-course-input"
        aria-label="Name of the new course"
        placeholder="Course name"
        value={name}
        autoFocus
        disabled={busy}
        spellCheck={false}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void create()
          if (event.key === 'Escape') onDone()
        }}
        onBlur={() => {
          if (!name.trim()) onDone()
        }}
      />
      <p className="t-caption">
        {busy ? 'Creating the course' : 'Enter to create, Escape to cancel'}
      </p>
    </div>
  )
}

function FailureNote({ message, fix }: { message: string; fix: string }) {
  return (
    <div className="entry-failure entry-failure-boxed" role="alert">
      <Icon name="warning" size={14} />
      <p>
        <b>{message}</b> {fix}
      </p>
    </div>
  )
}

const STOP = 22
const ROW_GAP = 38
const MAX_STEP = 60
const MAX_WIDTH = 300
/** Room left and right of a row for the turn of the track. */
const MARGIN = ROW_GAP / 2 + 6
const PAD = 8
/** Every course card holds at most this many rows, so all cards have the same height. */
const MAX_ROWS = 3

/**
 * Which stops a small track shows. `perRow` stops go in a row and at most three rows fit. A
 * longer course shows its first lectures and ends in one stop that counts the rest.
 */
export function miniStops(
  count: number,
  perRow?: number,
): { perRow: number; shown: number; rest: number } {
  const cols = Math.max(
    1,
    perRow ?? (count <= 5 ? count : Math.min(8, Math.max(4, Math.ceil(count / MAX_ROWS)))),
  )
  const room = cols * MAX_ROWS
  if (count <= room) return { perRow: cols, shown: count, rest: 0 }
  return { perRow: cols, shown: room - 1, rest: count - room + 1 }
}

/**
 * A course as a small version of its track: its lectures as stops in course order, snaking in
 * rows like the map does. Lectures still waiting for cards are dashed and empty. A course too
 * long for the rows ends in a neutral stop with the number of lectures not shown.
 */
export function MiniTrack({
  lectures,
  pending,
  perRow,
  animate = false,
}: {
  lectures: number[]
  pending: number[]
  perRow?: number
  animate?: boolean
}) {
  const waiting = new Set(pending)
  const all = [...lectures, ...pending].sort((a, b) => a - b)
  const { perRow: cols, shown, rest } = miniStops(all.length, perRow)
  const stops = all.slice(0, shown)
  const n = shown + (rest > 0 ? 1 : 0)
  const rows = Math.ceil(n / cols)
  const step = cols > 1 ? Math.min(MAX_STEP, (MAX_WIDTH - 2 * MARGIN) / (cols - 1)) : 0
  const width = (cols - 1) * step + 2 * MARGIN
  const height = (rows - 1) * ROW_GAP + STOP + 2 * PAD

  const at = (i: number) => {
    const row = Math.floor(i / cols)
    const col = row % 2 === 0 ? i % cols : cols - 1 - (i % cols)
    return { x: MARGIN + col * step, y: PAD + STOP / 2 + row * ROW_GAP }
  }

  // The band runs through every stop and turns at the row ends, left and right in turn.
  let band = ''
  for (let i = 0; i < n; i++) {
    const { x, y } = at(i)
    if (i === 0) band = `M${x} ${y}`
    else if (i % cols === 0)
      band += ` A${ROW_GAP / 2} ${ROW_GAP / 2} 0 0 ${(i / cols) % 2 === 1 ? 1 : 0} ${x} ${y}`
    else band += ` L${x} ${y}`
  }
  const end = at(shown)

  return (
    <svg
      className={animate ? 'mini mini-animate' : 'mini'}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {n > 1 && <path className="mini-band" d={band} pathLength={1} />}
      {stops.map((number, i) => {
        const { x, y } = at(i)
        const open = waiting.has(number)
        return (
          <g
            key={number}
            className="mini-stop"
            style={{ '--i': i, transformOrigin: `${x}px ${y}px` } as CSSProperties}
          >
            <rect
              className={open ? 'mini-open' : 'mini-done'}
              x={x - STOP / 2}
              y={y - STOP / 2}
              width={STOP}
              height={STOP}
              rx={6.5}
              style={open ? undefined : { fill: lectureColour(number) }}
            />
            <text x={x} y={y} className={open ? 'mini-num mini-num-open' : 'mini-num'}>
              {two(number)}
            </text>
          </g>
        )
      })}
      {rest > 0 && (
        <g
          className="mini-stop"
          style={{ '--i': shown, transformOrigin: `${end.x}px ${end.y}px` } as CSSProperties}
        >
          <rect
            className="mini-rest"
            x={end.x - STOP / 2}
            y={end.y - STOP / 2}
            width={STOP}
            height={STOP}
            rx={6.5}
          />
          <text x={end.x} y={end.y} className="mini-num mini-num-rest">
            +{rest}
          </text>
        </g>
      )}
    </svg>
  )
}
