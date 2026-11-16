/**
 * From a checked draft to the fields of `design/cards/FIELDS.md`. The model filled the
 * slots; everything written here (markup, slot labels, deletions of a list, source,
 * excerpt) is code. Pure.
 */

import { excerpt } from './card.ts'
import { CLOZE, escapeHtml, two } from './words.ts'
import { ROLE_SPECS, type Draft, type Role } from './roles.ts'

/** One card as it is stored in the `cards.yaml` of its lecture. */
export interface CardFile {
  id: string
  note: 'qa' | 'cloze'
  /** Id of the concept in the lecture's tree. */
  concept: string
  slide: number
  fields: Record<string, string>
  /** The student wrote this card. */
  own?: true
}

export interface Placement {
  id: string
  lecture: { number: number; title: string }
  concept: { id: string; name: string }
  /** The text lines of the card's slide. */
  slideLines: string[]
  /** Set for a card that answers a past exam question. */
  exam?: { papers: number; fromSlides: boolean }
}

/** Plain text from the model to field HTML: escaped, `<sub>`/`<sup>` kept, `==x==` marked. */
function toHtml(text: string): string {
  return escapeHtml(text.trim())
    .replace(/&lt;(\/?su[bp])&gt;/g, '<$1>')
    .replace(/==(.+?)==/g, '<mark>$1</mark>')
}

function back(role: Role, answers: string[]): string {
  const spec = ROLE_SPECS[role]
  // One reasoning step reads as a sentence; two are a list like any other.
  if (spec.back === 'steps' && answers.length === 1) return toHtml(answers[0]!)
  switch (spec.back) {
    case 'sentence':
      return toHtml(answers[0]!)
    case 'term':
      return `<mark>${toHtml(term(answers[0]!))}</mark>`
    case 'steps':
    case 'list':
      return `<ul>${answers.map((a) => `<li>${item(a, spec.markWhole)}</li>`).join('')}</ul>`
    case 'formula':
      return `\\[ ${escapeHtml(answers[0]!.trim())} \\] ${toHtml(answers[1]!)}`
    case 'none':
      return ''
  }
}

/** A term answer without marks or a final full stop. */
function term(answer: string): string {
  return answer.replace(/==/g, '').trim().replace(/\.$/, '')
}

function item(answer: string, markWhole: boolean): string {
  return markWhole && !answer.includes('==') ? `<mark>${toHtml(answer)}</mark>` : toHtml(answer)
}

function slots(role: Role, labels: string[], answers: string[]): string {
  const given = labels.map((l) => `<span>${toHtml(l)}</span>`).join('')
  return role === 'chain' ? given + '<span></span>'.repeat(answers.length) : given
}

function clozeText(role: Role, front: string, answers: string[]): string {
  if (role === 'cloze') return toHtml(front)
  const items = answers.map((a, i) => `<li>{{c${i + 1}::${toHtml(a)}}}</li>`).join('')
  return `${toHtml(front)}<ul>${items}</ul>`
}

export function assemble(draft: Draft, place: Placement): CardFile {
  const role = draft.role as Role
  const spec = ROLE_SPECS[role]
  const answers = draft.answers.map((a) => a.trim())
  const labels = draft.labels.map((l) => l.trim())
  const lecture = place.lecture.number
  const hidden = role === 'cloze' ? [...draft.front.matchAll(CLOZE)].map((m) => m[2]!) : answers
  const slideImage = `<img src="l${two(lecture)}-s${two(draft.slide)}.png">`
  const provenance = {
    Lecture: two(lecture),
    Topic: escapeHtml(place.lecture.title),
    Source: !place.exam
      ? `Lecture ${lecture}, slide ${draft.slide}`
      : place.exam.fromSlides
        ? `Lecture ${lecture}, slide ${draft.slide}; past exams`
        : 'Past exams; the answer is not on the slides',
    Asked: place.exam ? `${place.exam.papers}x` : '',
    Part: '',
    Extra: toHtml(draft.extra),
    Excerpt:
      place.exam?.fromSlides === false
        ? ''
        : escapeHtml(excerpt(place.slideLines, hidden.join(' '))),
    Slide: place.exam?.fromSlides === false ? '' : slideImage,
    // No renderer yet: a diagram card shows its slide, the fallback of the field contract.
    Diagram: role === 'diagram' ? slideImage : '',
    Key: escapeHtml(place.concept.name),
  }
  const fields =
    spec.note === 'cloze'
      ? { Text: clozeText(role, draft.front, answers), Role: role, Typed: '', ...provenance }
      : {
          Front: toHtml(draft.front),
          Back: back(role, answers),
          Role: role,
          Slots: slots(role, labels, answers),
          Code: escapeHtml(draft.code.replace(/\s+$/, '')),
          Typed: '',
          ...provenance,
        }
  const card: CardFile = {
    id: place.id,
    note: spec.note,
    concept: place.concept.id,
    slide: draft.slide,
    fields,
  }
  return card
}
