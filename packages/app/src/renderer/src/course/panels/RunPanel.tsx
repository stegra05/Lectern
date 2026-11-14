import { useEffect, useState, type ReactNode } from 'react'
import type { Goal, Phase } from '../../../../shared/contract.ts'
import { PHASES } from '../../../../shared/contract.ts'
import type { PhaseState, RunState } from '../../store.ts'
import { currentPhase, useStore } from '../../store.ts'
import { plural, two } from '../../lecture.ts'
import { Icon } from '../../ui/Icon.tsx'
import './panels.css'

/** What the engine is doing in each phase, in the words of the bar. */
export const PHASE_NOW: Record<Phase, string> = {
  read: 'Reading your lectures',
  map: 'Finding the topics and concepts',
  write: 'Writing your cards',
  check: 'Checking every card against its slide',
}

const GOAL_FOR: Record<Goal, string> = {
  pass: 'For a pass',
  good: 'For a good grade',
  top: 'For a top grade',
}

/**
 * Time left in the running phase, from its own pace: elapsed time times what remains over
 * what is done. Null when the phase has not counted anything yet, so nothing is guessed.
 */
export function timeLeft(run: RunState): string | null {
  const phase = currentPhase(run)
  if (!phase) return null
  const { done, total } = run.phases[phase]
  if (done <= 0 || total <= done) return null
  const ms = ((Date.now() - run.phaseStartedAt) * (total - done)) / done
  const minutes = Math.ceil(ms / 60_000)
  return minutes <= 1 ? 'Less than a minute' : `About ${minutes} minutes`
}

/** Renders again every few seconds while `on`, so the time left keeps counting. */
export function useTick(on: boolean): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => setTick((n) => n + 1), 5000)
    return () => clearInterval(id)
  }, [on])
}

/** The engine's four phases as a checklist, or what went wrong and the fix. */
export function RunPanel({ close }: { close: ReactNode }) {
  const course = useStore((s) => s.course)
  const run = useStore((s) => s.run)
  const failure = useStore((s) => s.failure)
  const goal = useStore((s) => s.goal)
  const build = useStore((s) => s.build)
  useTick(run !== null)
  if (!course) return null

  if (!run) {
    if (!failure) return null
    return (
      <>
        <div className="panel-head">
          <div className="panel-head-text">
            <span className="panel-eyebrow">{GOAL_FOR[goal]}</span>
            <h1 className="panel-title">Your cards were not made</h1>
          </div>
          {close}
        </div>
        <div className="panel-body">
          <div className="run-problem">
            <span className="run-problem-head">
              <Icon name="warning" size={14} stroke={1.6} />
              {failure.message}
            </span>
            <p>{failure.fix}</p>
          </div>
          <div>
            <button type="button" className="btn" onClick={() => void build()}>
              Try again
            </button>
          </div>
        </div>
      </>
    )
  }

  const lectures = course.pending.length
  const slides = course.pending.reduce((n, p) => n + p.slides, 0)
  const left = timeLeft(run)
  const phase = currentPhase(run)
  // The lecture the engine is on, as the map names it.
  const on = course.pending.find((p) => p.number === run.lecture)
  const now = on ? `${two(on.number)} ${on.title}` : null

  return (
    <>
      <div className="panel-head">
        <div className="panel-head-text">
          <span className="panel-eyebrow">{GOAL_FOR[goal]}</span>
          <h1 className="panel-title">Making your cards</h1>
        </div>
        {close}
      </div>
      <div className="panel-body">
        <p>
          Lectern reads the whole course first, then writes the cards and checks each one against
          its slide.
        </p>
        <ol className="panel-group run-steps" aria-label="What Lectern is doing">
          {PHASES.map((p) => (
            <Step
              key={p}
              phase={p}
              state={run.phases[p]}
              lectures={lectures}
              slides={slides}
              now={p === phase ? now : null}
            />
          ))}
        </ol>
        {left && phase && (
          <section className="panel-section panel-section-rule run-left">
            <p className="panel-eyebrow">Time left for this step</p>
            <p className="run-left-value num">{left}</p>
          </section>
        )}
      </div>
    </>
  )
}

function Step({
  phase,
  state,
  lectures,
  slides,
  now,
}: {
  phase: Phase
  state: PhaseState
  lectures: number
  slides: number
  /** The lecture this step is on, when the engine says so. */
  now: string | null
}) {
  const { status, done, total } = state
  const running = status === 'started'
  const counting = running && total > 0

  const title = {
    read: {
      waiting: `Read all ${plural(lectures, 'lecture')}`,
      started: `Reading all ${plural(lectures, 'lecture')}`,
      done: `Read all ${plural(lectures, 'lecture')}`,
    },
    map: {
      waiting: 'Find the topics and concepts',
      started: 'Finding the topics and concepts',
      done: 'Found the topics and concepts',
    },
    write: { waiting: 'Write the cards', started: 'Writing the cards', done: 'Wrote the cards' },
    check: {
      waiting: 'Check every card against its slide',
      started: 'Checking every card against its slide',
      done: 'Checked every card against its slide',
    },
  }[phase][status]

  let note: string
  if (phase === 'read') note = plural(slides, 'slide')
  else if (status === 'waiting') note = 'Next, after the step above'
  else if (status === 'done')
    note =
      phase === 'map'
        ? 'For every lecture'
        : `${plural(total, 'card')} ${phase === 'write' ? 'written' : 'checked'}`
  else if (counting && phase === 'map')
    note = now ? `${done} of ${total}, now ${now}` : `${done} of ${plural(total, 'lecture')}`
  else if (counting && phase === 'check') note = `${done} of ${plural(total, 'card')}`
  else note = 'Working on it now'

  return (
    <li className="run-step" data-status={status} aria-current={running ? 'step' : undefined}>
      <span className="run-mark" aria-hidden="true">
        {status === 'done' && <Icon name="check" size={12} stroke={2} />}
        {running && <i />}
      </span>
      <span className="run-step-text">
        <span className="run-step-title">
          <b>{title}</b>
          {phase === 'write' && counting && (
            <span className="run-count num">
              {done} of about {total}
            </span>
          )}
        </span>
        {!(phase === 'write' && counting) && <span className="panel-note">{note}</span>}
        {phase === 'write' && counting && now && <span className="panel-note">Now for {now}</span>}
        {phase === 'write' && counting && (
          <span className="run-progress" aria-hidden="true">
            <i style={{ width: `${Math.min(100, (done / total) * 100)}%` }} />
          </span>
        )}
      </span>
    </li>
  )
}
