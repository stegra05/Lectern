import type { ReactNode } from 'react'
import type { Card, Lecture } from '../../../../shared/contract.ts'
import { selectedCards, useStore } from '../../store.ts'
import { lectureColour, plural, two } from '../../lecture.ts'
import { SlideThumb } from '../SlideThumb.tsx'
import './panels.css'

/** Plain names for the card roles of `design/v3/cards/FIELDS.md`. */
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
  diagram: 'Drawing',
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
  if (!course || view.level !== 'lecture') return null
  const lecture = course.lectures.find((l) => l.number === view.lecture)
  if (!lecture) return null

  const cards = selectedCards(lecture, view)
  const concept = view.concept
    ? lecture.topics.flatMap((t) => t.concepts).find((c) => c.id === view.concept)
    : undefined
  const topic = concept
    ? lecture.topics.find((t) => t.concepts.some((c) => c.id === concept.id))?.name
    : view.topic
  const name = concept?.name ?? view.topic ?? lecture.title
  const crumb = concept || view.topic ? [lecture.title, concept ? topic : null] : ['Whole lecture']

  // The concepts in view, to find the cards that were left out of them.
  const names = new Set(
    lecture.topics
      .filter((t) => !view.topic || t.name === view.topic)
      .flatMap((t) => t.concepts)
      .filter((c) => !view.concept || c.id === view.concept)
      .map((c) => c.name),
  )
  const dropped = lecture.dropped.filter((d) => names.has(d.concept))

  // A remark of a check may name another card by its id. The student knows it by its question.
  const questions = new Map(
    course.lectures.flatMap((l) => l.cards).map((card) => [card.id, questionOf(card)]),
  )

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
        {concept?.flags?.map((flag) => (
          <p key={flag} className="panel-note cards-flag">
            Worth a look: {flag}.
          </p>
        ))}
      </div>
      <div className="cards-body">
        {cards.length > 0 && (
          <ul className="panel-group">
            {cards.map((card) => (
              <CardRow
                key={card.id}
                card={card}
                lecture={lecture}
                course={course.id}
                questions={questions}
              />
            ))}
          </ul>
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
    card.note === 'cloze'
      ? (card.fields.Text ?? '').replace(/\{\{c\d+::.*?\}\}/g, '...')
      : (card.fields.Front ?? '')
  return (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').trim()
}

/** A check's remark in the student's words: a card id becomes that card's question. */
function remark(flag: string, questions: Map<string, string>): string {
  return flag.replace(/\b\d{2}-[a-z0-9-]+-\d+\b/, (id) => {
    const question = questions.get(id)
    return question ? `the card "${question}"` : 'another card'
  })
}

function CardRow({
  card,
  lecture,
  course,
  questions,
}: {
  card: Card
  lecture: Lecture
  course: string
  questions: Map<string, string>
}) {
  const f = card.fields
  const cloze = card.note === 'cloze'
  return (
    <li className="cards-row">
      <span className="cards-side">
        <SlideThumb course={course} lecture={lecture.number} slide={card.slide} />
        <span className="chip">{roleName(f.Role)}</span>
      </span>
      <span className="cards-text">
        {/* The fields are the engine's own escaped HTML, as FIELDS.md defines them. */}
        {!cloze && (
          <b className="cards-front" dangerouslySetInnerHTML={{ __html: f.Front ?? '' }} />
        )}
        <span
          className="cards-back"
          dangerouslySetInnerHTML={{
            __html: cloze ? clozeAnswer(f.Text ?? '') : answer(f.Back ?? '', f.Slots ?? ''),
          }}
        />
        {/* What an unmeasured check noticed. The card is kept, the student decides. */}
        {card.flags?.map((flag) => (
          <span key={flag} className="panel-note cards-flag">
            Worth a look: {remark(flag, questions)}.
          </span>
        ))}
      </span>
    </li>
  )
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
