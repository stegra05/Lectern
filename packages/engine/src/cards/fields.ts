/**
 * The one place that builds field HTML: a stored card to the fields of
 * `design/cards/FIELDS.md`. Sending a card to Anki and showing it in the app both read these
 * fields. Everything written here (markup, slot labels, deletions, source) is code. Pure.
 */

import type { Card } from './card.ts'
import { ROLE_SPECS } from './roles.ts'
import { gapSentence, keyAt, type Slots } from './slots.ts'
import { escapeHtml, two } from './words.ts'

/** A card with its fields, as the engine hands it to an interface. */
export type ShownCard = Card & { fields: Record<string, string> }

type Answer = Slots['answers'][number]

/** Plain text to field HTML: escaped, `<sub>` and `<sup>` kept. */
function html(text: string): string {
  return escapeHtml(text).replace(/&lt;(\/?su[bp])&gt;/g, '<$1>')
}

/** An answer with its key term marked, where it first stands in the answer as whole words. */
function marked({ text, key }: Answer): string {
  const at = keyAt(text, key)
  if (at < 0) return html(text)
  return `${html(text.slice(0, at))}<mark>${html(key)}</mark>${html(text.slice(at + key.length))}`
}

/** Where an answer without a key term is the term as a whole, all of it is marked. */
function item(answer: Answer, markWhole: boolean): string {
  return markWhole && answer.key === '' ? `<mark>${html(answer.text)}</mark>` : marked(answer)
}

function back({ role, answers }: Slots): string {
  const spec = ROLE_SPECS[role]
  // One reasoning step reads as a sentence; two are a list like any other.
  if (spec.back === 'steps' && answers.length === 1) return marked(answers[0]!)
  switch (spec.back) {
    case 'sentence':
      return marked(answers[0]!)
    case 'term':
      // A term answer without a final full stop.
      return `<mark>${html(answers[0]!.text.replace(/\.$/, '').trim())}</mark>`
    case 'steps':
    case 'list':
      return `<ul>${answers.map((a) => `<li>${item(a, spec.markWhole)}</li>`).join('')}</ul>`
    case 'formula':
      return `\\[ ${escapeHtml(answers[0]!.text)} \\] ${marked(answers[1]!)}`
    case 'none':
      return ''
  }
}

function clozeText(slots: Slots): string {
  if (slots.role === 'cloze') return html(gapSentence(slots.front, slots.hidden, slots.at))
  const items = slots.answers.map((a, i) => `<li>{{c${i + 1}::${marked(a)}}}</li>`).join('')
  return `${html(slots.front)}<ul>${items}</ul>`
}

export function cardFields(card: Card): Record<string, string> {
  const { slots, lecture, slide, exam } = card
  const image = `<img src="l${two(lecture.number)}-s${two(slide)}.png">`
  const provenance = {
    Lecture: two(lecture.number),
    Topic: escapeHtml(lecture.title),
    Source: !exam
      ? `Lecture ${lecture.number}, slide ${slide}`
      : exam.fromSlides
        ? `Lecture ${lecture.number}, slide ${slide}; past exams`
        : 'Past exams; the answer is not on the slides',
    Asked: exam ? `${exam.papers}x` : '',
    Part: '',
    Extra: html(slots.extra),
    Excerpt: escapeHtml(card.excerpt),
    Slide: exam?.fromSlides === false ? '' : image,
    // No renderer yet: a diagram card shows its slide, the fallback of the field contract.
    Diagram: slots.role === 'diagram' ? image : '',
    Key: escapeHtml(card.concept.name),
  }
  if (ROLE_SPECS[slots.role].note === 'cloze') {
    return { Text: clozeText(slots), Role: slots.role, Typed: '', ...provenance }
  }
  const given = slots.labels.map((l) => `<span>${html(l)}</span>`).join('')
  return {
    Front: html(slots.front),
    Back: back(slots),
    Role: slots.role,
    Slots: slots.role === 'chain' ? given + '<span></span>'.repeat(slots.answers.length) : given,
    Code: escapeHtml(slots.code),
    Typed: '',
    ...provenance,
  }
}

export function withFields(card: Card): ShownCard {
  return { ...card, fields: cardFields(card) }
}
