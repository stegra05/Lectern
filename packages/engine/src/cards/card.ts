/**
 * A card as the `cards.yaml` of its lecture stores it: the slots of its role in plain text and
 * where it comes from. No markup: `fields.ts` builds the HTML when a card is sent or shown. Pure.
 */

import type { Slots } from './slots.ts'
import { contentWords, words } from './words.ts'

export interface Card {
  id: string
  /** The student wrote this card. */
  own?: true
  slots: Slots
  lecture: { number: number; title: string }
  /** The concept in the lecture's tree: its id and the one name the course uses for it. */
  concept: { id: string; name: string }
  slide: number
  /** A short quote from the slide. Empty when the answer is not on the slides. */
  excerpt: string
  /** Set for a card that answers a past exam question. */
  exam?: { papers: number; fromSlides: boolean }
}

/** Where a card goes, and the text lines of its slide for the excerpt. */
export interface Placement {
  id: string
  lecture: { number: number; title: string }
  concept: { id: string; name: string }
  slide: number
  slideLines: string[]
  exam?: { papers: number; fromSlides: boolean }
}

const EXCERPT_WORDS = 30

/** The slide line that shares the most terms with the card, as a short quote. */
export function excerpt(lines: string[], about: string): string {
  const stems = contentWords(about).map((w) => w.slice(0, 5))
  const filled = lines.map((l) => l.trim()).filter((l) => l !== '')
  let best = 0
  let bestScore = -1
  filled.forEach((line, i) => {
    const lower = line.toLowerCase()
    const score = stems.filter((s) => lower.includes(s)).length
    if (score > bestScore) [best, bestScore] = [i, score]
  })
  let quote = filled[best] ?? ''
  if (words(quote) < 6 && filled[best + 1]) quote += ` ${filled[best + 1]}`
  return quote.split(/\s+/).slice(0, EXCERPT_WORDS).join(' ')
}

/** The card of checked slots, at its place in the course. */
export function toCard(slots: Slots, place: Placement): Card {
  const { slideLines, exam, ...where } = place
  const tested = slots.role === 'cloze' ? slots.hidden : slots.answers.map((a) => a.text)
  return {
    id: where.id,
    slots,
    lecture: where.lecture,
    concept: where.concept,
    slide: where.slide,
    excerpt: exam?.fromSlides === false ? '' : excerpt(slideLines, tested.join(' ')),
    ...(exam ? { exam } : {}),
  }
}
