#!/usr/bin/env node
/**
 * The blind comparison of a run against the reference deck (RFD 14). No model is called.
 *
 *   node eval/blind.ts draw <eval folder> <sample file> <key file> [--size 60] [--seed N]
 *   node eval/blind.ts score <filled sample file> <key file>
 *
 * `draw` reads an eval folder of `refdeck.ts` that holds `cards.json`, `reference.json` and the
 * judged `labels/`. A reference note the judge labelled `same` or `partial` names a run card, and
 * that card's concept is a concept both decks have. The sample draws one such (note, card) pair
 * per concept, so both cards test the same fact as far as the judge's label holds. It shows only front and back, hides which is which and numbers the pairs. The key
 * (kept apart) says which side is Lectern's, and holds the seed. In the filled sample each pair
 * has two lines: `Lectern is:` A, B or ? (cannot tell), and `Prefer:` A, B or = (no preference).
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ROLES } from '../src/cards/roles.ts'

interface Card {
  id: string
  question: string
  answer: string
}

interface Note extends Omit<Card, 'id'> {
  id: number
}

interface Label {
  id: number
  match: 'same' | 'partial' | 'none'
  card?: string | null
  cards?: string[]
}

interface Key {
  seed: number
  pairs: { pair: number; concept: string; lectern: 'A' | 'B'; card: string; note: number }[]
}

const SIDES = ['A', 'B'] as const
const ROLE_AND_COUNT = new RegExp(`-(${ROLES.join('|')})-\\d+$`)

/** The lecture and concept of a card id (`02-bird-in-hand-definition-1`): `02-bird-in-hand`. */
const conceptOf = (cardId: string) => cardId.replace(ROLE_AND_COUNT, '')

/** A small seeded generator (mulberry32), so one seed draws one sample. */
function generator(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}

function shuffled<T>(list: T[], random: () => number): T[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}

const pick = <T>(list: T[], random: () => number): T => list[Math.floor(random() * list.length)]!

const json = async <T>(path: string) => JSON.parse(await readFile(path, 'utf8')) as T

async function draw(
  folder: string,
  samplePath: string,
  keyPath: string,
  size: number,
  seed: number,
) {
  const cards = await json<Card[]>(join(folder, 'cards.json'))
  const notes = await json<Note[]>(join(folder, 'reference.json'))
  const labels: Label[] = []
  for (const name of (await readdir(join(folder, 'labels'))).filter((n) => n.endsWith('.json')))
    labels.push(...(await json<Label[]>(join(folder, 'labels', name))))

  const cardOf = new Map(cards.map((card) => [card.id, card]))
  const noteIds = new Map(notes.map((note) => [note.id, note]))
  // The (note, card) pairs the judge matched, by concept.
  const matched = new Map<string, { note: Note; card: Card }[]>()
  for (const label of labels) {
    const cardId = label.match === 'none' ? null : (label.card ?? label.cards?.[0])
    const note = noteIds.get(label.id)
    const card = cardId ? cardOf.get(cardId) : undefined
    if (!card || !note) continue
    const concept = conceptOf(card.id)
    matched.set(concept, [...(matched.get(concept) ?? []), { note, card }])
  }

  // Lectures in random order, one concept from each in turn, until the sample is full.
  const random = generator(seed)
  const byLecture = new Map<string, string[]>()
  for (const concept of [...matched.keys()].sort())
    byLecture.set(concept.slice(0, 2), [...(byLecture.get(concept.slice(0, 2)) ?? []), concept])
  const lectures = shuffled([...byLecture.values()], random)
  const concepts: string[] = []
  while (concepts.length < size && lectures.some((l) => l.length > 0))
    for (const lecture of lectures) {
      if (lecture.length === 0 || concepts.length >= size) continue
      concepts.push(...lecture.splice(Math.floor(random() * lecture.length), 1))
    }

  const key: Key = { seed, pairs: [] }
  const text: string[] = []
  concepts.forEach((concept, i) => {
    const { note, card } = pick(matched.get(concept)!, random)
    const lectern = pick([...SIDES], random)
    const shown = lectern === 'A' ? [card, note] : [note, card]
    key.pairs.push({ pair: i + 1, concept, lectern, card: card.id, note: note.id })
    text.push(`Pair ${i + 1}`, '')
    SIDES.forEach((side, s) =>
      text.push(`${side}`, `  Front: ${shown[s]!.question}`, `  Back: ${shown[s]!.answer}`, ''),
    )
    text.push('Lectern is:', 'Prefer:', '', '')
  })

  const intro = [
    'Blind comparison: two cards on the same concept, one from Lectern and one from the reference deck.',
    'After "Lectern is:" write A, B or ? (cannot tell). After "Prefer:" write A, B or = (no preference).',
    '',
    '',
  ]
  await mkdir(dirname(samplePath), { recursive: true })
  await mkdir(dirname(keyPath), { recursive: true })
  await writeFile(samplePath, [...intro, ...text].join('\n'))
  await writeFile(keyPath, `${JSON.stringify(key, null, 1)}\n`)
  console.log(
    `${key.pairs.length} pairs drawn from ${matched.size} concepts matched in both decks, seed ${seed}`,
  )
}

async function score(samplePath: string, keyPath: string) {
  const key = await json<Key>(keyPath)
  const sheet = (await readFile(samplePath, 'utf8')).split(/^Pair (\d+)$/m)
  let answered = 0
  let toldApart = 0
  const preferred = { lectern: 0, reference: 0, none: 0 }
  for (let i = 1; i < sheet.length; i += 2) {
    const number = Number(sheet[i])
    const pair = key.pairs.find((p) => p.pair === number)
    if (!pair) throw new Error(`Pair ${number} is not in the key.`)
    const line = (label: string) =>
      sheet[i + 1]!.match(new RegExp(`^${label}[ \\t]*(.*)$`, 'm'))?.[1]
        ?.trim()
        .toUpperCase() ?? ''
    const [guess, prefer] = [line('Lectern is:'), line('Prefer:')]
    if (guess === '' || prefer === '') continue
    if (!/^[AB?]$/.test(guess) || !/^[AB=]$/.test(prefer))
      throw new Error(`Pair ${number}: "Lectern is" takes A, B or ?; "Prefer" takes A, B or =.`)
    answered++
    if (guess === pair.lectern) toldApart++
    if (prefer === '=') preferred.none++
    else if (prefer === pair.lectern) preferred.lectern++
    else preferred.reference++
  }
  const share = (part: number) =>
    answered === 0 ? '-' : `${part} of ${answered} (${Math.round((100 * part) / answered)}%)`
  console.log(`Pairs answered: ${answered} of ${key.pairs.length}`)
  console.log(`Told apart: ${share(toldApart)}`)
  console.log(`Lectern's preferred: ${share(preferred.lectern)}`)
  console.log(`Reference preferred: ${share(preferred.reference)}`)
  console.log(`No preference: ${share(preferred.none)}`)
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { size: { type: 'string' }, seed: { type: 'string' } },
})
const [step, ...rest] = positionals
const size = Number(values.size ?? 60)
const seed = Number(values.seed ?? Math.floor(Math.random() * 2 ** 32))
if (!Number.isInteger(size) || size < 1) throw new Error('--size is a whole number above zero.')
if (!Number.isInteger(seed)) throw new Error('--seed is a whole number.')

if (step === 'draw' && rest.length === 3)
  await draw(resolve(rest[0]!), resolve(rest[1]!), resolve(rest[2]!), size, seed)
else if (step === 'score' && rest.length === 2) await score(resolve(rest[0]!), resolve(rest[1]!))
else {
  console.error(
    'Usage: blind draw <eval folder> <sample file> <key file> [--size 60] [--seed N] | score <filled sample> <key file>',
  )
  process.exit(2)
}
