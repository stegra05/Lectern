import renderMathInElement from 'katex/contrib/auto-render'
import 'katex/dist/katex.min.css'
import { useEffect, useRef, type ReactNode } from 'react'
import type { Card, Lecture } from '../../../../shared/contract.ts'
import { selectedCards, useStore } from '../../store.ts'
import { lectureColour, plural, two } from '../../lecture.ts'
import { Icon } from '../../ui/Icon.tsx'
import { SlideThumb } from '../SlideThumb.tsx'
import { CardEditor } from './CardEditor.tsx'
import './panels.css'

/** Plain names for the card roles of `design/cards/FIELDS.md`. */
export const ROLE_NAMES: Record<string, string> = {
  definition: 'Definition',
  reverse: 'Reverse',
  contrast: 'Contrast',
  chain: 'Chain',
  'name-two': 'Name two',
  why: 'Why',
  case: 'Case',
  formula: 'Formula',
  code: 'Code',
  diagram: 'Diagram',
  cloze: 'Fill the gap',
  'cloze-list': 'Fill the list',
}

export function roleName(role: string | undefined): string {
  return (role && ROLE_NAMES[role]) || 'Card'
}

/** The cards of the map's selection: a concept, a topic or the whole lecture. */
export function CardsPanel({ close }: { close: ReactNode }) {
  const course = useStore((s) => s.course)
  const view = useStore((s) => s.view)
  const editing = useStore((s) => s.editor !== null)
  const writeCard = useStore((s) => s.writeCard)
  if (!course || view.level !== 'lecture') return null
  if (editing) return <CardEditor close={close} />
  const lecture = course.lectures.find((l) => l.number === view.lecture)
  if (!lecture) return null

  const cards = selectedCards(lecture, view)
  const concept = view.concept
    ? lecture.topics.flatMap((t) => t.concepts).find((c) => c.id === view.concept)
    : undefined
  const topic = concept
    ? lecture.topics.find((t) => t.concepts.some((c) => c.id === concept.id))?.name
    : view.topic !== undefined
      ? lecture.topics[view.topic]?.name
      : undefined
  const name = concept?.name ?? topic ?? lecture.title
  const crumb = concept || topic ? [lecture.title, concept ? topic : null] : ['Whole lecture']

  // The concepts in view: a card of the student's own goes to the first, and the cards that
  // were left out are found by their names.
  const inView = lecture.topics
    .filter((_, i) => view.topic === undefined || i === view.topic)
    .flatMap((t) => t.concepts)
    .filter((c) => !view.concept || c.id === view.concept)
  const names = new Set(inView.map((c) => c.name))
  const dropped = lecture.dropped.filter((d) => names.has(d.concept))

  return (
    <>
      <div className="cards-head">
        <div className="cards-crumb">
          <span className="lec-chip" style={{ background: lectureColour(lecture.number) }}>
            {two(lecture.number)}
          </span>
          <span className="cards-crumb-text">{crumb.filter(Boolean).join(' · ')}</span>
          {close}
        </div>
        <h1 className="cards-title">{name}</h1>
        <p className="panel-note">{summary(cards)}</p>
      </div>
      <div className="cards-body">
        {cards.length > 0 && (
          <ul className="panel-group">
            {cards.map((card) => (
              <CardRow key={card.id} card={card} lecture={lecture} course={course.id} />
            ))}
          </ul>
        )}
        {inView[0] && (
          <button
            type="button"
            className="btn cards-add"
            onClick={() => void writeCard(inView[0]!.id)}
          >
            <Icon name="plus" size={13} stroke={1.6} />
            Add your own card
          </button>
        )}
        {dropped.length > 0 && (
          <section className="cards-dropped" aria-label="Left out">
            <h2 className="panel-h2">Left out</h2>
            <ul className="panel-group">
              {dropped.map((d) => (
                <li key={`${d.concept}-${d.role}-${d.front}`} className="cards-dropped-row">
                  <span className="chip">{roleName(d.role)}</span>
                  <span className="cards-dropped-text">
                    <b>{d.front}</b>
                    <span className="panel-note">{d.problems.join('; ')}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  )
}

function summary(cards: Card[]): string {
  if (cards.length === 0) return 'No cards here'
  const slides = cards.map((c) => c.slide)
  const low = Math.min(...slides)
  const high = Math.max(...slides)
  const from = low === high ? `slide ${low}` : `slides ${low} to ${high}`
  return `${plural(cards.length, 'card')} from ${from}`
}

/** The card's question as plain text. A cloze card is known by its sentence with gaps. */
function questionOf(card: Card): string {
  const html =
    card.fields.Text !== undefined
      ? card.fields.Text.replace(/\{\{c\d+::.*?\}\}/g, '...')
      : (card.fields.Front ?? '')
  return (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').trim()
}

function CardRow({ card, lecture, course }: { card: Card; lecture: Lecture; course: string }) {
  const editCard = useStore((s) => s.editCard)
  const f = card.fields
  const cloze = f.Text !== undefined
  return (
    <li className="cards-row">
      <span className="cards-side">
        <SlideThumb course={course} lecture={lecture.number} slide={card.slide} />
        <span className="chip">{card.own ? 'Yours' : roleName(f.Role)}</span>
      </span>
      <span className="cards-text">
        {/* The fields are the engine's own escaped HTML, as FIELDS.md defines them. */}
        {!cloze && <Tex as="b" className="cards-front" html={f.Front ?? ''} />}
        <Tex
          as="span"
          className="cards-back"
          html={cloze ? clozeAnswer(f.Text ?? '') : answer(f.Back ?? '', f.Slots ?? '')}
        />
      </span>
      <button
        type="button"
        className="icon-btn cards-edit"
        aria-label={`Edit the card: ${questionOf(card)}`}
        onClick={() => void editCard(card)}
      >
        <Icon name="pencil" size={14} stroke={1.4} />
      </button>
    </li>
  )
}

/**
 * A card field's HTML with its TeX typeset, the way Anki's MathJax reads `\( \)` and `\[ \]`.
 * KaTeX is bundled, so nothing is fetched, and a formula takes the colour of the text around it.
 */
function Tex({ as: Tag, className, html }: { as: 'b' | 'span'; className: string; html: string }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = html
    renderMathInElement(ref.current, {
      delimiters: [
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
    })
  }, [html])
  return <Tag ref={ref} className={className} />
}

/** The cloze sentence with every deletion marked as the answer. */
function clozeAnswer(text: string): string {
  return text.replace(/\{\{c\d+::(.*?)\}\}/g, '<mark>$1</mark>')
}

/** The answer, with each list item led by its slot label when the role names its slots. */
function answer(back: string, slots: string): string {
  if (!slots || !back.includes('<li')) return back
  const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html').body
  const labels = [...parse(slots).querySelectorAll('span')].map((s) => s.innerHTML)
  const body = parse(back)
  const items = [...body.querySelectorAll('li')]
  // Chains give the known steps first; only label items one to one.
  if (labels.length !== items.length || labels.some((l) => !l)) return back
  items.forEach((li, i) => {
    li.innerHTML = `<span class="cards-slot">${labels[i]}:</span> ${li.innerHTML}`
  })
  return body.innerHTML
}
