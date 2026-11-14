import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { nodeStore } from '../src/adapters/node-store.ts'
import { offlineDecisions, offlineModel } from '../src/adapters/offline.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import {
  createEngine,
  type CardFile,
  type CourseState,
  type CourseSummary,
  type Event,
} from '../src/api.ts'
import { validateDraft } from '../src/cards/validate.ts'
import { SLIDES } from './fixtures.ts'
import { makePdf, tempRoot } from './helpers.ts'

let root: string
let outside: string

async function run(command: unknown): Promise<Event[]> {
  let clock = 0
  const ports = {
    store: nodeStore(root),
    pdf: pdfjsReader,
    model: offlineModel(),
    decisions: offlineDecisions(),
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
    outside = await tempRoot()
    for (const [name, slides] of Object.entries(SLIDES))
      await writeFile(join(outside, name), await makePdf(slides))
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
      lectures: 0,
      cards: 0,
      pending: 0,
    }
    expect(await only({ type: 'courses' }, 'courses')).toEqual({
      type: 'courses',
      courses: [
        { ...empty, id: 'entrepreneurship-ws26', goal: 'top' },
        { ...empty, id: 'entrepreneurship-ws26-2' },
      ],
    })
  })

  it('adds PDFs from the disk to a course', async () => {
    const files = ['01 Risk.pdf', '02 Effectuation.pdf'].map((name) => join(outside, name))
    expect(await only({ type: 'add', course: 'entrepreneurship-ws26', files }, 'added')).toEqual({
      type: 'added',
      course: 'entrepreneurship-ws26',
      files: ['01 Risk.pdf', '02 Effectuation.pdf'],
    })
    expect(await readdir(join(root, 'entrepreneurship-ws26/slides'))).toEqual([
      '01 Risk.pdf',
      '02 Effectuation.pdf',
    ])
    const course = (await only({ type: 'course', course: 'entrepreneurship-ws26' }, 'course'))
      .course
    expect(course).toMatchObject({
      lectures: [],
      pending: ['01 Risk.pdf', '02 Effectuation.pdf'],
      decisions: [],
      runs: [],
    })
  })

  it('refuses a file that is no PDF or whose name the course already has, and copies nothing then', async () => {
    const again = [join(outside, '03 Lean startup.pdf'), join(outside, '01 Risk.pdf')]
    expect(
      await only({ type: 'add', course: 'entrepreneurship-ws26', files: again }, 'failed'),
    ).toEqual({
      type: 'failed',
      message: 'The course already has a file named 01 Risk.pdf.',
      fix: 'Rename the new file, then add it again.',
    })
    expect(
      await only(
        { type: 'add', course: 'entrepreneurship-ws26', files: ['/tmp/notes.docx'] },
        'failed',
      ),
    ).toMatchObject({
      message: 'notes.docx is not a PDF.',
    })
    expect(await only({ type: 'add', course: 'nowhere', files: again }, 'failed')).toMatchObject({
      message: 'No course found in nowhere.',
      fix: 'Create the course first.',
    })
    expect(await readdir(join(root, 'entrepreneurship-ws26/slides'))).toHaveLength(2)
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
      profile: { kind: 'concept', confidence: 0.9 },
      pending: [],
      runs: [{ run: 1, model: 'offline', lectures: [1, 2], costUsd: 0 }],
    })
    expect(state.decisions[0]).toEqual({
      lecture: null,
      kind: 'goal',
      text: 'Goal "top grade": every concept, up to 4 cards each.',
    })
    const lecture = state.lectures[0]!
    expect(lecture).toMatchObject({
      number: 1,
      file: '01 Risk.pdf',
      slides: 5,
      leftOut: [{ slide: 1, reason: 'Title slide' }],
      dropped: [],
    })
    const risk = lecture.topics[0]!.concepts[0]!
    expect(risk).toMatchObject({
      id: 'risk-knight-1921',
      name: 'Risk (Knight 1921)',
      slides: [2],
      core: true,
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
      Typed: 'Risk (Knight 1921)',
    })
  })

  it('shows a lecture that was added later as pending until it is built', async () => {
    await run({
      type: 'add',
      course: 'entrepreneurship-ws26',
      files: [join(outside, '03 Lean startup.pdf')],
    })
    const [summary] = (await only({ type: 'courses' }, 'courses')).courses
    expect(summary).toMatchObject({ lectures: 2, pending: 1 })
    await run({ type: 'build', course: 'entrepreneurship-ws26' })
    const built = (await only({ type: 'course', course: 'entrepreneurship-ws26' }, 'course')).course
    expect(built.lectures.map((l) => l.number)).toEqual([1, 2, 3])
    expect(built.pending).toEqual([])
    expect(built.runs).toHaveLength(2)
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

describe('the offline model', () => {
  it('fills forms that pass the validators', async () => {
    const reply = await offlineModel().complete({
      task: 'fill',
      system: '',
      context: '',
      images: [],
      prompt:
        'Concept: risk\nFact to test: An outcome whose probability can be calculated or known (slide 2)',
      schema: { type: 'object', properties: { question: {}, answer: {}, extra: {} } },
      effort: 'low',
    })
    const form = reply.data as { question: string; answer: string }
    const draft = {
      concept: 'risk',
      role: 'definition',
      slide: 2,
      front: form.question,
      answers: [form.answer],
      labels: [],
      extra: '',
      code: '',
      diagram: null,
    }
    expect(
      validateDraft(draft, { slides: [2], slideText: () => '', seenAsImage: () => false }),
    ).toEqual([])
  })
})
