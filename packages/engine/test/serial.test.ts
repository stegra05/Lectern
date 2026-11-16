import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { memoryAnki, type MemoryAnki } from '../src/adapters/memory-anki.ts'
import { nodeStore } from '../src/adapters/node-store.ts'
import { offlineDecisions, offlineModel } from '../src/adapters/offline.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import { createEngine, type ShownCard, type Event, type Slots } from '../src/api.ts'
import { SLIDES } from './fixtures.ts'
import { makePdf, tempRoot, templates } from './helpers.ts'

const COURSE = 'entrepreneurship-ws26'
const at = { course: COURSE, lecture: 1 }

let root: string
let anki: MemoryAnki

/** Like the app: a new engine for every command. `delayMs` slows each model call. */
async function run(command: unknown, delayMs = 0): Promise<Event[]> {
  const ports = {
    store: nodeStore(root),
    pdf: pdfjsReader,
    model: offlineModel(delayMs),
    decisions: offlineDecisions(delayMs),
    anki,
    templates,
    now: Date.now,
  }
  const events: Event[] = []
  await createEngine(ports).run(command, (event) => events.push(event))
  return events
}

async function add(name: string): Promise<void> {
  const data = await makePdf(SLIDES[name]!)
  await run({ type: 'add', course: COURSE, files: [{ name, data }], to: 'slides' })
}

async function cards(): Promise<ShownCard[]> {
  const [event] = await run({ type: 'cards', ...at })
  return (event as Extract<Event, { type: 'cards' }>).cards
}

async function slotsOf(card: string): Promise<Slots> {
  const [event] = await run({ type: 'slots', ...at, card })
  return (event as Extract<Event, { type: 'slots' }>).slots
}

const record = async () =>
  (
    JSON.parse(await readFile(join(root, COURSE, 'anki.json'), 'utf8')) as {
      notes: Record<string, number>
    }
  ).notes

beforeEach(async () => {
  root = join(await tempRoot(), 'library')
  anki = memoryAnki()
  await run({ type: 'create', name: 'Entrepreneurship WS26' })
  await add('01 Risk.pdf')
  expect((await run({ type: 'build', course: COURSE })).at(-1)!.type).toBe('built')
})

describe('commands on one course', () => {
  it('run one after the other: two edits of one lecture at once both survive', async () => {
    const [first, second] = (await cards()).filter((c) => c.fields.Role === 'definition')
    const editTo = async (card: ShownCard, front: string) => ({
      type: 'edit',
      ...at,
      card: card.id,
      slots: { ...(await slotsOf(card.id)), front },
    })
    const answers = await Promise.all([
      run(await editTo(first!, 'Knight (1921): what is risk?')),
      run(await editTo(second!, 'Knight (1921): what is uncertainty?')),
    ])
    expect(answers.map((events) => events.map((e) => e.type))).toEqual([['edited'], ['edited']])
    const after = await cards()
    expect(after.find((c) => c.id === first!.id)!.fields.Front).toBe('Knight (1921): what is risk?')
    expect(after.find((c) => c.id === second!.id)!.fields.Front).toBe(
      'Knight (1921): what is uncertainty?',
    )
  })

  it('leave no note and no record of a card removed while the course is sent', async () => {
    const card = (await cards())[0]!
    const [sent, removed] = await Promise.all([
      run({ type: 'send', course: COURSE }),
      run({ type: 'remove', ...at, card: card.id }),
    ])
    expect(sent.at(-1)!.type).toBe('sent')
    expect(removed).toEqual([{ type: 'removed', card: card.id }])
    expect(await record()).not.toHaveProperty(card.id)
    expect(
      anki.notes.filter((note) => note.tags.some((tag) => tag.endsWith(`::${card.id}`))),
    ).toEqual([])
    expect(anki.notes).toHaveLength(Object.keys(await record()).length)
  })

  it('refuse at once while the cards are made, and reads do not wait', async () => {
    const card = (await cards())[0]!
    await add('02 Effectuation.pdf')
    const building = run({ type: 'build', course: COURSE }, 20)
    const refused = {
      type: 'failed',
      message: 'Lectern is making the cards of this course.',
      fix: 'Wait until they are made, then try again.',
    }
    expect(await run({ type: 'build', course: COURSE })).toEqual([refused])
    expect(
      await run({ type: 'edit', ...at, card: card.id, slots: await slotsOf(card.id) }),
    ).toEqual([refused])
    expect(await run({ type: 'send', course: COURSE })).toEqual([refused])
    expect((await cards()).map((c) => c.id)).toContain(card.id)
    expect((await building).at(-1)).toMatchObject({ type: 'built', lectures: [{ number: 2 }] })
    expect((await run({ type: 'send', course: COURSE })).at(-1)!.type).toBe('sent')
  })
})
