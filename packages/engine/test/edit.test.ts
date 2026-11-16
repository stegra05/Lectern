import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { memoryAnki, type MemoryAnki } from '../src/adapters/memory-anki.ts'
import { nodeStore } from '../src/adapters/node-store.ts'
import { offlineDecisions, offlineModel } from '../src/adapters/offline.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import {
  createEngine,
  type CardFile,
  type CourseState,
  type Event,
  type Slots,
} from '../src/api.ts'
import { writeCards } from '../src/course.ts'
import { assemble } from '../src/cards/assemble.ts'
import { toDraft, toSlots } from '../src/cards/slots.ts'
import { SLIDES } from './fixtures.ts'
import { makePdf, tempRoot, templates } from './helpers.ts'

const COURSE = 'entrepreneurship-ws26'
const at = { course: COURSE, lecture: 1 }

let root: string
let anki: MemoryAnki

async function run(command: unknown): Promise<Event[]> {
  const ports = {
    store: nodeStore(root),
    pdf: pdfjsReader,
    model: offlineModel(),
    decisions: offlineDecisions(),
    anki,
    templates,
    now: Date.now,
  }
  const events: Event[] = []
  await createEngine(ports).run(command, (event) => events.push(event))
  return events
}
const only = async <T extends Event['type']>(command: unknown, type: T) => {
  const events = await run(command)
  expect(events.map((e) => e.type)).toEqual([type])
  return events[0] as Extract<Event, { type: T }>
}

const cardsOf = async () => (await only({ type: 'cards', ...at }, 'cards')).cards
const lectureOf = async () =>
  (await only({ type: 'course', course: COURSE }, 'course')).course.lectures[0]!
const slotsOf = async (card: string) => (await only({ type: 'slots', ...at, card }, 'slots')).slots
const cardFile = () => readFile(join(root, COURSE, 'lectures/01/cards.yaml'), 'utf8')
const record = async () =>
  (
    JSON.parse(await readFile(join(root, COURSE, 'anki.json'), 'utf8')) as {
      notes: Record<string, number>
    }
  ).notes
const send = () => run({ type: 'send', course: COURSE })

async function fresh(): Promise<CardFile[]> {
  root = join(await tempRoot(), 'library')
  anki = memoryAnki()
  await run({ type: 'create', name: 'Entrepreneurship WS26' })
  const name = '01 Risk.pdf'
  const data = await makePdf(SLIDES[name]!)
  await run({ type: 'add', course: COURSE, files: [{ name, data }] })
  expect((await run({ type: 'build', course: COURSE })).at(-1)!.type).toBe('built')
  return cardsOf()
}

/** A question with a one-sentence answer and its key term. */
const own = (changes: Partial<Slots> = {}): Slots => ({
  role: 'definition',
  front: 'What does Knight call an outcome with a known probability?',
  answers: [{ text: 'He calls it risk, as opposed to uncertainty.', key: 'risk' }],
  labels: [],
  hidden: [],
  at: [],
  extra: '',
  code: '',
  ...changes,
})

describe('the slots of a card', () => {
  let cards: CardFile[]
  let lecture: CourseState['lectures'][number]

  beforeAll(async () => {
    cards = await fresh()
    lecture = await lectureOf()
  })

  it('give every stored card back exactly when they are assembled again', async () => {
    expect(cards.length).toBeGreaterThan(2)
    const slides = await pdfjsReader.readSlides(
      new Uint8Array(await readFile(join(root, COURSE, 'slides/01 Risk.pdf'))),
    )
    const concepts = lecture.topics.flatMap((topic) => topic.concepts)
    for (const card of cards) {
      const concept = concepts.find((c) => c.id === card.concept)!
      const draft = toDraft(toSlots(card), {
        concept: concept.name,
        slide: card.slide,
      })
      const again = assemble(draft, {
        id: card.id,
        lecture,
        concept,
        slideLines: slides[card.slide - 1]!,
      })
      expect(again).toEqual(card)
    }
  })

  it('are plain text, with the key term apart from the answer', async () => {
    const card = cards.find(
      (c) => c.fields.Back?.includes('<mark>') && c.fields.Role === 'definition',
    )!
    const slots = await slotsOf(card.id)
    expect(slots.role).toBe('definition')
    expect(slots.front).toBe(card.fields.Front)
    expect(slots.answers).toHaveLength(1)
    expect(slots.answers[0]!.text).not.toMatch(/[<=]/)
    expect(slots.answers[0]!.text).toContain(slots.answers[0]!.key)
    expect(card.fields.Back).toContain(`<mark>${slots.answers[0]!.key}</mark>`)
  })

  it('come empty for a card the student is about to write, with the limits of the form', async () => {
    expect(await only({ type: 'slots', ...at, role: 'cloze' }, 'slots')).toEqual({
      type: 'slots',
      slots: {
        role: 'cloze',
        front: '',
        answers: [],
        labels: [],
        hidden: [],
        at: [],
        extra: '',
        code: '',
      },
      limits: { front: 20, answer: 25, extra: 40, gapSentence: 45 },
    })
  })
})

describe('changing a card', () => {
  let cards: CardFile[]
  let card: CardFile

  beforeAll(async () => {
    cards = await fresh()
    card = cards.find((c) => c.fields.Role === 'definition')!
  })

  it('takes the new wording and keeps the id, the slide and every other card', async () => {
    const slots = await slotsOf(card.id)
    const edited = await only(
      {
        type: 'edit',
        ...at,
        card: card.id,
        slots: {
          ...slots,
          front: 'Knight (1921): what is risk?',
          answers: [
            { text: 'An outcome whose probability is known.', key: 'probability is known' },
          ],
          extra: 'Opening a hairdresser shop is his example.',
        },
      },
      'edited',
    )
    expect(edited.card).toMatchObject({ id: card.id, slide: card.slide, concept: card.concept })
    expect(edited.card.fields).toMatchObject({
      Front: 'Knight (1921): what is risk?',
      Back: 'An outcome whose <mark>probability is known</mark>.',
      Extra: 'Opening a hairdresser shop is his example.',
      Role: 'definition',
      Lecture: card.fields.Lecture,
      Source: card.fields.Source,
      Slide: card.fields.Slide,
      Key: card.fields.Key,
    })
    const after = await cardsOf()
    expect(after.map((c) => c.id)).toEqual(cards.map((c) => c.id))
    expect(after.filter((c) => c.id !== card.id)).toEqual(cards.filter((c) => c.id !== card.id))
    expect(after.find((c) => c.id === card.id)).toEqual(edited.card)
  })

  it('refuses a card over a limit and says which field, in words for a student', async () => {
    const before = await cardFile()
    const slots = await slotsOf(card.id)
    const long = Array.from({ length: 21 }, (_, i) => `word${i}`).join(' ')
    expect(
      await only(
        { type: 'edit', ...at, card: card.id, slots: { ...slots, front: `What ${long}?` } },
        'refused',
      ),
    ).toEqual({
      type: 'refused',
      problems: [{ field: 'front', message: 'It has 22 words. The limit is 20.' }],
    })
    const refused = await only(
      {
        type: 'edit',
        ...at,
        card: card.id,
        slots: {
          ...slots,
          front: 'Is risk the same as uncertainty?',
          answers: [{ text: '', key: 'not there' }],
          extra: long + ' ' + long,
        },
      },
      'refused',
    )
    expect(refused.problems.map((p) => p.field)).toEqual(['front', 'answer', 'key', 'extra'])
    expect(await cardFile()).toBe(before)
  })

  it('passes on what only the validator finds', async () => {
    const slots = await slotsOf(card.id)
    const refused = await only(
      {
        type: 'edit',
        ...at,
        card: card.id,
        slots: { ...slots, answers: [{ text: 'It is **risk**.', key: 'risk' }] },
      },
      'refused',
    )
    expect(refused.problems).toEqual([
      { field: 'card', message: 'No Markdown; mark the key term as ==term==.' },
    ])
  })

  it('does not turn a card into another kind', async () => {
    const slots = await slotsOf(card.id)
    expect(
      await only(
        { type: 'edit', ...at, card: card.id, slots: { ...slots, role: 'why' } },
        'failed',
      ),
    ).toMatchObject({ message: 'A card keeps its kind.' })
  })
})

describe('a card that answers a past exam question', () => {
  it.each([true, false])(
    'keeps what the exams gave it when it is edited, in the file and in Anki (on the slides: %s)',
    async (fromSlides) => {
      const [first] = await fresh()
      const slots = await slotsOf(first!.id)
      const exam = assemble(toDraft(slots, { concept: first!.fields.Key!, slide: first!.slide }), {
        id: first!.id,
        lecture: { number: 1, title: first!.fields.Topic! },
        concept: { id: first!.concept, name: first!.fields.Key! },
        slideLines: ['Risk is an outcome whose probability is known.'],
        exam: { papers: 3, fromSlides },
      })
      await writeCards(nodeStore(root), COURSE, 1, [exam, ...(await cardsOf()).slice(1)])
      expect((await send()).at(-1)!.type).toBe('sent')
      const edited = await only(
        { type: 'edit', ...at, card: exam.id, slots: { ...slots, front: 'Knight: what is risk?' } },
        'edited',
      )
      const kept = ['Asked', 'Source', 'Slide', 'Excerpt'].map((name) => exam.fields[name])
      const of = (fields: Record<string, string>) =>
        ['Asked', 'Source', 'Slide', 'Excerpt'].map((name) => fields[name])
      expect(edited.card.fields.Front).toBe('Knight: what is risk?')
      expect(of(edited.card.fields)).toEqual(kept)
      expect(of((await cardsOf())[0]!.fields)).toEqual(kept)
      const note = (await record())[exam.id]
      const inAnki = anki.notes.find((n) => n.id === note)!
      expect(inAnki.fields.Front).toBe('Knight: what is risk?')
      expect(inAnki.fields.Asked).toBe('3x')
      expect(inAnki.fields.Source).toBe(exam.fields.Source)
    },
  )
})

describe('a card that is already in Anki', () => {
  let card: CardFile
  let note: number

  beforeAll(async () => {
    card = (await fresh()).find((c) => c.fields.Role === 'definition')!
    expect((await send()).at(-1)!.type).toBe('sent')
    note = (await record())[card.id]!
  })

  const reworded = async (front: string) => ({ ...(await slotsOf(card.id)), front })

  it('changes there too when it is edited, as the same note', async () => {
    const notes = anki.notes.length
    const edited = await only(
      { type: 'edit', ...at, card: card.id, slots: await reworded('Knight (1921): what is risk?') },
      'edited',
    )
    expect(anki.notes).toHaveLength(notes)
    const inAnki = anki.notes.find((n) => n.id === note)!
    expect(inAnki.fields.Front).toBe('Knight (1921): what is risk?')
    expect(inAnki.fields.Back).toBe(edited.card.fields.Back)
    expect(inAnki.fields.Slide).toBe(`<img src="lectern-${COURSE}-l01-s0${card.slide}.png">`)
    expect((await record())[card.id]).toBe(note)
    expect(await lectureOf()).toMatchObject({ sent: anki.notes.length })
    // The cards of a lecture come with the ids of those that are in Anki.
    const reply = await only({ type: 'cards', ...at }, 'cards')
    expect(reply.sent).toEqual(reply.cards.map((c) => c.id))
  })

  it('stays as it is, here and there, while Anki is closed', async () => {
    const before = await cardFile()
    anki.open = false
    expect(
      await only(
        { type: 'edit', ...at, card: card.id, slots: await reworded('What is risk?') },
        'failed',
      ),
    ).toMatchObject({ message: 'Anki is not open.' })
    expect(await only({ type: 'remove', ...at, card: card.id }, 'failed')).toMatchObject({
      message: 'Anki is not open.',
    })
    anki.open = true
    expect(await cardFile()).toBe(before)
    expect(anki.notes.find((n) => n.id === note)!.fields.Front).toBe('Knight (1921): what is risk?')
  })

  it('counts as not sent again once the student deleted its note in Anki', async () => {
    const cards = (await lectureOf()).cards
    await anki.deleteNotes([note])
    await only(
      { type: 'edit', ...at, card: card.id, slots: await reworded('What is risk?') },
      'edited',
    )
    expect(await record()).not.toHaveProperty(card.id)
    expect(await lectureOf()).toMatchObject({ cards, sent: cards - 1 })
    expect((await send()).at(-1)).toMatchObject({ type: 'sent', cards: 1 })
    expect(anki.notes.at(-1)!.fields.Front).toBe('What is risk?')
  })

  it('leaves Anki with it when it is removed', async () => {
    const { cards } = await lectureOf()
    const id = (await record())[card.id]!
    expect(await only({ type: 'remove', ...at, card: card.id }, 'removed')).toEqual({
      type: 'removed',
      card: card.id,
    })
    expect(anki.notes.some((n) => n.id === id)).toBe(false)
    expect(await record()).not.toHaveProperty(card.id)
    expect((await cardsOf()).some((c) => c.id === card.id)).toBe(false)
    expect(await lectureOf()).toMatchObject({ cards: cards - 1, sent: cards - 1 })
    expect(await only({ type: 'remove', ...at, card: card.id }, 'failed')).toMatchObject({
      message: 'This card is no longer in the lecture.',
    })
  })
})

describe('a card of the student’s own', () => {
  let cards: CardFile[]
  let concept: { id: string; name: string; slides: number[] }

  beforeAll(async () => {
    cards = await fresh()
    concept = (await lectureOf()).topics[0]!.concepts[0]!
  })

  it('joins the lecture on its concept, marked as theirs', async () => {
    const written = await only(
      { type: 'write', ...at, concept: concept.id, slots: own() },
      'written',
    )
    const taken = cards.filter((c) => c.id.startsWith(`01-${concept.id}-definition-`)).length
    expect(written.card).toMatchObject({
      id: `01-${concept.id}-definition-${taken + 1}`,
      note: 'qa',
      concept: concept.id,
      slide: concept.slides[0],
      own: true,
    })
    expect(written.card.fields).toMatchObject({
      Front: 'What does Knight call an outcome with a known probability?',
      Back: 'He calls it <mark>risk</mark>, as opposed to uncertainty.',
      Role: 'definition',
      Lecture: '01',
      Source: `Lecture 1, slide ${concept.slides[0]}`,
      Key: concept.name,
    })
    expect(await cardsOf()).toEqual([...cards, written.card])
  })

  it('can be a sentence with gaps', async () => {
    const written = await only(
      {
        type: 'write',
        ...at,
        concept: concept.id,
        slots: own({
          role: 'cloze',
          front: 'Risk has a known probability, uncertainty has none.',
          answers: [],
          hidden: ['known probability', 'none'],
        }),
      },
      'written',
    )
    expect(written.card).toMatchObject({ note: 'cloze', own: true })
    expect(written.card.fields.Text).toBe(
      'Risk has a {{c1::known probability}}, uncertainty has {{c2::none}}.',
    )
    expect((await slotsOf(written.card.id)).hidden).toEqual(['known probability', 'none'])
  })

  it('is refused until it is whole', async () => {
    const before = await cardFile()
    expect(
      await only(
        {
          type: 'write',
          ...at,
          concept: concept.id,
          slots: own({ answers: [{ text: 'He calls it risk.', key: '' }] }),
        },
        'refused',
      ),
    ).toEqual({
      type: 'refused',
      problems: [
        { field: 'key', message: 'Name the key term: the words of the answer to remember.' },
      ],
    })
    const gaps = await only(
      {
        type: 'write',
        ...at,
        concept: concept.id,
        slots: own({
          role: 'cloze',
          front: 'Risk has a known probability.',
          answers: [],
          hidden: ['unknown'],
        }),
      },
      'refused',
    )
    expect(gaps.problems.map((p) => p.field)).toEqual(['hidden'])
    expect(
      await only(
        { type: 'write', ...at, concept: concept.id, slots: own({ role: 'reverse' }) },
        'failed',
      ),
    ).toMatchObject({ fix: 'Choose one of the two kinds.' })
    expect(await cardFile()).toBe(before)
  })

  it('goes to Anki with the next send, tagged as the student’s', async () => {
    const mine = (await cardsOf()).filter((c) => c.own)
    expect(mine).toHaveLength(2)
    expect((await send()).at(-1)!.type).toBe('sent')
    const notes = await record()
    for (const card of mine) {
      expect(anki.notes.find((n) => n.id === notes[card.id])!.tags).toContain(`${COURSE}::own`)
    }
    const theirs = anki.notes.filter((n) => !n.tags.includes(`${COURSE}::own`))
    expect(theirs).toHaveLength(cards.length)
  })
})
