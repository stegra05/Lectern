/**
 * The card rules as pure functions. A draft goes in, a list of problems comes out. Each
 * problem is one sentence the model can act on, so a rejection doubles as the feedback.
 * An empty list means the draft may become a card.
 */

import { CLOZE, contentWords, TAG, wordingKey, words } from './words.ts'
import { isRole, ROLES, ROLE_SPECS, type Draft, type RoleSpec } from './roles.ts'

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
  codeLines: 16,
  codeChars: 60,
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
  /** True when the model saw the slide as a picture, so its text cannot settle what is on it. */
  seenAsImage: (slide: number) => boolean
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
    problems.push(...question(front), ...answer(spec, answers, labels))
  }
  if (words(draft.extra) > LIMITS.extraWords) {
    problems.push(`extra has ${words(draft.extra)} words; the limit is ${LIMITS.extraWords}`)
  }

  if (!source.slides.includes(draft.slide)) {
    problems.push(
      `slide ${draft.slide} is not a slide of this concept; use one of: ${source.slides.join(', ')}`,
    )
  }
  if (draft.role === 'code' && labels.length !== answers.length) {
    problems.push(`give one label per answer: ${labels.length} labels, ${answers.length} answers`)
  }
  problems.push(...listing(draft, source))
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
  if ([...all.matchAll(TAG)].some(([tag]) => !/^<\/?su[bp]>$/.test(tag)))
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

function answer(spec: RoleSpec, answers: string[], labels: string[]): string[] {
  const problems: string[] = []
  const spoken = spec.back === 'formula' ? answers.slice(1) : answers
  const total = spoken.reduce((sum, a) => sum + words(a), 0)
  if (total > LIMITS.answerWords) {
    problems.push(`the answer has ${total} words; the limit is ${LIMITS.answerWords}`)
  }
  if ((spec.back === 'list' || spec.back === 'steps') && answers.length > LIMITS.bullets) {
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

/**
 * Words that point at the teaching material instead of the subject, in English and German.
 * "Session" and "class" count only when nothing follows them, so "the class constructor" and
 * "in class B" are about the subject. On the real runs this free rule found more such questions than the decision model did, with
 * a fifth of its false alarms.
 */
const MATERIAL =
  /\b(?:slides?|folien?|wrap-up)\b|\b(?:the|this|last|previous|next|today[’']?s)\s+(?:lecture\b|(?:session|class)(?=\s*(?:[:,;.?!]|$)))|\blecture[’']s\b|\bin class(?=\s*(?:[:,;.?!]|$))|\btoday[’']?s\s+(?:two\s+)?topics\b|\b(?:der|dieser|letzten?|heutigen?)\s+(?:vorlesung|sitzung)\b/i

/**
 * A question that only makes sense with the slides at hand: "What does slide 16 say", "Last
 * session: ...", "Today's topics:". A drawing is exempt: its back shows the slide.
 */
export function leansOnSlides(draft: Draft): string[] {
  if (draft.role === 'diagram' || !MATERIAL.test(draft.front)) return []
  return [
    'the question refers to the slides or the session; ask about the subject itself, so that the card stands without the slides',
  ]
}

/** A side of a contrast that stands for "the slide does not say", in English and German. */
const NO_VALUE =
  /\b(?:not|nicht)\s+(?:stated|specified|given|mentioned|named|applicable|angegeben|genannt|erwähnt)\b|^(?:none|n\/a|unknown|keine angabe|unbekannt)\b|\bno specific\b/i

/**
 * What a text says, for telling whether an answer adds anything: the first five letters of
 * every content word, so that "buying" meets "buy" forms, and every number.
 */
function stems(text: string): string[] {
  const plain = text.replace(/==/g, '')
  return [
    ...contentWords(plain).map((word) => word.slice(0, 5)),
    ...(plain.match(/\p{N}+/gu) ?? []),
  ]
}

/**
 * A card can keep every limit and still say nothing: the answer stands in the question, a
 * sentence only turns the question around, a side of a contrast repeats its own label. Such
 * cards passed the gate on the real runs of 2026-11-14. The build asks this of what the model
 * wrote, after `validateDraft`. A student's own wording is not held to it.
 */
export function saysNothing(draft: Draft): string[] {
  if (!isRole(draft.role)) return []
  const spec = ROLE_SPECS[draft.role]
  const front = draft.front.trim()
  const answers = draft.answers.map((a) => a.trim())
  const labels = draft.labels.map((l) => l.trim())
  const asked = new Set(stems(front))
  const fresh = (text: string, known: Set<string>) => stems(text).filter((s) => !known.has(s))

  if (spec.back === 'term') {
    const term = wordingKey(answers[0] ?? '')
    if (term !== '' && ` ${wordingKey(front)} `.includes(` ${term} `)) {
      return [`the question already contains its answer "${answers[0]}"; ask without naming it`]
    }
    return []
  }
  if (draft.role === 'contrast') {
    const problems: string[] = []
    if (wordingKey(answers[0] ?? '') === wordingKey(answers[1] ?? '')) {
      problems.push('both sides have the same value; a contrast needs two different values')
    }
    const given = new Set([...asked, ...stems(labels.join(' '))])
    answers.forEach((value, i) => {
      const label = labels[i] ?? ''
      const own = new Set(stems(label))
      if (NO_VALUE.test(value.replace(/==/g, ''))) {
        problems.push(`the side "${label}" has no value; a contrast needs what holds for each side`)
      } else if (stems(value).some((s) => own.has(s)) && fresh(value, given).length === 0) {
        // A value may answer in the words of the question. Repeating its own label says nothing.
        problems.push(
          `the value of "${label}" only repeats its label; say what holds for that side`,
        )
      }
    })
    return problems
  }
  if (draft.role === 'definition' || draft.role === 'why') {
    // The mark shows what to recall. A marked term the question does not name is an answer.
    // Short words have no stems, so a mark made of them is compared as a phrase.
    const marked = /==([^=]+)==/.exec(answers[0] ?? '')?.[1]
    const named = (text: string) =>
      stems(text).length > 0
        ? fresh(text, asked).length === 0
        : ` ${wordingKey(front)} `.includes(` ${wordingKey(text)} `)
    if (marked && !named(marked)) return []
    if (fresh(answers.join(' '), asked).length < 2) {
      return ['the answer only repeats the question; say what the slide adds']
    }
    if (marked) {
      return [
        `"${marked}" is marked but the question already names it; mark the words that answer the question`,
      ]
    }
  }
  return []
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
    if (item.includes('::') && !/\{\{|\}\}/.test(item)) {
      problems.push(
        `the item "${item}" holds "::", which Anki reads as a hint; write it without "::"`,
      )
    }
    if (words(item) > LIMITS.deletionWords) {
      problems.push(`the item "${item}" has more than ${LIMITS.deletionWords} words`)
    }
  }
  return problems
}

/** The listing of a code card: short, and copied from the slide, not invented. */
function listing(draft: Draft, source: Source): string[] {
  const lines = draft.code.split('\n').filter((line) => line.trim() !== '')
  if (draft.role !== 'code')
    return lines.length > 0 ? ['only the role code takes a listing; leave code empty'] : []
  const problems: string[] = []
  if (lines.length === 0) problems.push('a code card needs the listing in the code slot')
  if (lines.length > LIMITS.codeLines) {
    problems.push(`the listing has ${lines.length} lines; the limit is ${LIMITS.codeLines}`)
  }
  if (lines.some((line) => line.length > LIMITS.codeChars)) {
    problems.push(`a line of the listing has more than ${LIMITS.codeChars} characters`)
  }
  const squeeze = (text: string) => text.replace(/\s+/g, '')
  const slide = squeeze(source.slideText(draft.slide) ?? '')
  if (!source.seenAsImage(draft.slide) && lines.some((line) => !slide.includes(squeeze(line)))) {
    problems.push(
      `copy the listing from slide ${draft.slide} line by line; a line is not on the slide`,
    )
  }
  return problems
}

/**
 * True when a draft breaks a length limit of its question or answer. Such a card holds more
 * than one fact, so it is split into atomic cards instead of being shortened.
 */
export function tooLong(draft: Draft): boolean {
  if (!isRole(draft.role)) return false
  const spec = ROLE_SPECS[draft.role]
  const front = draft.front.trim()
  if (draft.role === 'cloze') {
    return words(front) > LIMITS.clozeWords || [...front.matchAll(CLOZE)].length > LIMITS.deletions
  }
  if (draft.role === 'cloze-list') return draft.answers.length > LIMITS.deletions
  const spoken = spec.back === 'formula' ? draft.answers.slice(1) : draft.answers
  const total = spoken.reduce((sum, a) => sum + words(a), 0)
  return (
    words(front) > LIMITS.frontWords ||
    total > LIMITS.answerWords ||
    ((spec.back === 'list' || spec.back === 'steps') && draft.answers.length > LIMITS.bullets)
  )
}
