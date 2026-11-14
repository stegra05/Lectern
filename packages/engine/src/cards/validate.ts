/**
 * The card rules as pure functions. A draft goes in, a list of problems comes out. Each
 * problem is one sentence the model can act on, so a rejection doubles as the feedback.
 * An empty list means the draft may become a card.
 */

import { CLOZE, contentWords, words } from './words.ts'
import {
  DIAGRAM_TYPES,
  isRole,
  ROLES,
  ROLE_SPECS,
  type Diagram,
  type Draft,
  type RoleSpec,
} from './roles.ts'

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
  diagramAxis: 4,
  diagramSteps: 8,
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
  if (draft.role === 'diagram') {
    problems.push(
      ...(draft.diagram
        ? validateDiagram(draft.diagram)
        : ['a diagram card needs the diagram slot']),
    )
  } else if (draft.diagram) {
    problems.push('only the role diagram takes a diagram; leave the slot null')
  }
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

/** The shape of a drawing: a known type, the right number of cells, short labels, a marked answer. */
export function validateDiagram(diagram: Diagram): string[] {
  if (!(DIAGRAM_TYPES as readonly string[]).includes(diagram.type)) {
    return [
      `diagram type "${diagram.type}" does not exist; use one of: ${DIAGRAM_TYPES.join(', ')}`,
    ]
  }
  const problems: string[] = []
  const { columns, rows, cells, key } = diagram
  if (diagram.type === 'matrix') {
    const fits = (axis: string[]) => axis.length >= 1 && axis.length <= LIMITS.diagramAxis
    if (!fits(columns) || !fits(rows)) {
      problems.push(
        `a matrix takes 1 to ${LIMITS.diagramAxis} column labels and 1 to ${LIMITS.diagramAxis} row labels`,
      )
    } else if (cells.length !== columns.length * rows.length) {
      problems.push(
        `a matrix of ${rows.length} rows and ${columns.length} columns takes ${rows.length * columns.length} cells, got ${cells.length}`,
      )
    }
  } else {
    if (columns.length > 0 || rows.length > 0)
      problems.push(`a ${diagram.type} has no column or row labels`)
    if (cells.length < 2 || cells.length > LIMITS.diagramSteps) {
      problems.push(
        `a ${diagram.type} takes 2 to ${LIMITS.diagramSteps} steps, got ${cells.length}`,
      )
    }
  }
  const labels = [...columns, ...rows, ...cells].map((l) => l.trim())
  if (labels.some((l) => l === '')) problems.push('a label of the diagram is empty')
  if (labels.some((l) => words(l) > LIMITS.slotWords)) {
    problems.push(`a label of the diagram has more than ${LIMITS.slotWords} words`)
  }
  const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < cells.length
  if (key.length === 0 || !key.every(valid) || new Set(key).size !== key.length) {
    problems.push(
      'key lists the cells that answer the question: at least one index into cells, each once',
    )
  }
  return problems
}

/**
 * The free check of a card against its slide: true when at least half of the terms of the
 * answer are found in the slide text. False means "not sure", and the card goes to the
 * checking port. Formulas and slides the model saw as a picture are never settled by text.
 */
export function groundedByRule(draft: Draft, slideText: string): boolean {
  if (draft.role === 'formula') return false
  const hidden =
    draft.role === 'cloze' ? [...draft.front.matchAll(CLOZE)].map((m) => m[2]!) : draft.answers
  const terms = contentWords(hidden.join(' '))
  const slide = slideText.toLowerCase()
  const found = terms.filter((t) => slide.includes(t.slice(0, 5))).length
  return terms.length > 0 && found * 2 >= terms.length
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

/** A sentence that repeats this many slide words in a row is copied, not reworded. */
export const COPY_RUN = 8

/**
 * The longest run of words a card's sentence takes over from the slide, word for word.
 * Only sentences count: terms and list items are meant to appear exactly as on the slide.
 */
export function copiedRun(draft: Draft, slideText: string): number {
  const sentence =
    draft.role === 'definition' || draft.role === 'diagram' || draft.role === 'why'
      ? draft.answers.join(' ')
      : draft.role === 'formula'
        ? (draft.answers[1] ?? '')
        : draft.role === 'cloze'
          ? draft.front.replace(CLOZE, '$2')
          : ''
  const norm = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const a = norm(sentence.replace(/==/g, ''))
  const slide = ` ${norm(slideText).join(' ')} `
  let longest = 0
  for (let start = 0; start < a.length; start++) {
    let end = start + longest + 1
    while (end <= a.length && slide.includes(` ${a.slice(start, end).join(' ')} `)) end++
    longest = Math.max(longest, end - 1 - start)
  }
  return longest
}
