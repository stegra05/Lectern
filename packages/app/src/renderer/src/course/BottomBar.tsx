import type { ReactNode } from 'react'
import type { Panel } from '../store.ts'
import { cardCount, conceptCount, stageOf, useStore } from '../store.ts'
import { plural } from '../lecture.ts'
import { Icon } from '../ui/Icon.tsx'
import { currentPhase, PHASE_NOW, timeLeft, useTick } from './panels/RunPanel.tsx'
import './bar.css'

export function dollars(usd: number): string {
  return `$${usd.toFixed(2)}`
}

/**
 * The slim bar at the bottom: where the course stands, the quiet "Details" button and the one
 * primary action of the moment. It never grows: every status fits in two lines.
 */
export function BottomBar() {
  const course = useStore((s) => s.course)
  const run = useStore((s) => s.run)
  const failure = useStore((s) => s.failure)
  const estimate = useStore((s) => s.estimate)
  const panel = useStore((s) => s.panel)
  const build = useStore((s) => s.build)
  const openPanel = useStore((s) => s.openPanel)
  const openDetails = useStore((s) => s.openDetails)
  const closePanel = useStore((s) => s.closePanel)
  useTick(run !== null)

  if (!course) return null
  const stage = stageOf(course, run)

  // The panel that fits the stage. An empty course has nothing to show in one.
  const fitting: Panel = { empty: null, setup: 'setup', running: 'run', ready: 'details' }[
    stage
  ] as Panel
  const pressed = fitting !== null && panel === fitting

  let status: ReactNode
  let action: ReactNode = null
  let aside: string | null = null

  if (stage === 'empty') {
    status = (
      <Lines first="No lectures yet" second="Drop your lecture PDFs here, one PDF per lecture." />
    )
  } else if (stage === 'setup') {
    const lectures = course.pending.length
    const slides = course.pending.reduce((n, p) => n + p.slides, 0)
    const made = cardCount(course)
    status =
      made > 0 ? (
        <Lines
          first={`${plural(lectures, 'new lecture')} found, ${plural(slides, 'slide')}`}
          second={`${plural(made, 'card')} already made for ${plural(course.lectures.length, 'lecture')}.`}
        />
      ) : (
        <Lines
          first={`${plural(lectures, 'lecture')} found, ${plural(slides, 'slide')}`}
          second="Choose your goal, then make your cards."
        />
      )
    if (estimate) aside = `About ${dollars(estimate.costUsd)}`
    const label = failure
      ? 'Try again'
      : made > 0
        ? `Make cards for ${plural(lectures, 'new lecture')}`
        : 'Make my cards'
    action = (
      <button type="button" className="btn btn-primary" onClick={() => void build()}>
        {label}
      </button>
    )
  } else if (stage === 'running' && run) {
    const phase = currentPhase(run)
    const write = run.phases.write
    const first =
      phase === 'write' && write.done > 0
        ? `Writing your cards, ${write.done} so far`
        : phase
          ? PHASE_NOW[phase]
          : 'Getting ready'
    const left = timeLeft(run)
    status = (
      <Lines
        first={first}
        second={left ? `${left} left. Nothing to decide here.` : 'Nothing to decide here.'}
      />
    )
  } else {
    status = (
      <Lines
        first={
          <>
            <b>{cardCount(course)}</b> cards · <b>{conceptCount(course)}</b> concepts ·{' '}
            <b>{course.lectures.length}</b> lectures
          </>
        }
        second="Click a lecture to read its cards. They are not in Anki yet."
        counts
      />
    )
  }

  // A problem outside a run replaces the status, with its fix underneath.
  if (failure && stage !== 'running') {
    status = (
      <span className="bar-lines">
        <span className="bar-first bar-problem">
          <Icon name="warning" size={13} stroke={1.6} />
          <span className="bar-clip">{failure.message}</span>
        </span>
        <span className="bar-second">{failure.fix}</span>
      </span>
    )
  }

  return (
    <section className="bar material" aria-label="Status">
      <div className="bar-status" role="status">
        {status}
      </div>
      {fitting && (
        <button
          type="button"
          className="bar-details"
          aria-pressed={pressed}
          aria-controls="side-panel"
          onClick={() => {
            if (pressed) closePanel()
            else if (fitting === 'details') openDetails()
            else openPanel(fitting)
          }}
        >
          <Icon name="panel" size={14} stroke={1.4} />
          Details
        </button>
      )}
      {aside && <span className="bar-aside num">{aside}</span>}
      {action}
    </section>
  )
}

function Lines({ first, second, counts }: { first: ReactNode; second: string; counts?: boolean }) {
  return (
    <span className="bar-lines">
      <span className={counts ? 'bar-first bar-counts num' : 'bar-first'}>
        <span className="bar-clip">{first}</span>
      </span>
      <span className="bar-second">{second}</span>
    </span>
  )
}
