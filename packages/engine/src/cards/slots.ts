/**
 * A card as a student edits it: the slots of its role in plain text, without markup. `toSlots`
 * reads them back out of the stored fields, the reverse of `assemble.ts`; `toDraft` turns them
 * into the draft that the validator checks and `assemble` builds the fields from. Pure.
 */

import type { CardFile } from './assemble.ts'
import { isRole, ROLE_SPECS, type Diagram, type Draft, type Role } from './roles.ts'
import { isYesNo, LIMITS } from './validate.ts'
import { CLOZE, words } from './words.ts'

export interface Slots {
  role: Role
  /** The question. For a gap card the whole sentence with nothing hidden, for a list its lead-in. */
  front: string
  /** `key` is the key term of the answer, a part of `text`. Empty when the answer marks none. */
  answers: { text: string; key: string }[]
  /** The names of the slots, for the roles that name them: the two sides of a contrast. */
  labels: string[]
  /** Gap card: the parts of the sentence that are hidden, in the order they stand in it. */
  hidden: string[]
  extra: string
  code: string
}

/** What a student can add: a question with a one-sentence answer, or a sentence with gaps. */
export const OWN_ROLES = ['definition', 'cloze'] as const satisfies readonly Role[]

export function blankSlots(role: (typeof OWN_ROLES)[number]): Slots {
  const answers = role === 'definition' ? [{ text: '', key: '' }] : []
  return { role, front: '', answers, labels: [], hidden: [], extra: '', code: '' }
}

/** The word limits a form shows next to its fields. */
export const FORM_LIMITS = {
  front: LIMITS.frontWords,
  answer: LIMITS.answerWords,
  extra: LIMITS.extraWords,
  gapSentence: LIMITS.clozeWords,
} as const

const unescape = (html: string) =>
  html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** Field HTML back to the text it was made from: `<sub>` and `<sup>` stay, nothing is marked. */
function plain(html: string): string {
  return unescape(html.replace(/<\/?mark>/g, ''))
}

/** One answer out of its field HTML: its text and the term the field marks in it. */
function answerOf(html: string, markWhole: boolean): Slots['answers'][number] {
  const marked = /<mark>(.*?)<\/mark>/.exec(html)
  // Where an unmarked answer is the key term as a whole, the mark around all of it says nothing.
  const whole = markWhole && marked !== null && marked[0] === html
  return { text: plain(html), key: marked && !whole ? unescape(marked[1]!) : '' }
}

const items = (html: string) => [...html.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => m[1]!)

export function toSlots(card: CardFile): Slots {
  const f = card.fields
  const role = f.Role ?? ''
  if (!isRole(role)) throw new Error(`Card ${card.id} has the unknown role "${role}"`)
  const spec = ROLE_SPECS[role]
  const slots: Slots = {
    role,
    front: plain(f.Front ?? ''),
    answers: [],
    labels: [...(f.Slots ?? '').matchAll(/<span>(.*?)<\/span>/g)]
      .map((m) => plain(m[1]!))
      .filter((label) => label !== ''),
    hidden: [],
    extra: plain(f.Extra ?? ''),
    code: unescape(f.Code ?? ''),
  }
  const back = f.Back ?? ''
  const text = f.Text ?? ''
  if (role === 'cloze') {
    slots.hidden = [...text.matchAll(CLOZE)].map((m) => plain(m[2]!))
    slots.front = plain(text.replace(CLOZE, '$2'))
  } else if (role === 'cloze-list') {
    slots.front = plain(text.replace(/<ul>.*$/s, ''))
    slots.answers = items(text).map((item) => ({ text: plain(item.replace(CLOZE, '$2')), key: '' }))
  } else if (spec.back === 'formula') {
    const [, tex = '', condition = ''] = /^\\\[ (.*?) \\\] (.*)$/s.exec(back) ?? []
    slots.answers = [{ text: unescape(tex), key: '' }, answerOf(condition, false)]
  } else if (back.startsWith('<ul>')) {
    slots.answers = items(back).map((item) => answerOf(item, spec.markWhole))
  } else {
    slots.answers = [answerOf(back, spec.markWhole)]
  }
  return slots
}

export interface Problem {
  /** The field of the form the problem is about. `card` when it is about the card as a whole. */
  field: 'front' | 'answer' | 'key' | 'label' | 'hidden' | 'extra' | 'code' | 'card'
  message: string
}

const over = (count: number, limit: number) => `It has ${count} words. The limit is ${limit}.`

/** What a student has to fix before the card can be taken, said for the form. */
export function checkSlots(slots: Slots): Problem[] {
  const problems: Problem[] = []
  const spec = ROLE_SPECS[slots.role]
  const front = slots.front.trim()
  const gap = slots.role === 'cloze'

  if (front === '') {
    problems.push({ field: 'front', message: gap ? 'Write the sentence.' : 'Write the question.' })
  } else if (gap) {
    if (words(front) > LIMITS.clozeWords) {
      problems.push({ field: 'front', message: over(words(front), LIMITS.clozeWords) })
    }
  } else if (spec.note === 'qa') {
    if (words(front) > LIMITS.frontWords) {
      problems.push({ field: 'front', message: over(words(front), LIMITS.frontWords) })
    }
    if (isYesNo(front)) {
      problems.push({
        field: 'front',
        message:
          'A question that yes or no can answer teaches little. Ask what, which, why or how.',
      })
    }
  }

  if (slots.answers.some((answer) => answer.text.trim() === '')) {
    problems.push({
      field: 'answer',
      message: slots.answers.length > 1 ? 'Fill in every answer.' : 'Write the answer.',
    })
  }
  if (spec.note === 'qa') {
    const spoken = spec.back === 'formula' ? slots.answers.slice(1) : slots.answers
    const total = spoken.reduce((sum, answer) => sum + words(answer.text), 0)
    if (total > LIMITS.answerWords) {
      problems.push({ field: 'answer', message: over(total, LIMITS.answerWords) })
    }
  }
  const first = slots.answers[0]
  if (first && first.key.trim() !== '' && !first.text.includes(first.key.trim())) {
    problems.push({
      field: 'key',
      message: 'The key term must be a part of the answer, word for word.',
    })
  } else if (spec.markRequired && first && first.key.trim() === '') {
    problems.push({
      field: 'key',
      message: 'Name the key term: the words of the answer to remember.',
    })
  }

  if (slots.labels.some((label) => label.trim() === '')) {
    problems.push({ field: 'label', message: 'Name every side.' })
  } else if (slots.labels.some((label) => words(label) > LIMITS.slotWords)) {
    problems.push({ field: 'label', message: `A name has at most ${LIMITS.slotWords} words.` })
  }

  if (gap) {
    const hidden = slots.hidden.map((part) => part.trim())
    if (hidden.length === 0 || hidden.some((part) => part === '')) {
      problems.push({ field: 'hidden', message: 'Say which words of the sentence to hide.' })
    } else if (hidden.length > LIMITS.deletions) {
      problems.push({ field: 'hidden', message: `Hide at most ${LIMITS.deletions} parts.` })
    } else if (hidden.some((part) => words(part) > LIMITS.deletionWords)) {
      problems.push({
        field: 'hidden',
        message: `A hidden part has at most ${LIMITS.deletionWords} words.`,
      })
    } else if (gapSentence(front, hidden) === null) {
      problems.push({
        field: 'hidden',
        message: 'Each hidden part must stand in the sentence, word for word and in this order.',
      })
    }
  }

  if (words(slots.extra) > LIMITS.extraWords) {
    problems.push({ field: 'extra', message: over(words(slots.extra), LIMITS.extraWords) })
  }
  return problems
}

/** The sentence with each hidden part wrapped as a deletion, or null when a part is not in it. */
function gapSentence(sentence: string, hidden: string[]): string | null {
  let out = ''
  let rest = sentence
  for (const [i, part] of hidden.entries()) {
    const at = rest.indexOf(part)
    if (at < 0) return null
    out += `${rest.slice(0, at)}{{c${i + 1}::${part}}}`
    rest = rest.slice(at + part.length)
  }
  return out + rest
}

/** The draft of the slots, for the validator and for `assemble`. Run `checkSlots` first. */
export function toDraft(
  slots: Slots,
  card: { concept: string; slide: number; diagram: Diagram | null },
): Draft {
  const hidden = slots.hidden.map((part) => part.trim())
  const front = slots.front.trim()
  return {
    concept: card.concept,
    role: slots.role,
    slide: card.slide,
    front: slots.role === 'cloze' ? (gapSentence(front, hidden) ?? front) : front,
    answers: slots.answers.map(({ text, key }) => {
      const answer = text.trim()
      const term = key.trim()
      return term !== '' && answer.includes(term) ? answer.replace(term, `==${term}==`) : answer
    }),
    labels: slots.labels.map((label) => label.trim()),
    extra: slots.extra.trim(),
    code: slots.code,
    diagram: card.diagram,
  }
}
