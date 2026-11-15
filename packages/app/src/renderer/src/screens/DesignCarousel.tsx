import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { Card, CourseView, Design } from '../../../shared/contract.ts'
import { CardFrame } from '../cards/CardFrame.tsx'
import { CARD_DESIGNS, type CardDesign } from '../cards/designs.ts'
import { Icon } from '../ui/Icon.tsx'
import './settings.css'

// A drawn stand-in for the source slide: the interface has no slide pictures in settings.
const SLIDE_THUMB = `<img alt="" src="data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="#fff"/>' +
    '<rect width="160" height="1.6" fill="#1f5fa8"/><rect x="7" y="11" width="92" height="7" rx="1" fill="#1d2433"/>' +
    '<rect x="13" y="28.5" width="80" height="3" rx="1" fill="#9aa1ad"/><rect x="13" y="37.5" width="64" height="3" rx="1" fill="#9aa1ad"/>' +
    '<rect x="13" y="46.5" width="88" height="3" rx="1" fill="#9aa1ad"/></svg>',
)}">`

/**
 * The student's own card for the carousel: a definition from the concept that got the most
 * cards, so the designs are judged on something the course cares about.
 */
function showcase(course: CourseView | null): Card | undefined {
  const cards = course?.lectures.flatMap((l) => l.cards).filter((c) => c.note === 'qa') ?? []
  const perConcept = new Map<string, number>()
  for (const card of cards) perConcept.set(card.concept, (perConcept.get(card.concept) ?? 0) + 1)
  const weight = (card: Card) =>
    (perConcept.get(card.concept) ?? 0) + (card.fields.Role === 'definition' ? 0.5 : 0)
  return cards.reduce<Card | undefined>(
    (best, card) => (!best || weight(card) > weight(best) ? card : best),
    undefined,
  )
}

const SAMPLE: Card = {
  id: 'sample',
  note: 'qa',
  concept: 'risk',
  slide: 14,
  fields: {
    Front: 'Knight (1921): what is risk?',
    Back: 'An outcome whose <mark>probability can be calculated or known</mark>, e.g. opening a hairdresser shop.',
    Role: 'definition',
    Slots: '',
    Code: '',
    Typed: '',
    Lecture: '02',
    Topic: 'Effectuation',
    Source: 'Lecture 2, slide 14',
    Asked: '4',
    Part: 'short answer',
    Extra: 'Knight sets risk against uncertainty, where the probabilities cannot be known.',
    Excerpt: 'Risk: the distribution of outcomes is known.',
    Slide: '',
    Diagram: '',
    Key: 'risk',
  },
}

/** The card the designs are shown on: one from the open course, or the sample. */
export function previewCard(course: CourseView | null): { card: Card; own: boolean } {
  const own = showcase(course)
  const card = own ?? SAMPLE
  return { card: { ...card, fields: { ...card.fields, Slide: SLIDE_THUMB } }, own: Boolean(own) }
}

/** What the carousel shows its card as: "Your card about risk, 02 Effectuation". */
export function aboutCard(course: CourseView | null): string {
  const { card, own } = previewCard(course)
  return `${own ? 'Your card' : 'A sample card'} about ${card.fields.Key}, ${card.fields.Lecture} ${card.fields.Topic}`
}

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

/**
 * The six card designs on one card, front and back, one design at a time with its neighbours
 * peeking in. Used in settings and before the first send.
 */
export function DesignCarousel({
  current,
  course,
  width,
  height,
  action,
  footer,
}: {
  /** The design in use. */
  current: Design
  course: CourseView | null
  /** The size of one card side. */
  width: number
  height: number
  /** What sits beside the name of the design on show, such as the way to take it. */
  action?: (design: CardDesign) => ReactNode
  /** What closes the carousel, for the design on show. */
  footer?: (design: CardDesign) => ReactNode
}) {
  const count = CARD_DESIGNS.length
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      CARD_DESIGNS.findIndex((d) => d.id === current),
    ),
  )
  // Which way the last step went, so the new design slides in from that side.
  const [direction, setDirection] = useState<'next' | 'previous' | null>(null)
  const [night, setNight] = useState(prefersDark)

  const go = (to: number) => {
    const target = (to + count) % count
    if (target === index) return
    setDirection(to > index ? 'next' : 'previous')
    setIndex(target)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable]')) return
      if (event.key === 'ArrowLeft') go(index - 1)
      if (event.key === 'ArrowRight') go(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const design = CARD_DESIGNS[index]!
  const previous = CARD_DESIGNS[(index - 1 + count) % count]!
  const next = CARD_DESIGNS[(index + 1) % count]!
  const { card } = previewCard(course)
  const about = aboutCard(course)

  return (
    <>
      <div className="set-design-head">
        <div className="set-design-about">
          <p className="set-design-title">
            <b id="set-design-name">{design.name}</b>
            <span className="num">
              {index + 1} of {count}
            </span>
          </p>
          <p className="t-secondary">{design.line}</p>
        </div>
        {action?.(design)}
      </div>

      <div
        className="set-carousel"
        style={{ '--card-w': `${width}px`, '--card-h': `${height}px` } as CSSProperties}
        role="group"
        aria-roledescription="carousel"
        aria-label={`Card designs on ${about.charAt(0).toLowerCase()}${about.slice(1)}`}
      >
        <div key={design.id} className="set-stage" data-direction={direction ?? undefined}>
          <div className="set-peek set-peek-previous" aria-hidden="true">
            <CardFrame
              card={card}
              side="back"
              design={previous}
              night={night}
              width={width}
              height={height - 41}
            />
          </div>
          <div className="set-pair">
            <div className="set-side">
              <span className="set-side-label">Front</span>
              <CardFrame
                card={card}
                side="front"
                design={design}
                night={night}
                width={width}
                height={height}
              />
            </div>
            <div className="set-side">
              <span className="set-side-label">Back</span>
              <CardFrame
                card={card}
                side="back"
                design={design}
                night={night}
                width={width}
                height={height}
              />
            </div>
          </div>
          <div className="set-peek set-peek-next" aria-hidden="true">
            <CardFrame
              card={card}
              side="front"
              design={next}
              night={night}
              width={width}
              height={height - 41}
            />
          </div>
        </div>
      </div>

      <div className="set-design-foot">
        <div
          role="group"
          aria-label="Preview in light or night mode"
          className="segmented set-mode"
        >
          <button type="button" aria-pressed={!night} onClick={() => setNight(false)}>
            <Icon name="sun" size={13} stroke={1.4} />
            Light
          </button>
          <button type="button" aria-pressed={night} onClick={() => setNight(true)}>
            <Icon name="moon" size={13} stroke={1.4} />
            Night
          </button>
        </div>
        <div className="set-nav-controls">
          <button
            type="button"
            className="set-arrow"
            aria-label={`Previous design: ${previous.name}`}
            onClick={() => go(index - 1)}
          >
            <Icon name="chevronLeft" size={13} stroke={1.8} />
          </button>
          <div
            role="group"
            aria-label={`Card designs, ${index + 1} of ${count}`}
            className="set-dots"
          >
            {CARD_DESIGNS.map((d, i) => (
              <button
                key={d.id}
                type="button"
                aria-label={d.id === current ? `${d.name}, in use` : d.name}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => go(i)}
              >
                <i />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="set-arrow"
            aria-label={`Next design: ${next.name}`}
            onClick={() => go(index + 1)}
          >
            <Icon name="chevronRight" size={13} stroke={1.8} />
          </button>
        </div>
        <span className="set-which" title={about}>
          {about}
        </span>
      </div>
      {footer?.(design)}
    </>
  )
}
