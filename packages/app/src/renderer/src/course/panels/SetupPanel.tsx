import { useRef, type ReactNode } from 'react'
import type { FileKind, Goal, LeftFile } from '../../../../shared/contract.ts'
import { cardCount, useStore } from '../../store.ts'
import { plural } from '../../lecture.ts'
import { fromInput } from '../../picked.ts'
import { Segmented } from '../../ui/Segmented.tsx'
import './panels.css'

/** What each goal makes, in one line, as the engine decides it. */
const CONSEQUENCE: Record<Goal, string> = {
  pass: 'What matters most: about one card for every two slides.',
  good: 'About one card per slide.',
  top: 'Everything worth learning: nearly two cards per slide.',
}

/** Why a file of the last add stayed out of the course, in one line. */
const KIND_REASON: Record<FileKind, string> = {
  slides: 'Lecture slides.',
  exam: 'A past exam.',
  notes: 'Lecture notes or a summary. Cards are made from the slides.',
  'exam-solution': 'An exam solution. The questions are read from the exam itself.',
  exercise: 'An exercise sheet. Lectern does not use those yet.',
  'exercise-solution': 'An exercise solution. Lectern does not use those yet.',
  reading: 'A reading. Cards are made from the slides.',
  organisation: 'About how the course is run, not its subject.',
}

function reason(left: LeftFile): string {
  if (left.why === 'kind' && left.kind) return KIND_REASON[left.kind]
  if (left.why === 'unsure') return 'I could not tell what this is.'
  if (left.why === 'format') return 'Not a PDF. Export it as PDF and add that.'
  return 'This PDF could not be read.'
}

const nameOf = (path: string) =>
  path
    .split('/')
    .at(-1)!
    .replace(/\.pdf$/i, '')

/** Before the cards: what was found in the files, and the goal question. */
export function SetupPanel({ close }: { close: ReactNode }) {
  const course = useStore((s) => s.course)
  const goal = useStore((s) => s.goal)
  const setGoal = useStore((s) => s.setGoal)
  const estimate = useStore((s) => s.estimate)
  const addExams = useStore((s) => s.addExams)
  const leftOut = useStore((s) => s.leftOut)
  const addLeftOut = useStore((s) => s.addLeftOut)
  const moveFile = useStore((s) => s.moveFile)
  const picker = useRef<HTMLInputElement>(null)
  if (!course) return null

  const lectures = course.pending.length
  const slides = course.pending.reduce((n, p) => n + p.slides, 0)
  const adding = cardCount(course) > 0
  const already = leftOut.filter((l) => l.why === 'already').length
  const shown = leftOut.filter((l) => l.why !== 'already')

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
        {lectures > 0 && (
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
            <details className="setup-files">
              <summary>Lecture files</summary>
              <ul className="panel-group">
                {course.pending.map((p) => (
                  <li key={p.file} className="setup-row">
                    <span className="setup-paper-name">{nameOf(p.file)}</span>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      aria-label={`Move ${nameOf(p.file)} to past exams`}
                      onClick={() => void moveFile(p.file, 'exams')}
                    >
                      It is a past exam
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        )}
        {(shown.length > 0 || already > 0) && (
          <section className="panel-section panel-section-rule setup-left">
            <h2 className="panel-h2">Left out</h2>
            <p className="panel-note">
              Only lecture slides and past exams make cards. These files stay out of the course.
            </p>
            <ul className="panel-group">
              {shown.map((left) => (
                <li key={left.path} className="setup-row">
                  <span className="setup-paper-name" title={left.path}>
                    {nameOf(left.path)}
                  </span>
                  <span className="t-secondary">{reason(left)}</span>
                  {(left.why === 'kind' || left.why === 'unsure') && (
                    <span className="setup-row-actions">
                      <button
                        type="button"
                        className="btn btn-quiet"
                        aria-label={`Add ${nameOf(left.path)} as a lecture`}
                        onClick={() => void addLeftOut(left.path, 'slides')}
                      >
                        Add as lecture
                      </button>
                      <button
                        type="button"
                        className="btn btn-quiet"
                        aria-label={`Add ${nameOf(left.path)} as a past exam`}
                        onClick={() => void addLeftOut(left.path, 'exams')}
                      >
                        Add as past exam
                      </button>
                    </span>
                  )}
                </li>
              ))}
              {already > 0 && (
                <li className="setup-row t-secondary">
                  {already === 1
                    ? 'One file is in the course already.'
                    : `${already} files are in the course already.`}
                </li>
              )}
            </ul>
          </section>
        )}
        <section className="panel-section panel-section-rule setup-exams">
          <h2 className="panel-h2">Past exams</h2>
          <p className="panel-note">
            Questions that come back get a card first. Where your slides do not answer one, I answer
            it from what I know, and the card says so.
          </p>
          {course.exams.length > 0 && (
            <ul className="panel-group">
              {course.exams.map((paper) =>
                paper.questions === null ? (
                  <li key={paper.file} className="setup-row">
                    <span className="setup-paper-name">{nameOf(paper.file)}</span>
                    <span className="t-secondary">read with these cards</span>
                    <span className="setup-row-actions">
                      <button
                        type="button"
                        className="btn btn-quiet"
                        aria-label={`Move ${nameOf(paper.file)} to lectures`}
                        onClick={() => void moveFile(paper.file, 'slides')}
                      >
                        It is a lecture
                      </button>
                    </span>
                  </li>
                ) : (
                  <li key={paper.file} className="setup-paper">
                    <span className="setup-paper-name">{nameOf(paper.file)}</span>
                    <span className="t-secondary">{plural(paper.questions, 'question')}</span>
                  </li>
                ),
              )}
            </ul>
          )}
          <button type="button" className="btn" onClick={() => picker.current?.click()}>
            {course.exams.length > 0 ? 'Add more past exams' : 'Add past exams'}
          </button>
          <input
            ref={picker}
            type="file"
            accept=".pdf"
            multiple
            hidden
            aria-label="Past exam papers"
            onChange={(event) => {
              const files = fromInput(event.target.files)
              event.target.value = ''
              if (files.length > 0) void addExams(files)
            }}
          />
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
