import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { memoryAnki } from '../src/adapters/memory-anki.ts'
import { nodeStore } from '../src/adapters/node-store.ts'
import { offlineDecisions, offlineModel } from '../src/adapters/offline.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import {
  createEngine,
  type CardFile,
  type CourseState,
  type CourseSummary,
  EngineError,
  type Event,
  type ModelPort,
} from '../src/api.ts'
import { validateDraft } from '../src/cards/validate.ts'
import { SLIDES } from './fixtures.ts'
import { makePdf, tempRoot, templates } from './helpers.ts'

let root: string
const pdfs = new Map<string, Uint8Array>()
const upload = (...names: string[]) => names.map((name) => ({ name, data: pdfs.get(name)! }))

async function run(command: unknown): Promise<Event[]> {
  let clock = 0
  const ports = {
    store: nodeStore(root),
    pdf: pdfjsReader,
    model: offlineModel(),
    decisions: offlineDecisions(),
    anki: memoryAnki(),
    templates,
    now: () => (clock += 1000),
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

describe('a course from creation to its cards, through the boundary only, with the offline models', () => {
  let state: CourseState

  beforeAll(async () => {
    root = join(await tempRoot(), 'library')
    for (const [name, slides] of Object.entries(SLIDES)) {
      pdfs.set(name, await makePdf(slides))
    }
  })

  it('creates a course with a name and a goal, in a folder of its own', async () => {
    expect(
      await only({ type: 'create', name: 'Entrepreneurship WS26', goal: 'top' }, 'created'),
    ).toEqual({
      type: 'created',
      course: 'entrepreneurship-ws26',
    })
    expect((await only({ type: 'create', name: 'Entrepreneurship WS26' }, 'created')).course).toBe(
      'entrepreneurship-ws26-2',
    )
  })

  it('lists the courses of the library', async () => {
    const empty: CourseSummary = {
      id: '',
      name: 'Entrepreneurship WS26',
      goal: 'good',
      built: [],
      pending: [],
      cards: 0,
    }
    expect(await only({ type: 'courses' }, 'courses')).toEqual({
      type: 'courses',
      courses: [
        { ...empty, id: 'entrepreneurship-ws26', goal: 'top' },
        { ...empty, id: 'entrepreneurship-ws26-2' },
      ],
    })
  })

  it('adds PDFs to a course: a name and the bytes', async () => {
    const files = upload('01 Risk.pdf', '02 Effectuation.pdf')
    expect(await only({ type: 'add', course: 'entrepreneurship-ws26', files }, 'added')).toEqual({
      type: 'added',
      course: 'entrepreneurship-ws26',
      files: ['01 Risk.pdf', '02 Effectuation.pdf'],
    })
    expect(await readdir(join(root, 'entrepreneurship-ws26/slides'))).toEqual([
      '01 Risk.pdf',
      '02 Effectuation.pdf',
    ])
  })

  it('shows PDFs without cards as pending, with the number, a title and the slide count', async () => {
    const course = (await only({ type: 'course', course: 'entrepreneurship-ws26' }, 'course'))
      .course
    expect(course).toMatchObject({ lectures: [], decisions: [], runs: [] })
    expect(course.pending).toEqual([
      { file: '01 Risk.pdf', number: 1, title: 'Risk', slides: 5 },
      { file: '02 Effectuation.pdf', number: 2, title: 'Effectuation', slides: 4 },
    ])
    expect((await only({ type: 'courses' }, 'courses')).courses[0]).toMatchObject({
      built: [],
      pending: [1, 2],
      cards: 0,
    })
  })

  it('refuses a file that is no PDF or whose name the course already has, and adds nothing then', async () => {
    const again = upload('03 Lean startup.pdf', '01 Risk.pdf')
    expect(
      await only({ type: 'add', course: 'entrepreneurship-ws26', files: again }, 'failed'),
    ).toEqual({
      type: 'failed',
      message: 'The course already has a file named 01 Risk.pdf.',
      fix: 'Rename the new file, then add it again.',
    })
    const notes = [{ name: 'notes.pdf', data: new TextEncoder().encode('just text') }]
    expect(
      await only({ type: 'add', course: 'entrepreneurship-ws26', files: notes }, 'failed'),
    ).toMatchObject({
      message: 'notes.pdf is not a PDF.',
    })
    expect(await only({ type: 'add', course: 'nowhere', files: again }, 'failed')).toMatchObject({
      message: 'No course found in nowhere.',
      fix: 'Create the course first.',
    })
    expect(await readdir(join(root, 'entrepreneurship-ws26/slides'))).toHaveLength(2)
  })

  it('renders one slide as a picture, before and after the build', async () => {
    const event = await only(
      { type: 'slide', course: 'entrepreneurship-ws26', lecture: 2, slide: 3 },
      'slide',
    )
    expect(event).toMatchObject({ type: 'slide', lecture: 2, slide: 3 })
    expect(event.png.startsWith('iVBORw0KGgo')).toBe(true)
    expect(
      await only(
        { type: 'slide', course: 'entrepreneurship-ws26', lecture: 2, slide: 9 },
        'failed',
      ),
    ).toMatchObject({
      message: 'Lecture 2 has no slide 9.',
    })
    expect(
      await only(
        { type: 'slide', course: 'entrepreneurship-ws26', lecture: 7, slide: 1 },
        'failed',
      ),
    ).toMatchObject({
      message: 'The course has no lecture 7.',
    })
  })

  it('builds the course with the offline models: no script, no network, plausible cards', async () => {
    const events = await run({ type: 'build', course: 'entrepreneurship-ws26' })
    expect(events.at(-1)).toMatchObject({
      type: 'built',
      lectures: [
        { number: 1, title: 'Entrepreneurship', concepts: 4 },
        { number: 2, title: 'Effectuation', concepts: 3 },
      ],
      dropped: 0,
    })
    state = (await only({ type: 'course', course: 'entrepreneurship-ws26' }, 'course')).course
    expect(state.lectures.reduce((sum, lecture) => sum + lecture.cards, 0)).toBeGreaterThanOrEqual(
      14,
    )
  })

  it('reads one course as the interface shows it', () => {
    expect(state).toMatchObject({
      id: 'entrepreneurship-ws26',
      name: 'Entrepreneurship WS26',
      goal: 'top',
      pending: [],
      runs: [{ run: 1, model: 'offline', lectures: [1, 2], costUsd: 0 }],
    })
    expect(state.decisions[0]).toEqual({
      lecture: null,
      kind: 'goal',
      text: 'Goal "top grade": the facts worth most get a card, at most 1.8 per slide.',
    })
    const lecture = state.lectures[0]!
    expect(lecture).toMatchObject({
      number: 1,
      file: '01 Risk.pdf',
      slides: 5,
      leftOut: [{ slide: 1, reason: 'No testable fact on this slide' }],
      dropped: [],
    })
    const risk = lecture.topics[0]!.concepts[0]!
    expect(risk).toMatchObject({
      id: 'risk-knight-1921',
      name: 'Risk (Knight 1921)',
      slides: [2],
      cards: 2,
    })
    expect(lecture.cards).toBe(
      lecture.topics.flatMap((t) => t.concepts).reduce((sum, c) => sum + c.cards, 0),
    )
  })

  it('reads the cards of one lecture with all their fields', async () => {
    const { cards } = await only(
      { type: 'cards', course: 'entrepreneurship-ws26', lecture: 1 },
      'cards',
    )
    expect(cards.length).toBe(state.lectures[0]!.cards)
    const first: CardFile = cards[0]!
    expect(first).toMatchObject({ id: '01-risk-knight-1921-definition-1', note: 'qa', slide: 2 })
    expect(first.fields).toMatchObject({
      Front: 'Risk (Knight 1921): how does the statement beginning "An outcome whose" go on?',
      Back: 'An outcome whose probability can be calculated <mark>or known</mark>',
      Source: 'Lecture 1, slide 2',
    })
    expect(cards[1]!.fields).toMatchObject({
      Role: 'reverse',
      Back: '<mark>Risk (Knight 1921)</mark>',
      Typed: '',
    })
  })

  it('shows a lecture that was added later as pending until it is built', async () => {
    await run({
      type: 'add',
      course: 'entrepreneurship-ws26',
      files: upload('03 Lean startup.pdf'),
    })
    const [summary] = (await only({ type: 'courses' }, 'courses')).courses
    expect(summary).toMatchObject({ built: [1, 2], pending: [3] })
    await run({ type: 'build', course: 'entrepreneurship-ws26' })
    const built = (await only({ type: 'course', course: 'entrepreneurship-ws26' }, 'course')).course
    expect(built.lectures.map((l) => l.number)).toEqual([1, 2, 3])
    expect(built.pending).toEqual([])
    expect(built.runs).toHaveLength(2)
    expect(
      (
        await only(
          { type: 'slide', course: 'entrepreneurship-ws26', lecture: 3, slide: 1 },
          'slide',
        )
      ).png.length,
    ).toBeGreaterThan(1000)
  })

  it('fails with a fix when a course does not exist', async () => {
    expect(await only({ type: 'course', course: 'nowhere' }, 'failed')).toEqual({
      type: 'failed',
      message: 'No course found in nowhere.',
      fix: 'Create the course first.',
    })
    expect(await only({ type: 'cards', course: 'nowhere', lecture: 1 }, 'failed')).toMatchObject({
      type: 'failed',
    })
  })

  it('keeps the store inside the library', async () => {
    expect(await only({ type: 'course', course: '../outside' }, 'failed')).toMatchObject({
      message: 'Path outside the course library: ../outside/course.json',
    })
  })
})

describe('a build that fails after the provider billed it', () => {
  it('still records the run, marked failed, with what it spent', async () => {
    const library = join(await tempRoot(), 'failing')
    const billed: ModelPort = {
      model: 'billed',
      price: { input: 0, cachedInput: 0, output: 0 },
      complete(request) {
        request.onUsage({ inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, costUsd: 0.01 })
        return Promise.reject(new EngineError('The model ran out of room.', 'Split the lecture.'))
      },
    }
    const ports = {
      store: nodeStore(library),
      pdf: pdfjsReader,
      model: billed,
      decisions: offlineDecisions(),
      anki: memoryAnki(),
      templates,
      now: Date.now,
    }
    const engine = createEngine(ports)
    const events: Event[] = []
    const emit = (event: Event) => events.push(event)
    await engine.run({ type: 'create', name: 'Failing' }, emit)
    const files = [{ name: '01 Risk.pdf', data: await makePdf(SLIDES['01 Risk.pdf']!) }]
    await engine.run({ type: 'add', course: 'failing', files }, emit)
    await engine.run({ type: 'build', course: 'failing', capUsd: 1 }, emit)
    expect(events.at(-1)).toMatchObject({ type: 'failed', message: 'The model ran out of room.' })
    await engine.run({ type: 'course', course: 'failing' }, emit)
    const { course } = events.at(-1) as Extract<Event, { type: 'course' }>
    expect(course.lectures).toEqual([])
    expect(course.runs).toMatchObject([{ run: 1, failed: true, calls: 1, costUsd: 0.01 }])
  })
})

describe('the offline model', () => {
  it('fills forms that pass the validators', async () => {
    const reply = await offlineModel().complete({
      onUsage: () => undefined,
      task: 'fill',
      system: '',
      context: '',
      images: [],
      prompt:
        'Concept: risk\nFact to test: An outcome whose probability can be calculated or known (slide 2)',
      schema: { type: 'object', properties: { question: {}, answer: {}, extra: {} } },
      effort: 'low',
    })
    const form = reply as { question: string; answer: string }
    const draft = {
      concept: 'risk',
      role: 'definition',
      slide: 2,
      front: form.question,
      answers: [form.answer],
      labels: [],
      extra: '',
      code: '',
    }
    expect(
      validateDraft(draft, { slides: [2], slideText: () => '', seenAsImage: () => false }),
    ).toEqual([])
  })

  it('can take its time, so a run can be watched', async () => {
    const started = Date.now()
    await offlineDecisions(40).decide({
      context: '',
      images: [],
      questions: [],
      onUsage: () => undefined,
    })
    expect(Date.now() - started).toBeGreaterThanOrEqual(35)
  })
})
