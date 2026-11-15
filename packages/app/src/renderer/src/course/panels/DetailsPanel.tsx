import type { ReactNode } from 'react'
import type { CourseView } from '../../../../shared/contract.ts'
import { cardCount, useStore } from '../../store.ts'
import { lectureColour, plural, two } from '../../lecture.ts'
import { Segmented } from '../../ui/Segmented.tsx'
import { roleName } from './CardsPanel.tsx'
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

function LecChip({ number, small }: { number: number; small?: boolean }) {
  return (
    <span
      className={small ? 'lec-chip details-chip-small' : 'lec-chip'}
      style={{ background: lectureColour(number) }}
    >
      {two(number)}
    </span>
  )
}

function Decisions({ course }: { course: CourseView }) {
  const lectures = course.lectures
  const most = Math.max(1, ...lectures.map((l) => l.cards.length))
  const total = cardCount(course)

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
      {lectures.length > 0 && (
        <section className="panel-section">
          <div className="panel-section-head">
            <h2 className="panel-h2 panel-h2-large">Your deck</h2>
            <span className="panel-note">one part per lecture</span>
          </div>
          <div className="details-deck">
            <ol
              className="details-bars"
              aria-label="Cards per lecture"
              style={{ gridTemplateColumns: `repeat(${lectures.length}, minmax(0, 1fr))` }}
            >
              {lectures.map((l) => (
                <li key={l.number}>
                  <span className="details-bar-count num" aria-hidden="true">
                    {l.cards.length}
                  </span>
                  <i
                    aria-hidden="true"
                    style={{
                      height: Math.max(2, Math.round((l.cards.length / most) * 92)),
                      background: lectureColour(l.number),
                    }}
                  />
                  <span className="details-bar-number num" aria-hidden="true">
                    {two(l.number)}
                  </span>
                  <span className="details-hidden">
                    {l.title}, {plural(l.cards.length, 'card')}
                  </span>
                </li>
              ))}
            </ol>
            <p className="details-deck-total num">
              <b>{plural(total, 'card')}</b> in {plural(lectures.length, 'lecture')}, in course
              order
            </p>
          </div>
        </section>
      )}
    </>
  )
}

function pluralReason(reason: string, count: number): string {
  // The engine's reasons are short names ("Title slide") or whole sentences. Only a name of
  // two or three words takes a plural; a sentence is shown as the engine wrote it.
  const name = reason.charAt(0).toUpperCase() + reason.slice(1)
  const isName = name.split(' ').length <= 3 && /(slide|list)$/i.test(name)
  return count > 1 && isName ? `${name}s` : name
}

function clock(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function Statistics({ course }: { course: CourseView }) {
  const lectures = course.lectures
  const total = cardCount(course)
  const most = Math.max(1, ...lectures.map((l) => l.cards.length))

  const roles = new Map<string, number>()
  for (const l of lectures)
    for (const c of l.cards)
      roles.set(roleName(c.fields.Role), (roles.get(roleName(c.fields.Role)) ?? 0) + 1)
  const kinds = [...roles].sort((a, b) => b[1] - a[1])

  const reasons = new Map<string, number>()
  for (const l of lectures)
    for (const o of l.leftOut) reasons.set(o.reason, (reasons.get(o.reason) ?? 0) + 1)
  const leftOut = [...reasons].sort((a, b) => b[1] - a[1])
  const leftSlides = lectures.reduce((n, l) => n + l.leftOut.length, 0)
  const allSlides = lectures.reduce((n, l) => n + l.slides, 0)
  const dropped = lectures.reduce((n, l) => n + l.dropped.length, 0)

  const cost = course.runs.reduce((n, r) => n + r.costUsd, 0)
  const duration = course.runs.reduce((n, r) => n + r.durationMs, 0)

  return (
    <>
      {lectures.length > 0 && (
        <section className="panel-section" aria-label="Cards per lecture">
          <div className="panel-section-head">
            <h2 className="panel-h2">Cards per lecture</h2>
            <span className="panel-note num">
              {total} in {plural(lectures.length, 'lecture')}
            </span>
          </div>
          <ol className="stats-lectures">
            {lectures.map((l) => (
              <li key={l.number}>
                <LecChip number={l.number} small />
                <span className="stats-name">{l.title}</span>
                <span className="stats-track" aria-hidden="true">
                  <i
                    style={{
                      width: `${(l.cards.length / most) * 100}%`,
                      background: lectureColour(l.number),
                    }}
                  />
                </span>
                <b className="num">{l.cards.length}</b>
              </li>
            ))}
          </ol>
        </section>
      )}
      {kinds.length > 0 && (
        <section className="panel-section" aria-label="Kinds of card">
          <h2 className="panel-h2">Kinds of card</h2>
          <ul className="stats-kinds">
            {kinds.map(([name, count]) => (
              <li key={name}>
                <span>{name}</span>
                <b className="num">{count}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
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
                <span>{pluralReason(reason, count)}</span>
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
          <div className="stats-tiles">
            <div className="stats-tile">
              <p className="stats-figure num">${cost.toFixed(2)}</p>
              {total > 0 && (
                <p className="panel-note">about {((cost / total) * 100).toFixed(1)} cent a card</p>
              )}
            </div>
            <div className="stats-tile">
              <p className="stats-figure num">{clock(duration)}</p>
              <p className="panel-note">minutes, files to cards</p>
            </div>
          </div>
        </section>
      )}
    </>
  )
}
