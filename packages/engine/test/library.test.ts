import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
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
  type DecisionsPort,
  EngineError,
  type Event,
  type ModelPort,
} from '../src/api.ts'
import { validateDraft } from '../src/cards/validate.ts'
import { ProviderError } from '../src/errors.ts'
import { SLIDES } from './fixtures.ts'
import { makePdf, tempRoot, templates } from './helpers.ts'

let root: string
const pdfs = new Map<string, Uint8Array>()
const upload = (...names: string[]) => names.map((name) => ({ name, data: pdfs.get(name)! }))

async function run(command: unknown, decisions = offlineDecisions()): Promise<Event[]> {
  let clock = 0
  const ports = {
    store: nodeStore(root),
    pdf: pdfjsReader,
    model: offlineModel(),
    decisions,
    anki: memoryAnki(),
    templates,
    now: () => (clock += 1000),
  }
  const events: Event[] = []
  await createEngine(ports).run(command, (event) => events.push(event))
  return events
}
const only = async <T extends Event['type']>(
  command: unknown,
  type: T,
  decisions?: DecisionsPort,
) => {
  const events = await run(command, decisions)
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

  it('adds PDFs to a course: a name and the bytes, sorted as lecture slides', async () => {
    const files = upload('01 Risk.pdf', '02 Effectuation.pdf')
    expect(await only({ type: 'add', course: 'entrepreneurship-ws26', files }, 'added')).toEqual({
      type: 'added',
      course: 'entrepreneurship-ws26',
      added: [
        { file: '01 Risk.pdf', to: 'slides' },
        { file: '02 Effectuation.pdf', to: 'slides' },
      ],
      left: [],
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
      await only(
        { type: 'add', course: 'entrepreneurship-ws26', files: again, to: 'slides' },
        'failed',
      ),
    ).toEqual({
      type: 'failed',
      message: 'The course already has a file named 01 Risk.pdf.',
      fix: 'Rename the new file, then add it again.',
    })
    const notes = [{ name: 'notes.pdf', data: new TextEncoder().encode('just text') }]
    expect(
      await only(
        { type: 'add', course: 'entrepreneurship-ws26', files: notes, to: 'slides' },
        'failed',
      ),
    ).toMatchObject({
      message: 'notes.pdf is not a PDF.',
    })
    expect(await only({ type: 'add', course: 'nowhere', files: again }, 'failed')).toMatchObject({
      message: 'No course found in nowhere.',
      fix: 'Create the course first.',
    })
    expect(await readdir(join(root, 'entrepreneurship-ws26/slides'))).toHaveLength(2)
  })

  it('adds the PDFs of a folder by their own names, and by their folders where names repeat', async () => {
    const files = [
      { name: 'Course/Week 1/slides.pdf', data: pdfs.get('01 Risk.pdf')! },
      { name: 'Course/Week 2/slides.pdf', data: pdfs.get('02 Effectuation.pdf')! },
      { name: 'Course/Week 2/Pivots.pdf', data: pdfs.get('04 Pivot.pdf')! },
    ]
    const { added } = await only({ type: 'add', course: 'entrepreneurship-ws26-2', files }, 'added')
    expect(added.map((a) => a.file)).toEqual([
      'Week 1 slides.pdf',
      'Week 2 slides.pdf',
      'Pivots.pdf',
    ])
  })

  it('adds past exam papers to their own folder and lists them as not read yet', async () => {
    const paper = await makePdf([
      ['Exam Winter 2025/26', '1) What is risk according to Knight (1921)?'],
    ])
    const files = [{ name: 'Winter 2025-26.pdf', data: paper }]
    expect(
      await only({ type: 'add', course: 'entrepreneurship-ws26', files, to: 'exams' }, 'added'),
    ).toEqual({
      type: 'added',
      course: 'entrepreneurship-ws26',
      added: [{ file: 'Winter 2025-26.pdf', to: 'exams' }],
      left: [],
    })
    expect(await readdir(join(root, 'entrepreneurship-ws26/exams'))).toEqual(['Winter 2025-26.pdf'])
    const course = (await only({ type: 'course', course: 'entrepreneurship-ws26' }, 'course'))
      .course
    expect(course.exams).toEqual([{ file: 'Winter 2025-26.pdf', questions: null }])
    expect(course.pending).toHaveLength(2)
    // A paper may not take the name of a lecture file, nor a lecture the name of a paper.
    const clash = [{ name: '01 Risk.pdf', data: paper }]
    expect(
      await only(
        { type: 'add', course: 'entrepreneurship-ws26', files: clash, to: 'exams' },
        'failed',
      ),
    ).toMatchObject({ message: 'The course already has a file named 01 Risk.pdf.' })
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
    expect(state.exams).toEqual([{ file: 'Winter 2025-26.pdf', questions: 1 }])
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
      // Its two cards from the slides, and the answer to the past paper's question.
      cards: 3,
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
    // The answer to the past paper's question comes first in its concept.
    expect(cards[0]!.fields).toMatchObject({
      Asked: '1x',
      Source: 'Past exams; the answer is not on the slides',
      Slide: '',
    })
    const first: CardFile = cards[1]!
    expect(first).toMatchObject({ id: '01-risk-knight-1921-definition-2', note: 'qa', slide: 2 })
    expect(first.fields).toMatchObject({
      Front: 'Risk (Knight 1921): how does the statement beginning "An outcome whose" go on?',
      Back: 'An outcome whose probability can be calculated <mark>or known</mark>',
      Source: 'Lecture 1, slide 2',
      Asked: '',
    })
    expect(cards[2]!.fields).toMatchObject({
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

describe('a whole course folder, added at once', () => {
  const course = 'messy-folder'
  const exam2019 = makePdf([['Exam 2019', '1) What is risk?']])
  const files = async () => [
    { name: 'Course/Week 1/Introduction.pdf', data: pdfs.get('01 Risk.pdf')! },
    { name: 'Course/Altklausuren/2019.pdf', data: await exam2019 },
    // The same paper a second time, under another name.
    { name: 'Course/Altklausuren/Copy of 2019.pdf', data: await exam2019 },
    {
      name: 'Course/Übungen/Blatt 1.pdf',
      data: await makePdf([['Exercise 1', 'Name three risks']]),
    },
    { name: 'Course/Scan.pdf', data: await makePdf([[]]) },
    { name: 'Course/Broken.pdf', data: new TextEncoder().encode('%PDF and then nothing') },
    { name: 'Course/notes.txt.pdf', data: new TextEncoder().encode('just text') },
    { name: 'Course/Projekt/.venv/lib/icon.pdf', data: pdfs.get('01 Risk.pdf')! },
  ]

  beforeAll(async () => {
    expect((await only({ type: 'create', name: 'Messy folder' }, 'created')).course).toBe(course)
  })

  it('takes in lecture slides and past exams, and keeps everything else out', async () => {
    expect(await only({ type: 'add', course, files: await files() }, 'added')).toEqual({
      type: 'added',
      course,
      added: [
        { file: 'Introduction.pdf', to: 'slides' },
        { file: '2019.pdf', to: 'exams' },
      ],
      left: [
        { path: 'Course/Altklausuren/Copy of 2019.pdf', why: 'already', kind: null },
        { path: 'Course/Broken.pdf', why: 'unreadable', kind: null },
        { path: 'Course/notes.txt.pdf', why: 'unreadable', kind: null },
        { path: 'Course/Übungen/Blatt 1.pdf', why: 'kind', kind: 'exercise' },
        { path: 'Course/Scan.pdf', why: 'unsure', kind: null },
      ],
    })
    expect(await readdir(join(root, course, 'slides'))).toEqual(['Introduction.pdf'])
    expect(await readdir(join(root, course, 'exams'))).toEqual(['2019.pdf'])
  })

  it('takes nothing twice when the folder is added again, and pays nothing for what it holds', async () => {
    const asked: string[] = []
    const offline = offlineDecisions()
    const counted: DecisionsPort = {
      ...offline,
      decide: (request) => {
        asked.push(request.context)
        return offline.decide(request)
      },
    }
    const { added, left } = await only(
      { type: 'add', course, files: await files() },
      'added',
      counted,
    )
    expect(added).toEqual([])
    // Only the scan, which the model could not tell before, is asked about again.
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('File: Course/Scan.pdf')
    expect(left.filter((l) => l.why === 'already').map((l) => l.path)).toEqual([
      'Course/Week 1/Introduction.pdf',
      'Course/Altklausuren/2019.pdf',
      'Course/Altklausuren/Copy of 2019.pdf',
    ])
  })

  it('moves a file without cards between lecture slides and past exams', async () => {
    expect(
      await only({ type: 'move', course, file: 'Introduction.pdf', to: 'exams' }, 'moved'),
    ).toEqual({ type: 'moved', course, file: 'Introduction.pdf', to: 'exams' })
    expect(await readdir(join(root, course, 'exams'))).toEqual(['2019.pdf', 'Introduction.pdf'])
    expect(
      await only({ type: 'move', course, file: 'Introduction.pdf', to: 'exams' }, 'failed'),
    ).toMatchObject({ message: 'The course has no lecture named Introduction.pdf.' })
  })

  it('leaves a lecture with cards where it is', async () => {
    expect(
      await only(
        { type: 'move', course: 'entrepreneurship-ws26', file: '01 Risk.pdf', to: 'exams' },
        'failed',
      ),
    ).toEqual({
      type: 'failed',
      message: '01 Risk.pdf has cards already, so it cannot move.',
      fix: 'Only a file without cards can be moved.',
    })
  })
})

describe('a sort that the decision model cannot finish', () => {
  const course = 'failing-sort'
  /** Offline decisions that fail with `error` for a file whose first pages hold `text`. */
  const failing = (text: string, error: Error): DecisionsPort => {
    const offline = offlineDecisions()
    return {
      ...offline,
      decide: (request) =>
        request.context.includes(text) ? Promise.reject(error) : offline.decide(request),
    }
  }
  const files = async () => [
    { name: 'Course/Introduction.pdf', data: pdfs.get('01 Risk.pdf')! },
    { name: 'Course/2019.pdf', data: await makePdf([['Exam 2019', '1) What is risk?']]) },
  ]

  beforeAll(async () => {
    expect((await only({ type: 'create', name: 'Failing sort' }, 'created')).course).toBe(course)
  })

  it('leaves out as unsure only the file whose request was rejected, and takes the rest', async () => {
    const rejected = new ProviderError('OpenAI rejected the request: Bad image.', '', 'rejected')
    expect(
      await only(
        { type: 'add', course, files: await files() },
        'added',
        failing('Exam 2019', rejected),
      ),
    ).toEqual({
      type: 'added',
      course,
      added: [{ file: 'Introduction.pdf', to: 'slides' }],
      left: [{ path: 'Course/2019.pdf', why: 'unsure', kind: null }],
    })
  })

  it('stops the add on a failure of the account, with nothing written', async () => {
    const key = new ProviderError('OpenAI rejected the API key.', 'Check the key.', 'key')
    const fresh = [{ name: 'Course/Lecture 2.pdf', data: pdfs.get('02 Effectuation.pdf')! }]
    expect(await only({ type: 'add', course, files: fresh }, 'failed', failing('', key))).toEqual({
      type: 'failed',
      message: 'OpenAI rejected the API key.',
      fix: 'Check the key in OPENAI_API_KEY, then add the files again.',
    })
    expect(await readdir(join(root, course, 'slides'))).toEqual(['Introduction.pdf'])
  })
})

describe('a course folder made elsewhere', () => {
  it('is never written over by a new course whose name differs only by case', async () => {
    const library = join(await tempRoot(), 'by-hand')
    const held = '{"format": 1, "name": "Econ", "goal": "good", "lectures": []}\n'
    await mkdir(join(library, 'Econ'), { recursive: true })
    await writeFile(join(library, 'Econ', 'course.json'), held)
    const events: Event[] = []
    await createEngine({
      store: nodeStore(library),
      pdf: pdfjsReader,
      model: offlineModel(),
      decisions: offlineDecisions(),
      anki: memoryAnki(),
      templates,
      now: Date.now,
    }).run({ type: 'create', name: 'Econ' }, (event) => events.push(event))
    expect(events).toEqual([{ type: 'created', course: 'econ-2' }])
    expect(await readFile(join(library, 'Econ', 'course.json'), 'utf8')).toBe(held)
  })
})

describe('a library with a damaged course', () => {
  it('lists every course, and opening the damaged one names the file', async () => {
    const library = join(await tempRoot(), 'damaged')
    const engine = createEngine({
      store: nodeStore(library),
      pdf: pdfjsReader,
      model: offlineModel(),
      decisions: offlineDecisions(),
      anki: memoryAnki(),
      templates,
      now: Date.now,
    })
    const events: Event[] = []
    const last = async (command: unknown) => {
      await engine.run(command, (event) => events.push(event))
      return events.at(-1)!
    }
    for (const name of ['Econ', 'Cut', 'Sent']) await last({ type: 'create', name })
    // A write that was cut short: a course file half written, and one left beside its target.
    await writeFile(join(library, 'cut', 'course.json'), '{"format": 1, "na')
    await writeFile(join(library, 'sent', 'anki.json'), '{"notes": {"01-')
    await writeFile(join(library, 'econ', 'course.json.0b1d.part'), '{')

    const { courses } = (await last({ type: 'courses' })) as Extract<Event, { type: 'courses' }>
    expect(courses.map((c) => [c.id, c.name])).toEqual([
      ['cut', 'cut'],
      ['econ', 'Econ'],
      ['sent', 'Sent'],
    ])
    expect(await last({ type: 'course', course: 'cut' })).toEqual({
      type: 'failed',
      message: 'The file cut/course.json in your course library is damaged and cannot be read.',
      fix: 'Restore the file from a backup, then open the course again.',
    })
    expect(await last({ type: 'course', course: 'sent' })).toMatchObject({
      message: 'The file sent/anki.json in your course library is damaged and cannot be read.',
    })
    expect(await last({ type: 'course', course: 'econ' })).toMatchObject({ type: 'course' })
  })
})

describe('a build that fails after the provider billed it', () => {
  it('still records the run, marked failed, with what it spent', async () => {
    const library = join(await tempRoot(), 'failing')
    const billed: ModelPort = {
      model: 'billed',
      price: { input: 0, cachedInput: 0, output: 0, fast: 1 },
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
    await engine.run({ type: 'add', course: 'failing', files, to: 'slides' }, emit)
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
        'Concept: risk\n\nFact to test: An outcome whose probability can be calculated or known (slide 2)\nCard type: definition. What a term means.',
      schema: {
        type: 'object',
        properties: {
          cards: {
            items: {
              anyOf: [
                {
                  properties: {
                    cardType: { enum: ['definition'] },
                    question: {},
                    answer: {},
                    extra: {},
                  },
                },
              ],
            },
          },
        },
      },
      effort: 'low',
    })
    const form = (reply as { cards: { cardType: string; question: string; answer: string }[] })
      .cards[0]!
    expect(form.cardType).toBe('definition')
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
