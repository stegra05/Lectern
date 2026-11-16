/**
 * A card's slots: its role's words in plain text, without markup, as `cards.yaml` stores them
 * and a student edits them. `fromDraft` takes them out of what the model wrote, `tidy` out of
 * what a student wrote, and `toDraft` turns them into the draft the validator checks. Pure.
 */

import { ROLE_SPECS, type Draft, type Role } from './roles.ts'
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
  /**
   * Gap card: where each hidden part starts in `front`. The editor hands it back untouched, so a
   * part that stands twice in the sentence stays at the place it had.
   */
  at: number[]
  extra: string
  code: string
}

/** What a student can add: a question with a one-sentence answer, or a sentence with gaps. */
export const OWN_ROLES = ['definition', 'cloze'] as const satisfies readonly Role[]

export function blankSlots(role: (typeof OWN_ROLES)[number]): Slots {
  const answers = role === 'definition' ? [{ text: '', key: '' }] : []
  return { role, front: '', answers, labels: [], hidden: [], at: [], extra: '', code: '' }
}

/** The word limits a form shows next to its fields. */
export const FORM_LIMITS = {
  front: LIMITS.frontWords,
  answer: LIMITS.answerWords,
  extra: LIMITS.extraWords,
  gapSentence: LIMITS.clozeWords,
} as const

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
    } else {
      const placed = placeGaps(slots.front, hidden, slots.at)
      if ('problem' in placed) problems.push({ field: 'hidden', message: placed.problem })
    }
  }

  if (words(slots.extra) > LIMITS.extraWords) {
    problems.push({ field: 'extra', message: over(words(slots.extra), LIMITS.extraWords) })
  }
  return problems
}

const LETTER = /[\p{L}\p{N}]/u

/** A part stands as whole words at `at`: no letter or digit of the sentence touches its edges. */
function standsAlone(sentence: string, part: string, at: number): boolean {
  if (!sentence.startsWith(part, at)) return false
  const before = sentence[at - 1] ?? ''
  const after = sentence[at + part.length] ?? ''
  return (
    !(LETTER.test(part[0]!) && LETTER.test(before)) &&
    !(LETTER.test(part.at(-1)!) && LETTER.test(after))
  )
}

/**
 * Where the key term stands in its answer: the first place it stands as whole words, or else
 * the first place it stands at all. -1 when it is not in the answer.
 */
export function keyAt(text: string, key: string): number {
  if (key === '') return -1
  for (let k = text.indexOf(key); k >= 0; k = text.indexOf(key, k + 1)) {
    if (standsAlone(text, key, k)) return k
  }
  return text.indexOf(key)
}

/**
 * Where each hidden part stands in the sentence, or what the student has to fix. A part is kept
 * where `at` says when it still stands there; otherwise it is the one place after the part
 * before it where it stands as whole words.
 */
function placeGaps(
  sentence: string,
  hidden: string[],
  at: number[],
): { starts: number[] } | { problem: string } {
  const starts: number[] = []
  let from = 0
  for (const [i, part] of hidden.entries()) {
    const kept = at[i]
    let start: number
    if (kept !== undefined && kept >= from && standsAlone(sentence, part, kept)) {
      start = kept
    } else {
      const found: number[] = []
      for (let k = sentence.indexOf(part, from); k >= 0; k = sentence.indexOf(part, k + 1)) {
        if (standsAlone(sentence, part, k)) found.push(k)
      }
      if (found.length > 1) {
        return {
          problem: `"${part}" stands more than once in the sentence. Hide a longer part, with the words next to it, so that it is clear which one.`,
        }
      }
      if (found.length === 0) {
        return {
          problem: 'Each hidden part must stand in the sentence, word for word and in this order.',
        }
      }
      start = found[0]!
    }
    starts.push(start)
    from = start + part.length
  }
  return { starts }
}

/** The sentence with each hidden part wrapped as a deletion. */
export function gapSentence(sentence: string, hidden: string[], starts: number[]): string {
  let out = ''
  let end = 0
  for (const [i, part] of hidden.entries()) {
    out += `${sentence.slice(end, starts[i])}{{c${i + 1}::${part}}}`
    end = starts[i]! + part.length
  }
  return out + sentence.slice(end)
}

/** A mark the stored slots have no place for: its words stay, the `==` around them go. */
const unwrap = (text: string) => text.replace(/==(.+?)==/g, '$1')

/**
 * The slots of a checked draft from the model. The model marks the key term of an answer in
 * the text, as `==term==`, and writes a gap sentence with its deletions, `{{c1::part}}`; here
 * both come out of the text, so nothing in the stored slots is read as markup again. A mark
 * anywhere else (the question or lead-in, a label, the extra, a second mark in one answer) has
 * no place in the slots and is unwrapped.
 */
export function fromDraft(draft: Draft): Slots {
  const role = draft.role as Role
  const spec = ROLE_SPECS[role]
  const slots: Slots = {
    role,
    front: unwrap(draft.front.trim()),
    answers: draft.answers.map((answer, i) => {
      const text = answer.trim()
      // The TeX of a formula is not prose: nothing in it is a mark.
      if (spec.back === 'formula' && i === 0) return { text, key: '' }
      // A term is its answer as a whole.
      if (spec.back === 'term') return { text: unwrap(text), key: '' }
      const mark = /==(.+?)==/.exec(text)
      if (!mark) return { text, key: '' }
      const before = unwrap(text.slice(0, mark.index))
      const plain = before + mark[1]! + unwrap(text.slice(mark.index + mark[0].length))
      // Where an unmarked answer is the key term as a whole, a mark around all of it says nothing.
      return { text: plain, key: spec.markWhole && plain === mark[1] ? '' : mark[1]! }
    }),
    labels: draft.labels.map((label) => unwrap(label.trim())),
    hidden: [],
    at: [],
    extra: unwrap(draft.extra.trim()),
    code: draft.code.replace(/\s+$/, ''),
  }
  if (role === 'cloze') {
    let front = ''
    let end = 0
    for (const m of slots.front.matchAll(CLOZE)) {
      front += slots.front.slice(end, m.index)
      slots.at.push(front.length)
      slots.hidden.push(m[2]!)
      front += m[2]!
      end = m.index + m[0].length
    }
    slots.front = front + slots.front.slice(end)
  }
  return slots
}

/** The slots a student wrote, trimmed, with each hidden part at its place. Run `checkSlots` first. */
export function tidy(slots: Slots): Slots {
  const front = slots.front.trim()
  const hidden = slots.hidden.map((part) => part.trim())
  const placed = placeGaps(front, hidden, slots.at)
  return {
    role: slots.role,
    front,
    answers: slots.answers.map(({ text, key }) => ({ text: text.trim(), key: key.trim() })),
    labels: slots.labels.map((label) => label.trim()),
    hidden,
    at: 'starts' in placed ? placed.starts : [],
    extra: slots.extra.trim(),
    code: slots.code.replace(/\s+$/, ''),
  }
}

/**
 * The draft of tidy slots, for the validator, which reads marks in the text as the model writes
 * them. A `==` the student wrote is left out of it, so only the key term reads as a mark.
 */
export function toDraft(slots: Slots, card: { concept: string; slide: number }): Draft {
  const plain = (text: string) => text.replace(/==/g, '')
  return {
    concept: card.concept,
    role: slots.role,
    slide: card.slide,
    front: slots.role === 'cloze' ? gapSentence(slots.front, slots.hidden, slots.at) : slots.front,
    answers: slots.answers.map(({ text, key }) => {
      const at = keyAt(text, key)
      if (at < 0) return plain(text)
      return `${plain(text.slice(0, at))}==${plain(key)}==${plain(text.slice(at + key.length))}`
    }),
    labels: slots.labels,
    extra: slots.extra,
    code: slots.code,
  }
}
