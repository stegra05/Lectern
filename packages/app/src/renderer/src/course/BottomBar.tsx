import type { ReactNode } from 'react'
import type { Panel } from '../store.ts'
import { cardCount, conceptCount, currentPhase, stageOf, unsentCount, useStore } from '../store.ts'
import { plural, two } from '../lecture.ts'
import { Icon } from '../ui/Icon.tsx'
import { PHASE_NOW, timeLeft, useTick } from './panels/RunPanel.tsx'
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
  const sending = useStore((s) => s.sending)
  const send = useStore((s) => s.send)
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
    const on = course.pending.find((p) => p.number === run.lecture)
    const first =
      phase === 'write' && write.done > 0
        ? on
          ? `Writing cards for ${two(on.number)} ${on.title}, ${write.done} so far`
          : `Writing your cards, ${write.done} so far`
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
  } else if (sending?.course === course.id) {
    const on = course.lectures.find((l) => l.number === sending.lecture)
    status = (
      <Lines
        first={`Sending to Anki, ${sending.done} of ${plural(sending.total, 'card')}`}
        second={on ? `${two(on.number)} ${on.title}. Keep Anki open.` : 'Keep Anki open.'}
      />
    )
  } else {
    const made = cardCount(course)
    const unsent = unsentCount(course)
    const counts = (
      <>
        <b>{made}</b> cards · <b>{conceptCount(course)}</b> concepts ·{' '}
        <b>{course.lectures.length}</b> lectures
      </>
    )
    if (unsent === 0) {
      status = (
        <Lines
          first={
            <>
              <b>{made}</b> cards are in Anki, in <b>{course.lectures.length}</b> subdecks
            </>
          }
          second="Open Anki and study. Add the next lecture here when it arrives."
          counts
        />
      )
    } else {
      status =
        unsent === made ? (
          <Lines
            first={counts}
            second="Click a lecture to read its cards. They are not in Anki yet."
            counts
          />
        ) : (
          <Lines
            first={counts}
            second={`Nothing already in Anki changes. Your ${plural(made - unsent, 'card')} there keep their progress.`}
            counts
          />
        )
      action = (
        <button type="button" className="btn btn-primary" onClick={() => void send()}>
          {failure ? 'Try again' : `Send ${plural(unsent, 'card')} to Anki`}
        </button>
      )
    }
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
