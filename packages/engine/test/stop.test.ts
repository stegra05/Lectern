import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scriptedDecisions, scriptedModel } from '../src/adapters/fake.ts'
import { memoryAnki } from '../src/adapters/memory-anki.ts'
import { nodeStore } from '../src/adapters/node-store.ts'
import { offlineDecisions, offlineModel } from '../src/adapters/offline.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import { createEngine, type CourseFile, type Event, type Ports, type Run } from '../src/api.ts'
import { decisions, SLIDES } from './fixtures.ts'
import { onlyLecture2Costs } from './harness.ts'
import { addSlides, makePdf, tempRoot, templates } from './helpers.ts'

const json = async <T>(root: string, path: string) =>
  JSON.parse(await readFile(join(root, path), 'utf8')) as T

describe('a build stopped from outside', () => {
  it('keeps the lectures it finished and records the calls it made', async () => {
    const root = await tempRoot()
    for (const file of ['01 Risk.pdf', '02 Effectuation.pdf'])
      await addSlides(root, file, SLIDES[file]!)
    const stop = new AbortController()
    const store = nodeStore(root)
    const model = scriptedModel(onlyLecture2Costs(0).script!)
    const ports: Ports = {
      // Stopped once lecture 1 is saved, while the calls of lecture 2 come back late.
      store: {
        ...store,
        write: async (path, text) => {
          await store.write(path, text)
          if (path === 'course/course.json' && (JSON.parse(text) as CourseFile).lectures.length)
            stop.abort()
        },
      },
      pdf: pdfjsReader,
      model,
      decisions: scriptedDecisions(decisions),
      anki: memoryAnki(),
      templates,
      now: Date.now,
    }
    const events: Event[] = []
    await createEngine(ports).run(
      { type: 'build', course: 'course' },
      (event) => events.push(event),
      stop.signal,
    )
    expect(events.at(-1)).toEqual({
      type: 'failed',
      message: 'The build was stopped.',
      fix: 'The lectures finished before the stop are saved. Build again to make the rest.',
    })
    const listed = await json<CourseFile>(root, 'course/course.json')
    expect(listed.lectures.map((l) => l.number)).toEqual([1])
    expect(await json<Run>(root, 'course/runs/001.json')).toMatchObject({
      failed: true,
      lectures: [1],
      calls: model.requests.length,
    })
  })
})

describe('a send stopped from outside', () => {
  it('leaves anki.json holding exactly the notes that reached Anki', async () => {
    const root = join(await tempRoot(), 'library')
    const anki = memoryAnki()
    const engine = createEngine({
      store: nodeStore(root),
      pdf: pdfjsReader,
      model: offlineModel(),
      decisions: offlineDecisions(),
      anki,
      templates,
      now: Date.now,
    })
    const run = async (command: unknown, signal?: AbortSignal, onEvent?: (e: Event) => void) => {
      const events: Event[] = []
      await engine.run(
        command,
        (event) => {
          events.push(event)
          onEvent?.(event)
        },
        signal,
      )
      return events
    }
    const course = 'entrepreneurship-ws26'
    await run({ type: 'create', name: 'Entrepreneurship WS26' })
    const name = '01 Risk.pdf'
    const data = await makePdf(SLIDES[name]!)
    await run({ type: 'add', course, files: [{ name, data }], to: 'slides' })
    expect((await run({ type: 'build', course })).at(-1)!.type).toBe('built')

    const stop = new AbortController()
    const stopped = await run({ type: 'send', course }, stop.signal, (event) => {
      if (event.type === 'sending') stop.abort()
    })
    expect(stopped.at(-1)).toEqual({
      type: 'failed',
      message: 'The send was stopped.',
      fix: 'The cards already sent stay in Anki. Send again to add the rest.',
    })
    const total = stopped.find((e) => e.type === 'sending')!.total
    const record = await json<{ notes: Record<string, number> }>(root, `${course}/anki.json`)
    const recorded = Object.values(record.notes).sort()
    expect(recorded).toEqual(anki.notes.map((note) => note.id).sort())
    expect(recorded.length).toBeGreaterThan(0)
    expect(recorded.length).toBeLessThan(total)

    expect((await run({ type: 'send', course })).at(-1)).toMatchObject({
      type: 'sent',
      cards: total - recorded.length,
    })
    expect(anki.notes).toHaveLength(total)
  })
})
