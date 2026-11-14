/**
 * The card rules as pure functions. A draft goes in, a list of problems comes out. Each
 * problem is one sentence the model can act on, so a rejection doubles as the feedback.
 * An empty list means the draft may become a card.
 */

import { CLOZE, contentWords, words } from './words.ts'
import { isRole, ROLES, ROLE_SPECS, type Draft } from './roles.ts'

export const LIMITS = {
  frontWords: 20,
  answerWords: 25,
  bullets: 2,
  extraWords: 40,
  termWords: 5,
  clozeWords: 45,
  deletions: 5,
  deletionWords: 8,
  slotWords: 4,
} as const

/**
 * Openers that make a question answerable with yes or no, English and German.
 * "was" is left out on purpose: in German it means "what".
 */
const YES_NO = new Set(
  (
    'is are were do does did can could should would will has have had ' +
    'ist sind war waren kann können hat haben wird werden gibt darf muss soll sollte'
  ).split(' '),
)

export function isYesNo(front: string): boolean {
  const first = front.trim().split(/\s+/)[0] ?? ''
  return YES_NO.has(first.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
}

/** What the validator needs to know about where the card comes from. */
export interface Source {
  /** The slides of the card's concept. */
  slides: number[]
  /** The text of one slide, 1-based. Undefined when the slide does not exist. */
  slideText: (slide: number) => string | undefined
}

export function validateDraft(draft: Draft, source: Source): string[] {
  if (!isRole(draft.role)) {
    return [`role "${draft.role}" does not exist; use one of: ${ROLES.join(', ')}`]
  }
  const spec = ROLE_SPECS[draft.role]
  const problems: string[] = []
  const front = draft.front.trim()
  const answers = draft.answers.map((a) => a.trim())
  const labels = draft.labels.map((l) => l.trim())

  if (front === '') problems.push('front is empty')
  problems.push(...count('answers', answers, spec.answers), ...count('labels', labels, spec.labels))
  if (answers.some((a) => a === '')) problems.push('an answer is empty')
  if (labels.some((l) => l === '')) problems.push('a label is empty')

  // Formula TeX is checked on its own; everything else is prose the model must keep plain.
  const prose = [
    front,
    ...labels,
    draft.extra,
    ...(spec.back === 'formula' ? answers.slice(1) : answers),
  ]
  problems.push(...plainText(prose))

  if (spec.note === 'cloze') {
    problems.push(...(draft.role === 'cloze' ? clozeSentence(front) : clozeList(front, answers)))
  } else {
    problems.push(...question(front), ...answer(draft, answers, labels))
  }

  if (words(draft.extra) > LIMITS.extraWords) {
    problems.push(`extra has ${words(draft.extra)} words; the limit is ${LIMITS.extraWords}`)
  }
  problems.push(...provenance(draft, answers, source))
  return problems
}

function count(slot: string, values: string[], [min, max]: readonly [number, number]): string[] {
  if (values.length >= min && values.length <= max) return []
  const wanted = max === 0 ? 'none' : min === max ? `exactly ${min}` : `${min} to ${max}`
  return [`this role takes ${wanted} ${slot}, got ${values.length}`]
}

/** The model writes plain text. Code adds all markup, so markup from the model is a mistake. */
function plainText(texts: string[]): string[] {
  const problems: string[] = []
  const all = texts.join('\n')
  if (texts.some((t) => /[\r\n]/.test(t.trim())))
    problems.push('no line breaks; one slot holds one line')
  if (/<\/?(?!su[bp]>)[a-zA-Z][^>]*>/.test(all))
    problems.push('no HTML tags except <sub> and <sup>')
  if (/\*\*/.test(all)) problems.push('no Markdown; mark the key term as ==term==')
  if (/\$[^$\n]*[\\^_{}][^$\n]*\$/.test(all))
    problems.push('write inline maths as \\( \\), not with $')
  return problems
}

function question(front: string): string[] {
  const problems: string[] = []
  if (words(front) > LIMITS.frontWords) {
    problems.push(`front has ${words(front)} words; the limit is ${LIMITS.frontWords}`)
  }
  if (isYesNo(front)) problems.push('front is a yes/no question; ask what, which, why or how')
  if (/\{\{c\d+::/.test(front))
    problems.push('cloze deletions belong to the roles cloze and cloze-list')
  return problems
}

function answer(draft: Draft, answers: string[], labels: string[]): string[] {
  const spec = ROLE_SPECS[draft.role as keyof typeof ROLE_SPECS]
  const problems: string[] = []
  const spoken = spec.back === 'formula' ? answers.slice(1) : answers
  const total = spoken.reduce((sum, a) => sum + words(a), 0)
  if (total > LIMITS.answerWords) {
    problems.push(`the answer has ${total} words; the limit is ${LIMITS.answerWords}`)
  }
  if (spec.back === 'list' && answers.length > LIMITS.bullets) {
    problems.push(`the answer has ${answers.length} bullets; the limit is ${LIMITS.bullets}`)
  }
  if (spec.back === 'term' && words(answers[0] ?? '') > LIMITS.termWords) {
    problems.push(`the answer must be one term of at most ${LIMITS.termWords} words`)
  }
  if (spec.back === 'formula' && /\\\[|\\\(|\$/.test(answers[0] ?? '')) {
    problems.push('write the formula as bare TeX, without delimiters')
  }
  for (const a of spoken) {
    const marks = a.match(/==/g)?.length ?? 0
    if (marks % 2 === 1 || marks > 2)
      problems.push('mark at most one key term per answer, as ==term==')
  }
  if (spec.markRequired && !/==[^=]+==/.test(answers[0] ?? '')) {
    problems.push('wrap the key term of the answer as ==term==')
  }
  if (labels.some((l) => words(l) > LIMITS.slotWords)) {
    problems.push(`a label has more than ${LIMITS.slotWords} words`)
  }
  return problems
}

function clozeSentence(text: string): string[] {
  const problems: string[] = []
  const deletions = [...text.matchAll(CLOZE)].map((m) => ({ n: Number(m[1]), text: m[2]!.trim() }))
  const rest = text.replace(CLOZE, ' ')
  if (deletions.length === 0) return ['a cloze needs at least one deletion written as {{c1::item}}']
  if (/\{\{|\}\}/.test(rest)) problems.push('a deletion is not closed properly; write {{c1::item}}')
  if (deletions.length > LIMITS.deletions) {
    problems.push(`the cloze has ${deletions.length} deletions; the limit is ${LIMITS.deletions}`)
  }
  const numbers = deletions.map((d) => d.n).sort((a, b) => a - b)
  if (numbers.some((n, i) => n !== i + 1)) {
    problems.push('number the deletions c1, c2, c3 in order and use each number once')
  }
  for (const d of deletions) {
    if (d.text === '') problems.push('a deletion is empty')
    if (d.text.includes('::')) problems.push('no hints inside a deletion; write {{c1::item}}')
    if (words(d.text) > LIMITS.deletionWords) {
      problems.push(`the deletion "${d.text}" has more than ${LIMITS.deletionWords} words`)
    }
  }
  if (words(rest) < 3) problems.push('the sentence around the deletions is too short to be a cue')
  if (words(text) > LIMITS.clozeWords) {
    problems.push(`the cloze has ${words(text)} words; the limit is ${LIMITS.clozeWords}`)
  }
  return problems
}

function clozeList(lead: string, items: string[]): string[] {
  const problems: string[] = []
  if (words(lead) > LIMITS.frontWords) {
    problems.push(`the lead-in has ${words(lead)} words; the limit is ${LIMITS.frontWords}`)
  }
  if (/\{\{|\}\}/.test([lead, ...items].join(' '))) {
    problems.push('write the list items as plain text; code adds the deletions')
  }
  for (const item of items) {
    if (words(item) > LIMITS.deletionWords) {
      problems.push(`the item "${item}" has more than ${LIMITS.deletionWords} words`)
    }
  }
  return problems
}

/** The card must come from a slide of its concept, and its answer must be found there. */
function provenance(draft: Draft, answers: string[], source: Source): string[] {
  if (!source.slides.includes(draft.slide)) {
    return [
      `slide ${draft.slide} is not a slide of this concept; use one of: ${source.slides.join(', ')}`,
    ]
  }
  if (draft.role === 'formula') return []
  const hidden =
    draft.role === 'cloze' ? [...draft.front.matchAll(CLOZE)].map((m) => m[2]!) : answers
  const terms = contentWords(hidden.join(' '))
  const slide = (source.slideText(draft.slide) ?? '').toLowerCase()
  if (terms.length > 0 && !terms.some((t) => slide.includes(t.slice(0, 5)))) {
    return [`no term of the answer appears on slide ${draft.slide}; answer from the slide text`]
  }
  return []
}
