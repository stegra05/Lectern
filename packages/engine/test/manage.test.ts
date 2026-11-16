import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { memoryAnki, type MemoryAnki } from '../src/adapters/memory-anki.ts'
import { nodeStore } from '../src/adapters/node-store.ts'
import { offlineDecisions, offlineModel } from '../src/adapters/offline.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import { createEngine, type Event } from '../src/api.ts'
import { SLIDES } from './fixtures.ts'
import { makePdf, snapshot, tempRoot, templates } from './helpers.ts'

const COURSE = 'entrepreneurship'

let top: string
let root: string
let anki: MemoryAnki

/** Like the app: a new engine for every command, one Anki for all. */
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

const courseFile = async () =>
  JSON.parse(await readFile(join(root, COURSE, 'course.json'), 'utf8')) as { goal: string }

beforeEach(async () => {
  top = await tempRoot()
  root = join(top, 'library')
  anki = memoryAnki()
  await run({ type: 'create', name: 'Entrepreneurship', goal: 'pass' })
  await run({ type: 'create', name: 'Statistics' })
  await add('01 Risk.pdf')
  expect((await run({ type: 'build', course: COURSE })).at(-1)!.type).toBe('built')
  expect((await run({ type: 'send', course: COURSE })).at(-1)!.type).toBe('sent')
})

describe('changing the goal of a course', () => {
  it('keeps every card made, and the next lecture is built for the new goal', async () => {
    const lecture = join(root, COURSE, 'lectures')
    const before = await snapshot(lecture)

    expect(await run({ type: 'goal', course: COURSE, goal: 'top' })).toEqual([
      { type: 'goal', course: COURSE, goal: 'top' },
    ])
    expect((await courseFile()).goal).toBe('top')
    expect(await snapshot(lecture)).toEqual(before)

    await add('02 Effectuation.pdf')
    expect((await run({ type: 'build', course: COURSE })).at(-1)!.type).toBe('built')
    const runs = await readdir(join(root, COURSE, 'runs'))
    const last = JSON.parse(
      await readFile(join(root, COURSE, 'runs', runs.sort().at(-1)!), 'utf8'),
    ) as unknown
    expect(last).toMatchObject({ goal: 'top', lectures: [2] })
    const after = await snapshot(lecture)
    for (const [path, bytes] of before) expect(after.get(path)).toEqual(bytes)
  })

  it('refuses a goal that is not one of the three, and a course that is not there', async () => {
    expect((await run({ type: 'goal', course: COURSE, goal: 'perfect' }))[0]!.type).toBe('failed')
    expect(await run({ type: 'goal', course: 'nowhere', goal: 'top' })).toEqual([
      { type: 'failed', message: 'No course found in nowhere.', fix: 'Create the course first.' },
    ])
    expect((await courseFile()).goal).toBe('pass')
  })
})

describe('deleting a course', () => {
  it('removes its folder from the library and leaves Anki and the other courses alone', async () => {
    const notes = structuredClone(anki.notes)
    expect(notes.length).toBeGreaterThan(0)

    expect(await run({ type: 'delete', course: COURSE })).toEqual([
      { type: 'deleted', course: COURSE },
    ])
    expect(await readdir(root)).toEqual(['statistics'])
    expect(anki.notes).toEqual(notes)
    const [listed] = await run({ type: 'courses' })
    expect(listed).toMatchObject({ courses: [{ id: 'statistics' }] })
    expect(await run({ type: 'delete', course: COURSE })).toEqual([
      {
        type: 'failed',
        message: `No course found in ${COURSE}.`,
        fix: 'Delete a course from the list.',
      },
    ])
  })

  it('deletes a course whose course file is damaged, since the list still shows it', async () => {
    await writeFile(join(root, 'statistics', 'course.json'), '{"format": 1, "na')
    expect(await run({ type: 'delete', course: 'statistics' })).toEqual([
      { type: 'deleted', course: 'statistics' },
    ])
    expect(await readdir(root)).toEqual([COURSE])
  })

  it('refuses a name that would reach outside the course, and deletes nothing', async () => {
    // A folder beside the library that looks like a course.
    await mkdir(join(top, 'outside'), { recursive: true })
    await writeFile(join(top, 'outside', 'course.json'), '{}')
    for (const course of ['', '.', '..', '../outside', `${COURSE}/slides`, `${COURSE}\\slides`]) {
      const [event] = await run({ type: 'delete', course })
      expect(event, course).toMatchObject({ type: 'failed' })
    }
    expect(await readdir(top)).toContain('outside')
    expect((await readdir(root)).sort()).toEqual([COURSE, 'statistics'])
    expect(await readdir(join(root, COURSE, 'slides'))).toEqual(['01 Risk.pdf'])
  })

  it('is refused while the cards of the course are made', async () => {
    await add('02 Effectuation.pdf')
    const building = run({ type: 'build', course: COURSE }, 20)
    expect(await run({ type: 'delete', course: COURSE })).toEqual([
      {
        type: 'failed',
        message: 'Lectern is making the cards of this course.',
        fix: 'Wait until they are made, then try again.',
      },
    ])
    expect(await run({ type: 'goal', course: COURSE, goal: 'top' })).toMatchObject([
      { type: 'failed' },
    ])
    expect((await building).at(-1)!.type).toBe('built')
    expect(await readdir(root)).toContain(COURSE)
  })

  it('never deletes the library itself', async () => {
    await expect(nodeStore(root).remove('')).rejects.toThrow('cannot be deleted')
    await expect(nodeStore(root).remove('..')).rejects.toThrow('outside the course library')
    expect((await readdir(root)).sort()).toEqual([COURSE, 'statistics'])
  })
})
