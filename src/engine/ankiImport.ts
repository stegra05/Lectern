/**
 * Reading a deck back out of Anki.
 *
 * When a lecture is re-run against a deck that already holds cards, those
 * cards are the record of what has been made — not a local session file that
 * would drift the moment someone deletes a card in Anki. So we read them
 * back: `Source` carries the page references Lectern wrote there, which is
 * enough to seed the coverage ledger and the dedupe set.
 *
 * What does not survive a round trip is the concept ids: a re-run builds a
 * fresh concept map with fresh ids. That is fine — coverage seeds through
 * page numbers, which are stable across runs, and `computeCoverageData`
 * already infers concept coverage from page overlap.
 *
 * Imported cards are ballast: they are never edited by the model, never
 * re-sent to Anki, and exist only so the new run knows what not to repeat.
 */

import { AnkiClient, BACK_FIELD_NAMES, FRONT_FIELD_NAMES, type AnkiNoteInfo } from './anki'
import { stripMarkup } from './quality'
import type { Card, NoteKind } from './types'

/** A deck larger than this is imported only in part — announced, never silent. */
export const MAX_IMPORT_CARDS = 2000

/**
 * Anki's search syntax treats `"`, `*`, `_` and `\` as operators even inside
 * a quoted term, so a deck called `Stats_2 "final"` needs them escaped.
 */
export function ankiDeckQuery(deckName: string): string {
  const escaped = deckName.replace(/[\\"*_]/g, (ch) => `\\${ch}`)
  return `deck:"${escaped}"`
}

/**
 * The other half of the Source field: the slide-set name Lectern wrote in
 * front of the page refs ("Machine Learning L2 · pp. 3–5"). It says which
 * document a card came from, which is what makes its page numbers meaningful
 * — page 12 of lecture 2 is not page 12 of lecture 4.
 */
export function parseSourceSetName(source: string): string | undefined {
  const text = stripMarkup(source ?? '')
  if (text === '') return undefined
  // Everything before the separator, or before the page marker when the
  // separator is missing.
  const head = text
    .split('·')[0]
    .replace(/\bpp?\.\s*[\d\s,–—-]+$/, '')
    .trim()
  return head === '' ? undefined : head
}

/**
 * Words that carry no identity. Besides articles, this covers the structural
 * nouns every lecture title shares — "Lecture", "Week", "Chapter". Counting
 * those as evidence would make any two lectures look related, which is the
 * one mistake this comparison must not make.
 */
const SET_NAME_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'of',
  'for',
  'in',
  'on',
  'to',
  'lecture',
  'lectures',
  'vorlesung',
  'lektion',
  'week',
  'woche',
  'chapter',
  'kapitel',
  'part',
  'teil',
  'session',
  'unit',
  'slides',
  'folien',
])

interface SetNameParts {
  /** Non-numeric, meaning-bearing words. */
  words: Set<string>
  /** Numbers, which within a course are the whole distinction. */
  numbers: Set<string>
}

const setNameParts = (value: string): SetNameParts => {
  const words = new Set<string>()
  const numbers = new Set<string>()
  for (const token of value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')) {
    if (token === '' || SET_NAME_STOPWORDS.has(token)) continue
    // "L2" and "Week3" carry their number inside the word.
    const embedded = /^[a-z]*(\d+)$/.exec(token)
    if (embedded) numbers.add(String(Number(embedded[1])))
    else words.add(token)
  }
  return { words, numbers }
}

/** Is `short` a single token spelling out the initials of `long`? The model
 *  abbreviates inconsistently between runs — "ML" one time, "Machine
 *  Learning" the next — and no amount of word overlap sees through that. */
function isInitialismOf(short: Set<string>, long: Set<string>): boolean {
  if (short.size !== 1 || long.size < 2) return false
  const [token] = short
  if (token.length !== long.size) return false
  const letters = [...token].sort().join('')
  const initials = [...long]
    .map((word) => word[0])
    .sort()
    .join('')
  return letters === initials
}

const sameNumbers = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every((n) => b.has(n))

/**
 * Whether two slide-set names plausibly describe the same document.
 *
 * The name is written fresh by the model on every run, so the same PDF can
 * come back as "ML Lecture 2" one time and "Machine Learning Lecture 2" the
 * next; an exact comparison would wrongly disown the deck's own cards.
 *
 * The lecture number does most of the work. Within a course, titles are
 * word-for-word identical apart from that number, so it is the only reliable
 * separator — and it is also the case that matters most, because crediting
 * lecture 4's pages to lecture 2 is what silently steers a run away from
 * real material. Where numbers are absent the comparison falls back to
 * shared words, which is weaker but only risks losing coverage seeding.
 */
export function looksLikeSameSet(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false
  const left = setNameParts(a)
  const right = setNameParts(b)

  const bothNumbered = left.numbers.size > 0 && right.numbers.size > 0
  if (bothNumbered && !sameNumbers(left.numbers, right.numbers)) return false

  // Nothing but a number on one side ("Lecture 2"): the number is the whole
  // of the evidence, so it has to have been there.
  if (left.words.size === 0 || right.words.size === 0) return bothNumbered

  if (isInitialismOf(left.words, right.words) || isInitialismOf(right.words, left.words)) {
    return true
  }

  let shared = 0
  for (const word of left.words) if (right.words.has(word)) shared++

  // A matching number is already strong evidence, so one shared word settles
  // it. Without numbers the words carry the whole decision and must agree.
  if (bothNumbered) return shared > 0
  const smaller = Math.min(left.words.size, right.words.size)
  return smaller <= 2 ? shared === smaller : shared / smaller >= 0.6
}

/**
 * Inverse of `formatPageRefs`: pull page numbers out of a Source field like
 * "Machine Learning L2 · pp. 3–5, 8". Returns [] when the field carries no
 * page reference (a hand-written note, or one synced before Lectern wrote
 * provenance), which costs the card its page coverage but keeps its dedupe.
 */
export function parsePageRefs(source: string): number[] {
  const text = stripMarkup(source ?? '')
  const match = /\bpp?\.\s*([\d\s,–—-]+)/.exec(text)
  if (!match) return []

  const pages = new Set<number>()
  for (const part of match[1].split(',')) {
    const run = /^\s*(\d+)\s*[–—-]\s*(\d+)\s*$/.exec(part)
    if (run) {
      const from = Number(run[1])
      const to = Number(run[2])
      // A malformed or absurd run must not balloon into thousands of pages.
      if (to >= from && to - from <= 500) {
        for (let page = from; page <= to; page++) pages.add(page)
      }
      continue
    }
    const single = /^\s*(\d+)\s*$/.exec(part)
    if (single) pages.add(Number(single[1]))
  }
  return [...pages].filter((p) => p > 0).sort((a, b) => a - b)
}

const fieldValue = (info: AnkiNoteInfo, name: string): string => info.fields?.[name]?.value ?? ''

/** Field names in the note's own order, so localized collections still resolve. */
const orderedFieldNames = (info: AnkiNoteInfo): string[] =>
  Object.entries(info.fields ?? {})
    .sort(([, a], [, b]) => (a?.order ?? 0) - (b?.order ?? 0))
    .map(([name]) => name)

const findField = (names: string[], candidates: Set<string>): string | undefined =>
  names.find((name) => candidates.has(name.trim().toLowerCase()))

/**
 * Rebuild an engine Card from a note. Basic and Cloze are told apart by the
 * note's own field signature (a Front-like field means Basic), with the model
 * name as a tiebreaker — the same structural test `detectBuiltinModels` uses,
 * so non-English collections work too.
 *
 * Returns null for notes with no readable content.
 */
export function noteToCard(info: AnkiNoteInfo): Card | null {
  if (typeof info.noteId !== 'number') return null
  const names = orderedFieldNames(info)
  if (names.length === 0) return null

  const frontName = findField(names, FRONT_FIELD_NAMES)
  const backName = findField(names, BACK_FIELD_NAMES)
  const looksCloze = frontName === undefined || /cloze/i.test(info.modelName ?? '')
  const modelName: NoteKind = looksCloze ? 'Cloze' : 'Basic'

  const fields: Record<string, string> = {}
  if (frontName !== undefined && !looksCloze) {
    fields.Front = fieldValue(info, frontName)
    fields.Back = fieldValue(info, backName ?? names[1] ?? '')
  } else {
    // "Back Extra" is Anki's own name on the Cloze type; the first field is
    // the cloze text whatever it happens to be called.
    fields.Text = fieldValue(info, names[0])
    const extra = fieldValue(info, 'Back Extra')
    if (extra !== '') fields['Back Extra'] = extra
  }

  const primary = fields.Text ?? fields.Front ?? ''
  if (stripMarkup(primary) === '') return null

  const topic = stripMarkup(fieldValue(info, 'Topic'))
  const excerpt = stripMarkup(fieldValue(info, 'Excerpt'))

  return {
    uid: `anki-${info.noteId}`,
    modelName,
    fields,
    slideTopic: topic === '' ? undefined : topic,
    sourcePages: parsePageRefs(fieldValue(info, 'Source')),
    sourceSetName: parseSourceSetName(fieldValue(info, 'Source')),
    // A previous run's concept ids mean nothing to this run's concept map.
    conceptIds: [],
    relationKeys: [],
    sourceExcerpt: excerpt === '' ? undefined : excerpt,
    // These cards already passed the gate once and are not re-judged here.
    qualityScore: 100,
    qualityIssues: [],
    ankiNoteId: info.noteId,
    fromAnki: true,
  }
}

export interface DeckImport {
  cards: Card[]
  /** Notes in the deck, before the cap and before unreadable ones were cut. */
  totalNotes: number
  /** True when `totalNotes` exceeded MAX_IMPORT_CARDS. */
  truncated: boolean
}

/** How many notes sit in a deck — the cheap probe behind the extend toggle. */
export async function countDeckNotes(client: AnkiClient, deckName: string): Promise<number> {
  if (!deckName.trim()) return 0
  const ids = await client.findNotes(ankiDeckQuery(deckName))
  return ids.length
}

/** Read a deck's notes back as engine Cards. */
export async function fetchDeckCards(client: AnkiClient, deckName: string): Promise<DeckImport> {
  if (!deckName.trim()) return { cards: [], totalNotes: 0, truncated: false }

  const ids = await client.findNotes(ankiDeckQuery(deckName))
  const capped = ids.slice(0, MAX_IMPORT_CARDS)
  const infos = await client.notesInfo(capped)

  const cards: Card[] = []
  const seenUids = new Set<string>()
  for (const info of infos) {
    const card = noteToCard(info)
    if (card === null || seenUids.has(card.uid)) continue
    seenUids.add(card.uid)
    cards.push(card)
  }

  return { cards, totalNotes: ids.length, truncated: ids.length > capped.length }
}
