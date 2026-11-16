import { readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ankiConnect } from '../src/adapters/ankiconnect.ts'
import { memoryAnki, type MemoryAnki } from '../src/adapters/memory-anki.ts'
import { nodeStore } from '../src/adapters/node-store.ts'
import { offlineDecisions, offlineModel } from '../src/adapters/offline.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import {
  createEngine,
  type AnkiPort,
  type ShownCard,
  type CourseState,
  type Event,
} from '../src/api.ts'
import { SLIDES } from './fixtures.ts'
import { makePdf, tempRoot, templates } from './helpers.ts'

const COURSE = 'entrepreneurship-ws26'
const QA = 'Lectern Q&A'
const CLOZE = 'Lectern Cloze v3'

let root: string
let anki: MemoryAnki

async function run(command: unknown, port: AnkiPort = anki): Promise<Event[]> {
  const ports = {
    store: nodeStore(root),
    pdf: pdfjsReader,
    model: offlineModel(),
    decisions: offlineDecisions(),
    anki: port,
    templates,
    now: Date.now,
  }
  const events: Event[] = []
  await createEngine(ports).run(command, (event) => events.push(event))
  return events
}
const last = async (command: unknown, port?: AnkiPort) => (await run(command, port)).at(-1)!

async function addAndBuild(...names: string[]): Promise<void> {
  const files = await Promise.all(
    names.map(async (name) => ({ name, data: await makePdf(SLIDES[name]!) })),
  )
  await run({ type: 'add', course: COURSE, files, to: 'slides' })
  expect((await last({ type: 'build', course: COURSE })).type).toBe('built')
}

async function state(): Promise<CourseState> {
  const event = await last({ type: 'course', course: COURSE })
  if (event.type !== 'course') throw new Error(`No course: ${JSON.stringify(event)}`)
  return event.course
}

async function cardsOf(lecture: number): Promise<ShownCard[]> {
  const event = await last({ type: 'cards', course: COURSE, lecture })
  return event.type === 'cards' ? event.cards : []
}

const deliveryFile = async () =>
  JSON.parse(await readFile(join(root, COURSE, 'anki.json'), 'utf8')) as {
    notes: Record<string, number>
  }

describe('sending a course to Anki', () => {
  let first: CourseState

  beforeAll(async () => {
    root = join(await tempRoot(), 'library')
    anki = memoryAnki()
    await run({ type: 'create', name: 'Entrepreneurship WS26' })
    await addAndBuild('01 Risk.pdf', '02 Effectuation.pdf')
    first = await state()
  })

  it('says that nothing is in Anki before the first send', () => {
    expect(first.lectures.map((l) => l.sent)).toEqual([0, 0])
    expect(first.lectures.every((l) => l.cards > 0)).toBe(true)
  })

  it('names the fix when Anki is not open, and sends nothing', async () => {
    anki.open = false
    expect(await run({ type: 'send', course: COURSE })).toEqual([
      {
        type: 'failed',
        message: 'Anki is not open.',
        fix: 'Open Anki and wait until you see your decks, then try again. If Anki is open, restart it once so the AnkiConnect add-on starts.',
      },
    ])
    anki.open = true
    expect(anki.notes).toHaveLength(0)
    expect((await state()).lectures.map((l) => l.sent)).toEqual([0, 0])
  })

  it('keeps what reached Anki when a send breaks off, and sends only the rest next time', async () => {
    const total = first.lectures.reduce((sum, l) => sum + l.cards, 0)
    let added = 0
    const breaking: AnkiPort = {
      ...anki,
      addNote: (note) =>
        ++added > 3 ? Promise.reject(new Error('Anki went away')) : anki.addNote(note),
    }
    const broken = await run({ type: 'send', course: COURSE }, breaking)
    expect(broken.map((e) => e.type)).toEqual(['sending', 'sending', 'sending', 'failed'])
    expect(anki.notes).toHaveLength(3)
    expect(Object.keys((await deliveryFile()).notes)).toHaveLength(3)

    const events = await run({ type: 'send', course: COURSE })
    const progress = events.filter((e) => e.type === 'sending')
    expect(progress).toHaveLength(total - 3)
    expect(progress.at(-1)).toMatchObject({ done: total - 3, total: total - 3 })
    expect(events.at(-1)).toEqual({
      type: 'sent',
      deck: 'Entrepreneurship WS26',
      cards: total - 3,
      lectures: [1, 2],
    })
    expect(anki.notes).toHaveLength(total)
  })

  it('puts every card into the subdeck of its lecture, in course order', async () => {
    expect([...anki.decks].sort()).toEqual([
      'Default',
      'Entrepreneurship WS26',
      `Entrepreneurship WS26::01 ${first.lectures[0]!.title}`,
      `Entrepreneurship WS26::02 ${first.lectures[1]!.title}`,
    ])
    for (const lecture of first.lectures) {
      const deck = `Entrepreneurship WS26::0${lecture.number} ${lecture.title}`
      expect(anki.notes.filter((n) => n.deck === deck)).toHaveLength(lecture.cards)
    }
    expect((await state()).lectures.map((l) => l.sent)).toEqual(first.lectures.map((l) => l.cards))
  })

  it('sends the fields of each card as they are stored, tagged by lecture and role', async () => {
    const cards = await cardsOf(2)
    const { notes } = await deliveryFile()
    for (const card of cards) {
      const note = anki.notes.find((n) => n.id === notes[card.id])!
      expect(note.noteType).toBe(card.fields.Text === undefined ? QA : CLOZE)
      expect(note.tags).toEqual([
        'entrepreneurship-ws26::lecture::02',
        `entrepreneurship-ws26::role::${card.fields.Role}`,
        `lectern-id::entrepreneurship-ws26::${card.id}`,
      ])
      const { Slide, Diagram, ...rest } = card.fields
      expect(note.fields).toMatchObject(rest)
      expect(note.fields.Typed).toBe('')
      expect(Object.keys(note.fields)).toEqual(Object.keys(card.fields))
      expect(note.fields.Diagram).toBe(Diagram === '' ? '' : note.fields.Slide)
      expect(Slide).toMatch(/^<img src="l02-s\d\d\.png">$/)
    }
  })

  it('stores the slide picture each card names, under a name no other course can take', async () => {
    const pictures = [...anki.media.keys()].filter((name) => name.endsWith('.png'))
    expect(pictures.length).toBeGreaterThan(0)
    for (const note of anki.notes) {
      const name = /<img src="([^"]+)">/.exec(note.fields.Slide!)![1]!
      expect(name).toMatch(/^lectern-entrepreneurship-ws26-l0[12]-s\d\d\.png$/)
      expect(pictures).toContain(name)
    }
    // Only slides that a card shows are stored.
    expect(new Set(pictures)).toEqual(
      new Set(anki.notes.map((n) => /<img src="([^"]+)">/.exec(n.fields.Slide!)![1]!)),
    )
    const png = Buffer.from(anki.media.get(pictures[0]!)!, 'base64')
    expect(png.subarray(1, 4).toString()).toBe('PNG')
  })

  it('installs both note types with the fields of the contract and the Native design', async () => {
    const native = await templates.load()
    expect(anki.types.get(QA)).toEqual({
      name: QA,
      cloze: false,
      fields: [
        ...['Front', 'Back', 'Role', 'Slots', 'Code', 'Typed', 'Lecture', 'Topic'],
        ...['Source', 'Asked', 'Part', 'Extra', 'Excerpt', 'Slide', 'Diagram', 'Key'],
      ],
      css: native.css,
      template: { name: 'Card', front: native.templates.front, back: native.templates.back },
    })
    expect(anki.types.get(CLOZE)).toMatchObject({
      cloze: true,
      fields: [
        ...['Text', 'Role', 'Typed', 'Lecture', 'Topic', 'Source', 'Asked'],
        ...['Part', 'Extra', 'Excerpt', 'Slide', 'Diagram', 'Key'],
      ],
      template: { name: 'Cloze', front: native.templates.clozeFront },
    })
    // Native uses the system font, so no font file goes to Anki.
    expect([...anki.media.keys()].filter((name) => name.endsWith('.woff2'))).toEqual([])
  })

  it('has nothing to send a second time', async () => {
    expect(await last({ type: 'send', course: COURSE })).toEqual({
      type: 'failed',
      message: 'Every card of this course is already in Anki.',
      fix: 'Add a lecture and make its cards, then send again.',
    })
  })

  describe('a lecture added later', () => {
    let before: { id: number; fields: Record<string, string> }[]

    beforeAll(async () => {
      before = structuredClone(anki.notes)
      // The student deleted a note in Anki. It must not come back.
      anki.notes.splice(0, 1)
      before.splice(0, 1)
      await addAndBuild('03 Lean startup.pdf')
    })

    it('sends only the new cards and leaves every earlier note alone', async () => {
      const [, , third] = (await state()).lectures
      expect(third).toMatchObject({ number: 3, sent: 0 })
      expect(await last({ type: 'send', course: COURSE })).toEqual({
        type: 'sent',
        deck: 'Entrepreneurship WS26',
        cards: third!.cards,
        lectures: [3],
      })
      expect(anki.notes.slice(0, before.length)).toEqual(before)
      const added = anki.notes.slice(before.length)
      expect(added).toHaveLength(third!.cards)
      expect(new Set(added.map((n) => n.deck))).toEqual(
        new Set([`Entrepreneurship WS26::03 ${third!.title}`]),
      )
      expect((await state()).lectures.every((l) => l.sent === l.cards)).toBe(true)
    })
  })
})

describe('a course whose name is already a deck in Anki', () => {
  it('gets a deck of its own and keeps it for later sends', async () => {
    root = join(await tempRoot(), 'library')
    anki = memoryAnki()
    // The student's own deck for the course, with a subdeck, as Anki lists them.
    await anki.createDeck('entrepreneurship ws26::01 What and who')
    await run({ type: 'create', name: 'Entrepreneurship WS26' })
    await addAndBuild('01 Risk.pdf')
    expect(await last({ type: 'send', course: COURSE })).toMatchObject({
      type: 'sent',
      deck: 'Entrepreneurship WS26 (Lectern)',
    })
    await addAndBuild('02 Effectuation.pdf')
    expect(await last({ type: 'send', course: COURSE })).toMatchObject({
      type: 'sent',
      deck: 'Entrepreneurship WS26 (Lectern)',
      lectures: [2],
    })
    expect(new Set(anki.notes.map((note) => note.deck.split('::')[0]))).toEqual(
      new Set(['Entrepreneurship WS26 (Lectern)']),
    )
  })

  it('keeps the deck it chose when the first send breaks off before any card', async () => {
    root = join(await tempRoot(), 'library')
    anki = memoryAnki()
    await run({ type: 'create', name: 'Entrepreneurship WS26' })
    await addAndBuild('01 Risk.pdf')
    const breaking: AnkiPort = {
      ...anki,
      addNote: () => Promise.reject(new Error('Anki went away')),
    }
    expect((await last({ type: 'send', course: COURSE }, breaking)).type).toBe('failed')
    // Its own, now empty deck is in Anki. It must not read as somebody else's.
    expect(await last({ type: 'send', course: COURSE })).toMatchObject({
      type: 'sent',
      deck: 'Entrepreneurship WS26',
    })
  })
})

describe('an Anki that hands back a note and does not keep it', () => {
  /** Loses a note right after adding it, as the first send into a real Anki did. */
  const losing = (lose: (call: number) => boolean): AnkiPort => {
    let call = 0
    return {
      ...anki,
      addNote: async (note) => {
        const id = await anki.addNote(note)
        if (lose(++call)) anki.notes.pop()
        return id
      },
    }
  }
  const fresh = async () => {
    root = join(await tempRoot(), 'library')
    anki = memoryAnki()
    await run({ type: 'create', name: 'Entrepreneurship WS26' })
    await addAndBuild('01 Risk.pdf')
    return (await state()).lectures[0]!.cards
  }

  it('adds the lost cards again, so every card is in Anki exactly once', async () => {
    const cards = await fresh()
    const events = await run(
      { type: 'send', course: COURSE },
      losing((call) => call === 2 || call === 4),
    )
    expect(events.filter((e) => e.type === 'sending')).toHaveLength(cards)
    expect(events.at(-1)).toMatchObject({ type: 'sent', cards })
    const { notes } = await deliveryFile()
    expect(anki.notes.map((note) => note.id).sort()).toEqual(Object.values(notes).sort())
    expect(anki.notes).toHaveLength(cards)
    expect(new Set(anki.notes.map((note) => note.fields.Front ?? note.fields.Text)).size).toBe(
      cards,
    )
  })

  it('notices a note that went after its lecture was checked', async () => {
    await fresh()
    await addAndBuild('02 Effectuation.pdf')
    const cards = (await state()).lectures.reduce((sum, l) => sum + l.cards, 0)
    // An undo while the second lecture is prepared takes the last note of the first.
    let decks = 0
    const undoing: AnkiPort = {
      ...anki,
      createDeck: (name) => {
        if (++decks === 2) anki.notes.pop()
        return anki.createDeck(name)
      },
    }
    const events = await run({ type: 'send', course: COURSE }, undoing)
    expect(events.at(-1)).toMatchObject({ type: 'sent', cards })
    expect(events.filter((e) => e.type === 'sending')).toHaveLength(cards)
    const { notes } = await deliveryFile()
    expect(anki.notes.map((note) => note.id).sort()).toEqual(Object.values(notes).sort())
    expect(anki.notes).toHaveLength(cards)
    expect((await state()).lectures.every((l) => l.sent === l.cards)).toBe(true)
  })

  it('survives an add that Anki applied and then answered with an error', async () => {
    const cards = await fresh()
    let added = false
    const timingOut: AnkiPort = {
      ...anki,
      addNote: async (note) => {
        added = true
        anki.answersLost = true
        try {
          return await anki.addNote(note)
        } finally {
          anki.answersLost = false
        }
      },
      // The look-up after the failed add fails the same way.
      taggedNotes: (tag) =>
        added ? Promise.reject(new Error('No answer')) : anki.taggedNotes(tag),
    }
    expect((await last({ type: 'send', course: COURSE }, timingOut)).type).toBe('failed')
    expect(anki.notes).toHaveLength(1)

    expect(await last({ type: 'send', course: COURSE })).toMatchObject({ type: 'sent', cards })
    expect(anki.notes).toHaveLength(cards)
    const { notes } = await deliveryFile()
    expect(anki.notes.map((note) => note.id).sort()).toEqual(Object.values(notes).sort())
    const tagsOf = anki.notes.map((note) => note.tags.find((tag) => tag.startsWith('lectern-id::')))
    expect(new Set(tagsOf).size).toBe(cards)
  })

  it('gives up after three tries, says so, and records only what is there', async () => {
    const cards = await fresh()
    // The first card never stays: calls 1, then the two retries of it.
    const events = await run(
      { type: 'send', course: COURSE },
      losing((call) => call === 1 || call > cards),
    )
    expect(events.at(-1)).toEqual({
      type: 'failed',
      message: '1 card did not stay in Anki.',
      fix: 'Do not undo or edit in Anki while Lectern sends. Then send again: only the missing cards are added.',
    })
    expect(anki.notes).toHaveLength(cards - 1)
    expect(Object.keys((await deliveryFile()).notes)).toHaveLength(cards - 1)
    expect((await state()).lectures[0]).toMatchObject({ cards, sent: cards - 1 })

    expect(await last({ type: 'send', course: COURSE })).toMatchObject({
      type: 'sent',
      cards: 1,
    })
    expect(anki.notes).toHaveLength(cards)
  })
})

describe('two courses with the same lectures and concepts', () => {
  const OTHER = 'entrepreneurship-ws27'
  const notesOf = async (course: string) =>
    JSON.parse(await readFile(join(root, course, 'anki.json'), 'utf8')) as {
      deck: string
      notes: Record<string, number>
    }

  it('each get their own notes, and a change in one never reaches the other', async () => {
    root = join(await tempRoot(), 'library')
    anki = memoryAnki()
    const data = await makePdf(SLIDES['01 Risk.pdf']!)
    for (const name of ['Entrepreneurship WS26', 'Entrepreneurship WS27']) {
      const course = name.toLowerCase().replace(' ', '-')
      await run({ type: 'create', name })
      await run({ type: 'add', course, files: [{ name: '01 Risk.pdf', data }] })
      expect((await last({ type: 'build', course })).type).toBe('built')
      expect(await last({ type: 'send', course })).toMatchObject({ type: 'sent' })
    }
    const [one, two] = [await notesOf(COURSE), await notesOf(OTHER)]
    const ids = Object.keys(one.notes)
    expect(ids.length).toBeGreaterThan(0)
    expect(Object.keys(two.notes)).toEqual(ids)
    expect(anki.notes).toHaveLength(2 * ids.length)
    expect(new Set([...Object.values(one.notes), ...Object.values(two.notes)]).size).toBe(
      2 * ids.length,
    )
    expect(one.deck).not.toBe(two.deck)
    for (const note of anki.notes) {
      const mine = Object.values(one.notes).includes(note.id)
      expect(note.deck.startsWith(mine ? one.deck : two.deck)).toBe(true)
    }

    const [card] = await last({ type: 'cards', course: OTHER, lecture: 1 }).then((e) =>
      e.type === 'cards' ? e.cards : [],
    )
    expect((await last({ type: 'remove', course: OTHER, lecture: 1, card: card!.id })).type).toBe(
      'removed',
    )
    expect(anki.notes).toHaveLength(2 * ids.length - 1)
    expect(anki.notes.some((n) => n.id === one.notes[card!.id])).toBe(true)
  })
})

describe('a course folder with capitals and a space in its name', () => {
  it('gets lowercase media names, picture sources and tags', async () => {
    root = join(await tempRoot(), 'library')
    anki = memoryAnki()
    await run({ type: 'create', name: 'My Course' })
    await rename(join(root, 'my-course'), join(root, 'My Course'))
    const data = await makePdf(SLIDES['01 Risk.pdf']!)
    await run({
      type: 'add',
      course: 'My Course',
      files: [{ name: '01 Risk.pdf', data }],
      to: 'slides',
    })
    await run({ type: 'build', course: 'My Course' })
    expect(await last({ type: 'send', course: 'My Course' })).toMatchObject({ type: 'sent' })
    expect(anki.notes.length).toBeGreaterThan(0)
    for (const note of anki.notes) {
      const name = /<img src="([^"]+)">/.exec(note.fields.Slide!)![1]!
      expect(name).toMatch(/^lectern-my-course-l01-s\d\d\.png$/)
      expect(anki.media.has(name)).toBe(true)
      expect(note.tags).toContain('my-course::lecture::01')
      expect(
        note.tags.every((tag) => tag === tag.toLowerCase() || tag.startsWith('lectern-id::')),
      ).toBe(true)
    }
    for (const name of anki.media.keys()) expect(name).toBe(name.toLowerCase())
  })
})

describe('the AnkiConnect adapter', () => {
  it('says that Anki is not open when nothing answers', async () => {
    // Nothing listens at this address.
    await expect(ankiConnect('http://127.0.0.1:1').noteTypes()).rejects.toMatchObject({
      message: 'Anki is not open.',
    })
  })
})
