import type { ReactNode } from 'react'
import type { Goal } from '../../../../shared/contract.ts'
import { cardCount, useStore } from '../../store.ts'
import { plural } from '../../lecture.ts'
import { Segmented } from '../../ui/Segmented.tsx'
import './panels.css'

/** What each goal makes, in one line, as the engine decides it. */
const CONSEQUENCE: Record<Goal, string> = {
  pass: 'What matters most: about one card for every two slides.',
  good: 'About one card per slide.',
  top: 'Everything worth learning: nearly two cards per slide.',
}

/** Before the cards: what was found in the files, and the goal question. */
export function SetupPanel({ close }: { close: ReactNode }) {
  const course = useStore((s) => s.course)
  const goal = useStore((s) => s.goal)
  const setGoal = useStore((s) => s.setGoal)
  const estimate = useStore((s) => s.estimate)
  if (!course) return null

  const lectures = course.pending.length
  const slides = course.pending.reduce((n, p) => n + p.slides, 0)
  const adding = cardCount(course) > 0

  return (
    <>
      <div className="panel-head">
        <div className="panel-head-text">
          <span className="panel-eyebrow">Before your cards</span>
          <h1 className="panel-title">{adding ? 'New lectures' : 'Your course'}</h1>
        </div>
        {close}
      </div>
      <div className="panel-body">
        <section className="panel-section">
          <p>
            {adding
              ? `I found ${plural(lectures, 'new lecture PDF')} and put them on the map after your other lectures.`
              : `I read your ${plural(lectures, 'lecture PDF')} and put them on the map in course order.`}
          </p>
          <ul className="panel-group">
            <li className="setup-found">
              <span className="setup-count num">{lectures}</span>
              <span>
                <b>{lectures === 1 ? 'lecture' : 'lectures'}</b>
                <span className="t-secondary">: {plural(slides, 'slide')}</span>
              </span>
            </li>
          </ul>
        </section>
        <section className="panel-section panel-section-rule setup-goal">
          <h2 id="goal-question" className="panel-h2 panel-h2-large">
            I am aiming for
          </h2>
          <Segmented<Goal>
            label="I am aiming for"
            large
            value={goal}
            onChange={(g) => void setGoal(g)}
            segments={[
              { value: 'pass', label: 'a pass' },
              { value: 'good', label: 'a good grade' },
              { value: 'top', label: 'a top grade' },
            ]}
          />
          <p className="panel-note">
            {CONSEQUENCE[goal]}
            {estimate && ` About ${plural(estimate.cards, 'card')}.`}
          </p>
        </section>
      </div>
    </>
  )
}
