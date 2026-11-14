import { readFile } from 'node:fs/promises'
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
  type CardFile,
  type CourseState,
  type Event,
} from '../src/api.ts'
import { SLIDES } from './fixtures.ts'
import { designs, makePdf, tempRoot } from './helpers.ts'

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
    designs,
    now: Date.now,
  }
  const events: Event[] = []
  await createEngine(ports).run(command, (event) => events.push(event))
  return events
}
const last = async (command: unknown, port?: AnkiPort) => (await run(command, port)).at(-1)!

async function addAndBuild(...names: string[]): Promise<void> {
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      data: Buffer.from(await makePdf(SLIDES[name]!)).toString('base64'),
    })),
  )
  await run({ type: 'add', course: COURSE, files })
  expect((await last({ type: 'build', course: COURSE })).type).toBe('built')
}

async function state(): Promise<CourseState> {
  const event = await last({ type: 'course', course: COURSE })
  if (event.type !== 'course') throw new Error(`No course: ${JSON.stringify(event)}`)
  return event.course
}

async function cardsOf(lecture: number): Promise<CardFile[]> {
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
    expect(await run({ type: 'send', course: COURSE, design: 'native' })).toEqual([
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
    const broken = await run({ type: 'send', course: COURSE, design: 'native' }, breaking)
    expect(broken.map((e) => e.type)).toEqual(['sending', 'sending', 'sending', 'failed'])
    expect(anki.notes).toHaveLength(3)
    expect(Object.keys((await deliveryFile()).notes)).toHaveLength(3)

    const events = await run({ type: 'send', course: COURSE, design: 'native' })
    const progress = events.filter((e) => e.type === 'sending')
    expect(progress).toHaveLength(total - 3)
    expect(progress.at(-1)).toMatchObject({ done: total - 3, total: total - 3 })
    expect(events.at(-1)).toEqual({ type: 'sent', cards: total - 3, lectures: [1, 2] })
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
      expect(note.noteType).toBe(card.note === 'cloze' ? CLOZE : QA)
      expect(note.tags).toEqual([
        'entrepreneurship-ws26::lecture::02',
        `entrepreneurship-ws26::role::${card.fields.Role}`,
      ])
      const { Slide, Diagram, ...rest } = card.fields
      expect(note.fields).toMatchObject(rest)
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

  it('installs both note types with the fields of the contract and the chosen design', async () => {
    const native = await designs.load('native')
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
    expect(await last({ type: 'send', course: COURSE, design: 'native' })).toEqual({
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
      expect(await last({ type: 'send', course: COURSE, design: 'native' })).toEqual({
        type: 'sent',
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

  describe('changing the card design', () => {
    it('restyles the note types that are in Anki and stores the fonts of the design', async () => {
      const lamp = await designs.load('lamp')
      expect(await run({ type: 'restyle', design: 'lamp' })).toEqual([
        { type: 'restyled', noteTypes: [QA, CLOZE] },
      ])
      expect(anki.types.get(QA)!.css).toBe(lamp.css)
      expect(anki.types.get(CLOZE)!.css).toBe(lamp.css)
      expect([...anki.media.keys()].filter((name) => name.endsWith('.woff2')).sort()).toEqual([
        '_LampMono.woff2',
        '_LampSerif.woff2',
      ])
    })

    it('leaves a note type alone once the student has edited its styling', async () => {
      const mine = '.card { color: teal; }'
      await anki.restyle({ ...anki.types.get(QA)!, css: mine })
      expect(await run({ type: 'restyle', design: 'structure' })).toEqual([
        { type: 'restyled', noteTypes: [CLOZE] },
      ])
      expect(anki.types.get(QA)!.css).toBe(mine)
    })

    it('installs nothing in an Anki that has no Lectern cards yet', async () => {
      const empty = memoryAnki()
      expect(await run({ type: 'restyle', design: 'lamp' }, empty)).toEqual([
        { type: 'restyled', noteTypes: [] },
      ])
      expect(empty.types.size).toBe(0)
      expect(empty.media.size).toBe(0)
    })
  })
})

describe('changing the card design before anything was sent', () => {
  it('needs no Anki', async () => {
    root = join(await tempRoot(), 'library')
    anki = memoryAnki()
    anki.open = false
    await run({ type: 'create', name: 'Analysis 2' })
    expect(await run({ type: 'restyle', design: 'lamp' })).toEqual([
      { type: 'restyled', noteTypes: [] },
    ])
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
