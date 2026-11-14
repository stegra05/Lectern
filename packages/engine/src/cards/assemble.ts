/**
 * From a checked draft to the fields of `design/v3/cards/FIELDS.md`. The model filled the
 * slots; everything written here (markup, slot labels, deletions of a list, typing, source,
 * excerpt) is code. Pure.
 */

import { CLOZE, contentWords, escapeHtml, two, words } from './words.ts'
import { ROLE_SPECS, type Draft, type Role } from './roles.ts'
import { typedField } from './typed.ts'

export interface CardFile {
  id: string
  note: 'qa' | 'cloze'
  lecture: number
  /** Id of the concept in the lecture's tree. */
  concept: string
  slide: number
  fields: Record<string, string>
}

export interface Placement {
  id: string
  lecture: { number: number; title: string }
  concept: { id: string; name: string }
  /** The text lines of the card's slide. */
  slideLines: string[]
}

const EXCERPT_WORDS = 30

/** Plain text from the model to field HTML: escaped, `<sub>`/`<sup>` kept, `==x==` marked. */
function toHtml(text: string): string {
  return escapeHtml(text.trim())
    .replace(/&lt;(\/?su[bp])&gt;/g, '<$1>')
    .replace(/==(.+?)==/g, '<mark>$1</mark>')
}

function back(role: Role, answers: string[]): string {
  const spec = ROLE_SPECS[role]
  switch (spec.back) {
    case 'sentence':
      return toHtml(answers[0]!)
    case 'term':
      return `<mark>${toHtml(term(answers[0]!))}</mark>`
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

export function assemble(draft: Draft, place: Placement): CardFile {
  const role = draft.role as Role
  const spec = ROLE_SPECS[role]
  const answers = draft.answers.map((a) => a.trim())
  const labels = draft.labels.map((l) => l.trim())
  const lecture = place.lecture.number
  const deletions = [...draft.front.matchAll(CLOZE)].map((m) => m[2]!)
  const hidden = role === 'cloze' ? deletions : answers
  const expected = spec.back === 'term' ? [term(answers[0]!)] : hidden

  const shared = {
    Role: role,
    Typed: typedField(role, expected, place.concept.name),
    Lecture: two(lecture),
    Topic: place.lecture.title,
    Source: `Lecture ${lecture}, slide ${draft.slide}`,
    Asked: '',
    Part: '',
    Extra: toHtml(draft.extra),
    Excerpt: escapeHtml(excerpt(place.slideLines, hidden.join(' '))),
    Slide: `<img src="l${two(lecture)}-s${two(draft.slide)}.png">`,
    Diagram: '',
    Key: place.concept.name,
  }
  const { Role: roleField, Typed, ...provenance } = shared
  const fields =
    spec.note === 'cloze'
      ? { Text: clozeText(role, draft.front, answers), Role: roleField, Typed, ...provenance }
      : {
          Front: toHtml(draft.front),
          Back: back(role, answers),
          Role: roleField,
          Slots: slots(role, labels, answers),
          Code: '',
          Typed,
          ...provenance,
        }
  return {
    id: place.id,
    note: spec.note,
    lecture,
    concept: place.concept.id,
    slide: draft.slide,
    fields,
  }
}
