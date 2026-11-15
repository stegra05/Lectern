import { useState, type ReactNode } from 'react'
import type { Problem, Slots } from '../../../../shared/contract.ts'
import { lectureColour, two } from '../../lecture.ts'
import { useStore } from '../../store.ts'
import { Icon } from '../../ui/Icon.tsx'
import { roleName } from './CardsPanel.tsx'
import './editor.css'

/** The kinds whose one-sentence answer carries a key term, as `design/cards/FIELDS.md` has it. */
const KEYED = new Set(['definition', 'why', 'diagram'])
/** How many parts a gap card may hide, and how many items a list may have. */
const MOST_PARTS = 5

const count = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

/**
 * The form on one card: a card of the lecture being changed, or one the student writes. It
 * holds the slots of the card's kind in plain text; the engine checks them and builds the card.
 */
export function CardEditor({ close }: { close: ReactNode }) {
  const course = useStore((s) => s.course)
  const editor = useStore((s) => s.editor)
  const setEditor = useStore((s) => s.setEditor)
  const setEditorKind = useStore((s) => s.setEditorKind)
  const saveCard = useStore((s) => s.saveCard)
  const removeCard = useStore((s) => s.removeCard)
  const closeEditor = useStore((s) => s.closeEditor)
  const [removing, setRemoving] = useState(false)
  const lecture = course?.lectures.find((l) => l.number === editor?.lecture)
  if (!editor || !lecture) return null

  const { slots, limits, problems, busy } = editor
  const own = editor.card === null
  const concepts = lecture.topics.flatMap((topic) => topic.concepts)
  const concept = concepts.find((c) => c.id === editor.concept)
  const inAnki = editor.card !== null && lecture.inAnki.includes(editor.card)
  const gap = slots.role === 'cloze'
  const list = slots.role === 'cloze-list'
  const set = (changes: Partial<Slots>) => setEditor({ slots: { ...slots, ...changes } })
  const setAnswer = (i: number, changes: Partial<Slots['answers'][number]>) =>
    set({ answers: slots.answers.map((a, at) => (at === i ? { ...a, ...changes } : a)) })
  const setAt = (key: 'labels' | 'hidden', i: number, value: string) =>
    set({ [key]: slots[key].map((old, at) => (at === i ? value : old)) })
  const about = (field: Problem['field']) => problems.filter((p) => p.field === field)

  const paired = slots.labels.length > 0 && slots.labels.length === slots.answers.length
  const single = slots.answers.length === 1 && !list
  const answerWords = slots.answers
    .slice(slots.role === 'formula' ? 1 : 0)
    .reduce((sum, a) => sum + count(a.text), 0)

  return (
    <form
      className="editor"
      onSubmit={(event) => {
        event.preventDefault()
        void saveCard()
      }}
    >
      <div className="cards-head">
        <div className="cards-crumb">
          <span className="lec-chip" style={{ background: lectureColour(lecture.number) }}>
            {two(lecture.number)}
          </span>
          <span className="cards-crumb-text">
            {[lecture.title, concept?.name, own ? 'your own card' : roleName(slots.role)]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {close}
        </div>
        <h1 className="cards-title">{own ? 'Add your own card' : 'Edit this card'}</h1>
      </div>

      <div className="editor-body">
        {own && (
          <>
            <Field label="Concept" id="editor-concept">
              <select
                id="editor-concept"
                className="field"
                value={editor.concept}
                onChange={(event) => setEditor({ concept: event.target.value })}
              >
                {lecture.topics.map((topic) => (
                  <optgroup key={topic.name} label={topic.name}>
                    {topic.concepts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            <div className="editor-field">
              <span className="editor-label" id="editor-kind">
                Kind of card
              </span>
              <div role="group" aria-labelledby="editor-kind" className="segmented editor-kind">
                <button
                  type="button"
                  aria-pressed={!gap}
                  onClick={() => void setEditorKind('definition')}
                >
                  Question and answer
                </button>
                <button
                  type="button"
                  aria-pressed={gap}
                  onClick={() => void setEditorKind('cloze')}
                >
                  Fill in the gap
                </button>
              </div>
            </div>
          </>
        )}

        <Field
          label={gap ? 'Sentence' : list ? 'Lead-in' : 'Question'}
          id="editor-front"
          words={[count(slots.front), gap ? limits.gapSentence : limits.front]}
          problems={about('front')}
        >
          <textarea
            id="editor-front"
            className="field editor-text"
            rows={3}
            value={slots.front}
            onChange={(event) => set({ front: event.target.value })}
          />
        </Field>

        {slots.role === 'code' && (
          <Field label="Listing" id="editor-code" problems={about('code')}>
            <textarea
              id="editor-code"
              className="field editor-text editor-code"
              rows={6}
              spellCheck={false}
              value={slots.code}
              onChange={(event) => set({ code: event.target.value })}
            />
          </Field>
        )}

        {gap && (
          <Parts
            label="Words to hide"
            hint="Each part as it stands in the sentence, in that order."
            values={slots.hidden}
            name={(i) => `Hidden part ${i + 1}`}
            least={1}
            add="Hide another part"
            problems={about('hidden')}
            onChange={(i, value) => setAt('hidden', i, value)}
            onCount={(hidden) => set({ hidden })}
          />
        )}

        {slots.labels.length > 0 && !paired && (
          <Parts
            label="Steps given"
            values={slots.labels}
            name={(i) => `Step ${i + 1}`}
            problems={about('label')}
            onChange={(i, value) => setAt('labels', i, value)}
          />
        )}

        {single && (
          <Field
            label="Answer"
            id="editor-answer"
            words={[answerWords, limits.answer]}
            problems={about('answer')}
          >
            <textarea
              id="editor-answer"
              className="field editor-text"
              rows={3}
              value={slots.answers[0]!.text}
              onChange={(event) => setAnswer(0, { text: event.target.value })}
            />
          </Field>
        )}
        {single && KEYED.has(slots.role) && (
          <Field
            label="Key term, in bold"
            id="editor-key"
            hint="The words of the answer to remember."
            problems={about('key')}
          >
            <input
              id="editor-key"
              className="field"
              value={slots.answers[0]!.key}
              onChange={(event) => setAnswer(0, { key: event.target.value })}
            />
          </Field>
        )}

        {paired && (
          <div className="editor-field">
            <span className="editor-label">
              <span>{slots.role === 'contrast' ? 'The two sides' : 'Answer'}</span>
              <Words now={answerWords} limit={limits.answer} />
            </span>
            {slots.answers.map((answer, i) => (
              <div key={i} className="editor-pair">
                <input
                  className="field"
                  aria-label={`Name of side ${i + 1}`}
                  value={slots.labels[i]}
                  onChange={(event) => setAt('labels', i, event.target.value)}
                />
                <input
                  className="field"
                  aria-label={`Answer for side ${i + 1}`}
                  value={answer.text}
                  onChange={(event) => setAnswer(i, { text: event.target.value })}
                />
              </div>
            ))}
            <Problems problems={[...about('label'), ...about('answer')]} />
          </div>
        )}

        {!single && !paired && slots.answers.length > 0 && (
          <Parts
            label={
              list ? 'Items' : slots.role === 'formula' ? 'Formula, then its condition' : 'Answer'
            }
            words={list || slots.role === 'formula' ? undefined : [answerWords, limits.answer]}
            values={slots.answers.map((a) => a.text)}
            name={(i) => (list ? `Item ${i + 1}` : `Answer ${i + 1}`)}
            least={list ? 2 : undefined}
            add={list ? 'Add an item' : undefined}
            problems={about('answer')}
            onChange={(i, text) => setAnswer(i, { text })}
            onCount={
              list
                ? (texts) => set({ answers: texts.map((text) => ({ text, key: '' })) })
                : undefined
            }
          />
        )}

        <Field
          label="Extra line, optional"
          id="editor-extra"
          words={[count(slots.extra), limits.extra]}
          problems={about('extra')}
        >
          <input
            id="editor-extra"
            className="field"
            placeholder="Context that shows under the answer"
            value={slots.extra}
            onChange={(event) => set({ extra: event.target.value })}
          />
        </Field>

        <Problems problems={about('card')} />
        <p className="panel-note editor-note">
          {own
            ? 'Cards you add are marked as yours in Anki. Lectern never changes or removes them.'
            : inAnki
              ? 'This card is in Anki. Saving changes it there too, and it keeps its progress.'
              : 'Changes are free until you send. After that, Lectern never rewrites a card on its own.'}
        </p>
      </div>

      {removing ? (
        <div className="editor-foot" role="group" aria-label="Remove this card">
          <span className="editor-ask">
            {inAnki ? 'Remove it here and in Anki, with its progress?' : 'Remove this card?'}
          </span>
          <button type="button" className="btn" onClick={() => setRemoving(false)}>
            Keep
          </button>
          <button
            type="button"
            className="btn editor-remove"
            disabled={busy}
            onClick={() => void removeCard()}
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="editor-foot">
          {!own && (
            <button
              type="button"
              className="btn btn-quiet editor-remove"
              onClick={() => setRemoving(true)}
            >
              Remove card
            </button>
          )}
          <button type="button" className="btn editor-cancel" onClick={closeEditor}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {own ? 'Add card' : 'Save card'}
          </button>
        </div>
      )}
    </form>
  )
}

function Words({ now, limit }: { now: number; limit: number }) {
  return (
    <span className={now > limit ? 'editor-words is-over num' : 'editor-words num'}>
      {now} of {limit} words
    </span>
  )
}

function Problems({ problems }: { problems: Problem[] }) {
  if (problems.length === 0) return null
  return (
    <span className="editor-problem" role="alert">
      {problems.map((p) => p.message).join(' ')}
    </span>
  )
}

function Field({
  label,
  id,
  words,
  hint,
  problems = [],
  children,
}: {
  label: string
  id: string
  words?: [number, number]
  hint?: string
  problems?: Problem[]
  children: ReactNode
}) {
  return (
    <div className="editor-field">
      <label className="editor-label" htmlFor={id}>
        <span>{label}</span>
        {words && <Words now={words[0]} limit={words[1]} />}
      </label>
      {children}
      {hint && problems.length === 0 && <span className="panel-note">{hint}</span>}
      <Problems problems={problems} />
    </div>
  )
}

/** A short list of one-line inputs. With `onCount` the student can add and take away lines. */
function Parts({
  label,
  hint,
  words,
  values,
  name,
  least = 1,
  add,
  problems,
  onChange,
  onCount,
}: {
  label: string
  hint?: string
  words?: [number, number] | undefined
  values: string[]
  name: (index: number) => string
  least?: number | undefined
  add?: string | undefined
  problems: Problem[]
  onChange: (index: number, value: string) => void
  onCount?: ((values: string[]) => void) | undefined
}) {
  // A gap card that hides nothing yet still shows one line to fill.
  const shown = values.length === 0 && onCount ? [''] : values
  return (
    <div className="editor-field">
      <span className="editor-label">
        <span>{label}</span>
        {words && <Words now={words[0]} limit={words[1]} />}
      </span>
      {shown.map((value, i) => (
        <div key={i} className="editor-part">
          <input
            className="field"
            aria-label={name(i)}
            value={value}
            onChange={(event) =>
              values.length === 0
                ? onCount?.([event.target.value])
                : onChange(i, event.target.value)
            }
          />
          {onCount && shown.length > least && (
            <button
              type="button"
              className="icon-btn"
              aria-label={`Take away: ${name(i)}`}
              onClick={() => onCount(values.filter((_, at) => at !== i))}
            >
              <Icon name="close" size={10} stroke={1.8} />
            </button>
          )}
        </div>
      ))}
      {onCount && add && shown.length < MOST_PARTS && (
        <button
          type="button"
          className="btn btn-quiet editor-add"
          onClick={() => onCount([...shown, ''])}
        >
          <Icon name="plus" size={12} stroke={1.6} />
          {add}
        </button>
      )}
      {hint && problems.length === 0 && <span className="panel-note">{hint}</span>}
      <Problems problems={problems} />
    </div>
  )
}
