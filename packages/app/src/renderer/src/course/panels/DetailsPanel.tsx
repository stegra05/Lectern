import type { ReactNode } from 'react'
import type { CourseView } from '../../../../shared/contract.ts'
import { useStore } from '../../store.ts'
import { euros, lectureColour, plural, two } from '../../lecture.ts'
import { Segmented } from '../../ui/Segmented.tsx'
import './panels.css'

/** Course details: what Lectern decided and the deck, or the statistics. */
export function DetailsPanel({ close }: { close: ReactNode }) {
  const course = useStore((s) => s.course)
  const tab = useStore((s) => s.detailsTab)
  const openDetails = useStore((s) => s.openDetails)
  if (!course) return null

  return (
    <>
      <div className="panel-head details-head">
        <div className="details-tabs">
          <Segmented<'decisions' | 'statistics'>
            label="Course details"
            value={tab}
            onChange={openDetails}
            segments={[
              { value: 'decisions', label: 'Decisions' },
              { value: 'statistics', label: 'Statistics' },
            ]}
          />
        </div>
        {close}
      </div>
      <div className="panel-body">
        {tab === 'decisions' ? <Decisions course={course} /> : <Statistics course={course} />}
      </div>
    </>
  )
}

function LecChip({ number }: { number: number }) {
  return (
    <span className="lec-chip" style={{ background: lectureColour(number) }}>
      {two(number)}
    </span>
  )
}

function Decisions({ course }: { course: CourseView }) {
  return (
    <>
      {course.decisions.length > 0 && (
        <section className="panel-section">
          <h2 className="panel-h2 panel-h2-large">What I decided</h2>
          <ol className="panel-group">
            {course.decisions.map((d, i) => (
              <li key={i} className="details-decision">
                <span className="details-index num" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{d.text}</span>
                {d.lecture !== null && <LecChip number={d.lecture} />}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  )
}

function Statistics({ course }: { course: CourseView }) {
  const lectures = course.lectures
  const reasons = new Map<string, number>()
  for (const l of lectures)
    for (const o of l.leftOut) reasons.set(o.reason, (reasons.get(o.reason) ?? 0) + 1)
  const leftOut = [...reasons].sort((a, b) => b[1] - a[1])
  const leftSlides = lectures.reduce((n, l) => n + l.leftOut.length, 0)
  const allSlides = lectures.reduce((n, l) => n + l.slides, 0)
  const dropped = lectures.reduce((n, l) => n + l.dropped.length, 0)

  const cost = course.runs.reduce((n, r) => n + r.costEur, 0)

  return (
    <>
      {(leftOut.length > 0 || dropped > 0) && (
        <section className="panel-section" aria-label="Left out, and why">
          <div className="panel-section-head">
            <h2 className="panel-h2">Left out, and why</h2>
            {allSlides > 0 && (
              <span className="panel-note num">
                {leftSlides} of {plural(allSlides, 'slide')}
              </span>
            )}
          </div>
          <ul className="stats-left">
            {leftOut.map(([reason, count]) => (
              <li key={reason}>
                <b className="num">{count}</b>
                <span>{reason}</span>
              </li>
            ))}
            {dropped > 0 && (
              <li>
                <b className="num">{dropped}</b>
                <span>
                  {dropped === 1 ? 'Card' : 'Cards'}
                  <span className="t-secondary">
                    : did not pass the check, listed with their concept
                  </span>
                </span>
              </li>
            )}
          </ul>
        </section>
      )}
      {course.runs.length > 0 && (
        <section className="panel-section" aria-label="What it cost">
          <div className="panel-section-head">
            <h2 className="panel-h2">What it cost</h2>
            <span className="panel-note">on your own API key</span>
          </div>
          <p className="stats-figure num">{euros(cost)}</p>
        </section>
      )}
    </>
  )
}
