import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  scriptedDecisions,
  scriptedModel,
  type ScriptedDecisions,
  type ScriptedModel,
} from '../src/adapters/fake.ts'
import { memoryAnki } from '../src/adapters/memory-anki.ts'
import { nodeStore } from '../src/adapters/node-store.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import {
  createEngine,
  type Calibrations,
  type CardFile,
  type CourseFile,
  type Decision,
  type Event,
  type Lecture,
  type Run,
} from '../src/api.ts'
import { decisions, script, SLIDES } from './fixtures.ts'
import { addSlides, designs, snapshot, tempRoot } from './helpers.ts'

let root: string
let model: ScriptedModel
let decider: ScriptedDecisions

const text = (path: string) => readFile(join(root, 'course', path), 'utf8')
const json = async <T = unknown>(path: string) => JSON.parse(await text(path)) as T
const cards = async (lecture: string) =>
  parse(await text(`lectures/${lecture}/cards.yaml`)) as CardFile[]
const card = async (lecture: string, id: string) => (await cards(lecture)).find((c) => c.id === id)!

/** Runs one command against the course folder with the scripted models and a ticking clock. */
async function run(
  command: unknown,
  options: { calibrations?: Partial<Calibrations>; costPerCall?: number } = {},
) {
  model = scriptedModel(script, options.costPerCall)
  decider = scriptedDecisions(decisions)
  let clock = Date.UTC(2026, 10, 14)
  const ports = {
    store: nodeStore(root),
    pdf: pdfjsReader,
    model,
    decisions: decider,
    anki: memoryAnki(),
    designs,
    now: () => (clock += 1000),
  }
  const events: Event[] = []
  await createEngine(ports, options).run(command, (event) => events.push(event))
  return events
}

async function courseOf(...files: string[]): Promise<void> {
  root = await tempRoot()
  for (const file of files) await addSlides(root, file, SLIDES[file]!)
}

const calls = (task: string) => model.requests.filter((r) => r.task === task)
const about = (fact: string) => (r: { prompt: string }) =>
  r.prompt.includes(`Fact to test: ${fact}`)

describe('building a course of two lectures, offline', () => {
  let events: Event[]

  beforeAll(async () => {
    await courseOf('01 Risk.pdf', '02 Effectuation.pdf')
    events = await run({ type: 'build', course: 'course' })
  })

  it('emits the real phases in order, the estimate and the profile first, then the result', () => {
    const phases = events.filter((e) => e.type === 'phase').map((e) => `${e.phase} ${e.status}`)
    expect(phases).toEqual([
      'read started',
      'read done',
      'map started',
      'map done',
      'write started',
      'write done',
      'check started',
      'check done',
    ])
    expect(events.slice(0, 3)).toEqual([
      { type: 'phase', phase: 'read', status: 'started', total: 0 },
      { type: 'estimate', lectures: 2, slides: 9, cards: 14, costUsd: 0, capUsd: 0.25 },
      { type: 'profile', kind: 'concept', confidence: 0.9 },
    ])
    expect(events.at(-1)).toEqual({
      type: 'built',
      lectures: [
        { number: 1, title: 'Risk and uncertainty', concepts: 2, cards: 4 },
        { number: 2, title: 'Effectuation', concepts: 3, cards: 3 },
      ],
      cards: 7,
      dropped: 2,
      flagged: 2,
      costUsd: 0,
      durationMs: expect.any(Number) as number,
    })
    for (const event of events) expect(JSON.parse(JSON.stringify(event))).toEqual(event)
  })

  it('never reports more done than in total, also when a split adds cards', () => {
    const checks = events.filter((e) => e.type === 'progress' && e.phase === 'check')
    expect(checks.map((e) => (e.type === 'progress' ? [e.done, e.total] : []))).toEqual([
      [5, 8],
      [8, 9],
      [8, 9],
    ])
  })

  it('says which lecture a step of progress belongs to', () => {
    const steps = events.flatMap((e) =>
      e.type === 'progress' ? [`${e.phase} ${e.lecture ?? '-'}`] : [],
    )
    expect(steps.filter((step) => step.startsWith('map'))).toEqual(['map 1', 'map 2'])
    expect(new Set(steps.filter((step) => step.startsWith('write')))).toEqual(
      new Set(['write 1', 'write 2']),
    )
    expect(
      steps.filter((step) => step.startsWith('check')).every((step) => step === 'check -'),
    ).toBe(true)
  })

  it('writes the course file with the profile', async () => {
    expect(await json('course.json')).toEqual({
      format: 1,
      name: 'course',
      goal: 'good',
      profile: { kind: 'concept', confidence: 0.9 },
      lectures: [
        {
          number: 1,
          title: 'Risk and uncertainty',
          file: '01 Risk.pdf',
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
          slides: 5,
        },
        {
          number: 2,
          title: 'Effectuation',
          file: '02 Effectuation.pdf',
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
          slides: 4,
        },
      ],
    })
  })

  it('writes a tree of topics, concepts and facts with slide references and kinds', async () => {
    const lecture = await json<Lecture>('lectures/01/lecture.json')
    expect(lecture).toMatchObject({
      number: 1,
      title: 'Risk and uncertainty',
      file: '01 Risk.pdf',
      slides: 5,
      dropped: [],
    })
    expect(lecture.topics).toEqual([
      {
        name: 'Knight',
        concepts: [
          {
            id: 'risk',
            name: 'risk',
            slides: [2],
            core: true,
            facts: [
              {
                text: 'Risk is an outcome whose probability can be calculated or known.',
                slide: 2,
                kind: 'definition',
              },
              {
                text: 'An outcome with a calculable probability is called risk.',
                slide: 2,
                kind: 'definition',
              },
              { text: 'Opening a hairdresser shop is an example of risk.', slide: 2, kind: 'case' },
            ],
          },
          {
            id: 'uncertainty',
            name: 'uncertainty',
            slides: [3, 5],
            core: false,
            facts: [
              {
                text: 'Uncertainty is an outcome whose probability cannot be calculated.',
                slide: 3,
                kind: 'definition',
              },
              { text: 'Risk can be insured, uncertainty cannot.', slide: 5, kind: 'contrast' },
            ],
          },
        ],
      },
    ])
  })

  it('leaves out every unused slide, with the kind of slide as the reason', async () => {
    expect((await json<Lecture>('lectures/01/lecture.json')).leftOut).toEqual([
      { slide: 1, reason: 'Title slide' },
      { slide: 4, reason: 'Agenda slide' },
    ])
  })

  it('plans the cards in code: two facts per concept for a good grade, the card type from the kind of fact', async () => {
    expect((await cards('01')).map((c) => c.id)).toEqual([
      '01-risk-definition-1',
      '01-risk-reverse-1',
      '01-uncertainty-definition-1',
      '01-uncertainty-contrast-1',
    ])
    expect(calls('fill')).toHaveLength(8)
    expect(calls('fill').some(about('Opening a hairdresser shop is an example of risk.'))).toBe(
      false,
    )
  })

  it('writes one readable YAML file per lecture', async () => {
    expect((await readdir(join(root, 'course/lectures/01'))).sort()).toEqual([
      'cards.yaml',
      'lecture.json',
    ])
    expect((await text('lectures/01/cards.yaml')).split('\n').slice(0, 8)).toEqual([
      '- id: 01-risk-definition-1',
      '  note: qa',
      '  concept: risk',
      '  slide: 2',
      '  fields:',
      '    Front: "Knight (1921): what is risk?"',
      '    Back: An outcome with a <mark>probability that is known</mark> or can be worked out.',
      '    Role: definition',
    ])
  })

  it('fills every field of a Q&A card, with slots, typing and provenance from code', async () => {
    expect(await card('01', '01-uncertainty-contrast-1')).toEqual({
      id: '01-uncertainty-contrast-1',
      note: 'qa',
      concept: 'uncertainty',
      slide: 5,
      fields: {
        Front: 'Risk versus uncertainty: how insurable is each?',
        Back: '<ul><li><mark>can be insured</mark></li><li><mark>cannot be insured</mark></li></ul>',
        Role: 'contrast',
        Slots: '<span>Risk</span><span>Uncertainty</span>',
        Code: '',
        Typed: '',
        Lecture: '01',
        Topic: 'Risk and uncertainty',
        Source: 'Lecture 1, slide 5',
        Asked: '',
        Part: '',
        Extra: '',
        Excerpt: 'Uncertainty cannot be insured because nobody can price it',
        Slide: '<img src="l01-s05.png">',
        Diagram: '',
        Key: 'uncertainty',
      },
    })
    expect((await card('01', '01-risk-reverse-1')).fields).toMatchObject({
      Back: '<mark>Risk</mark>',
      Typed: 'risk',
    })
  })

  it('fills every field of a cloze card', async () => {
    const cloze = await card('02', '02-effectual-principles-cloze-list-1')
    expect(cloze.note).toBe('cloze')
    expect(cloze.fields).toEqual({
      Text:
        "Sarasvathy's effectual principles:<ul><li>{{c1::bird in hand}}</li><li>{{c2::affordable loss}}</li>" +
        '<li>{{c3::crazy quilt}}</li><li>{{c4::lemonade}}</li><li>{{c5::pilot in the plane}}</li></ul>',
      Role: 'cloze-list',
      Typed: '',
      Lecture: '02',
      Topic: 'Effectuation',
      Source: 'Lecture 2, slide 2',
      Asked: '',
      Part: '',
      Extra: '',
      Excerpt: 'Bird in hand Affordable loss',
      Slide: '<img src="l02-s02.png">',
      Diagram: '',
      Key: 'effectual principles',
    })
  })

  it('shows the model the whole lecture for every card, and slides with little text as pictures', () => {
    const [first, second] = calls('map')
    expect(first!.images.map((image) => image.slide)).toEqual([1, 4])
    expect(first!.images[0]!.png.startsWith('iVBORw0KGgo')).toBe(true)
    expect(first!.context).toContain(
      '[1] Entrepreneurship / Lecture 1: Risk and uncertainty (see the picture of this slide)',
    )
    expect(second!.images.map((image) => image.slide)).toEqual([1])
    for (const fill of calls('fill')) {
      expect(fill.context).toMatch(/^Lecture 0[12] /)
      expect(fill.context).toContain('[2] ')
      expect(fill.effort).toBe('low')
    }
  })

  it('gives the model one small form per card type, with the limits and an example', () => {
    const fill = calls('fill').find(about('Risk can be insured, uncertainty cannot.'))!
    expect(Object.keys((fill.schema as { properties: object }).properties)).toEqual([
      'question',
      'sideA',
      'valueA',
      'sideB',
      'valueB',
      'extra',
    ])
    expect(JSON.stringify(fill.schema)).toContain('At most 20 words. Never a yes/no question.')
    expect(fill.prompt).toContain('Concept: uncertainty')
    expect(fill.prompt).toContain('Card type: contrast.')
    expect(fill.prompt).toContain('An example of this card type, from another course:')
    for (const request of model.requests) {
      expect(request.schema).toMatchObject({ type: 'object', additionalProperties: false })
      expect(JSON.stringify(request.schema)).not.toMatch(
        /\$schema|minimum|maximum|minLength|maxItems/,
      )
    }
  })

  it('repairs a rejected card with the full list of problems, and the card keeps its id', async () => {
    const repair = calls('repair').find(
      about('Uncertainty is an outcome whose probability cannot be calculated.'),
    )!
    expect(repair.prompt).toContain(
      '"question":"Is uncertainty an outcome whose probability cannot be calculated?"',
    )
    expect(repair.prompt).toContain('- front is a yes/no question; ask what, which, why or how')
    expect((await card('01', '01-uncertainty-definition-1')).fields).toMatchObject({
      Front: 'Knight (1921): what is uncertainty?',
      Back: 'An outcome whose <mark>probability cannot be calculated</mark>.',
      Extra: 'Example: a radically new product.',
    })
  })

  it('splits a card that is too long into atomic cards, each gated again', async () => {
    const [split] = calls('split')
    expect(calls('split')).toHaveLength(1)
    expect(split!.prompt).toContain('- the answer has 33 words; the limit is 25')
    expect(
      (await cards('02'))
        .filter((c) => c.concept === 'bird-in-hand')
        .map((c) => [c.id, c.fields.Front]),
    ).toEqual([
      ['02-bird-in-hand-definition-1', 'Bird in hand: what does a founder start from?'],
      ['02-bird-in-hand-definition-2', 'Bird in hand: what does a founder put first?'],
    ])
  })

  it('drops what still fails after two repairs, and a question the course already asks, and lists both', async () => {
    const tries = calls('repair').filter(
      about('Under bird in hand, means come first and goals follow.'),
    )
    expect(tries).toHaveLength(2)
    expect((await json<Lecture>('lectures/02/lecture.json')).dropped).toEqual([
      {
        concept: 'bird in hand',
        role: 'reverse',
        front: 'Which principle puts means before goals?',
        problems: ['the answer must be one term of at most 5 words'],
      },
      {
        concept: 'risk',
        role: 'definition',
        front: 'Knight (1921): what is risk?',
        problems: ['asks the same question as 01-risk-definition-1'],
      },
    ])
  })

  it('keeps one vocabulary: a concept that comes up again takes its name and gets one more card', async () => {
    const again = (await json<Lecture>('lectures/02/lecture.json')).topics[0]!.concepts[2]!
    expect(again).toMatchObject({ id: 'risk', name: 'risk', since: 1 })
    expect(
      calls('fill').filter(about('Risk is an outcome whose probability can be calculated.')),
    ).toHaveLength(1)
  })

  it('flags what an uncalibrated check notices, and keeps the card', async () => {
    expect((await cards('02')).map((c) => [c.id, c.flags])).toEqual([
      ['02-effectual-principles-cloze-list-1', undefined],
      ['02-bird-in-hand-definition-1', ['copies a long run of slide text']],
      ['02-bird-in-hand-definition-2', ['looks like 02-bird-in-hand-definition-1']],
    ])
    expect((await cards('01')).every((c) => c.flags === undefined)).toBe(true)
  })

  it('asks every closed question through the decisions port, batched per shared input', () => {
    const shape = decider.requests
      .filter((r) => !r.context.startsWith('A flashcard written'))
      .map((r) => [r.context.split('\n')[0], r.questions.length])
    expect(shape).toEqual([
      [expect.stringContaining('Entrepreneurship') as string, 1],
      ['Lecture file: 01 Risk.pdf', 5],
      ['Lecture file: 02 Effectuation.pdf', 4],
      ['Lecture file: 01 Risk.pdf', 7],
      ['Lecture file: 02 Effectuation.pdf', 7],
      ['Flashcards of one university course.', 2],
    ])
    expect(decider.requests[1]!.images.map((image) => image.slide)).toEqual([1, 4])
  })

  it('writes the decisions taken', async () => {
    expect(await json('decisions.json')).toEqual([
      {
        lecture: null,
        kind: 'goal',
        text: 'Goal "good grade": every concept, up to 2 cards each.',
      },
      {
        lecture: null,
        kind: 'profile',
        text: 'Read as a concept course. Cards follow the "concept" preset.',
      },
      {
        lecture: 1,
        kind: 'left-out',
        text: 'No cards for slide 1 in 01 Risk and uncertainty: title slide.',
      },
      {
        lecture: 1,
        kind: 'left-out',
        text: 'No cards for slide 4 in 01 Risk and uncertainty: agenda slide.',
      },
      {
        lecture: 2,
        kind: 'left-out',
        text: 'No cards for slide 1 in 02 Effectuation: title slide.',
      },
      {
        lecture: 2,
        kind: 'recurring',
        text: '"risk" comes up again in 02 Effectuation: one more card on top of lecture 01.',
      },
      {
        lecture: 2,
        kind: 'no-card',
        text: 'No card in 02 Effectuation for "risk": no card passed the checks.',
      },
      {
        lecture: 2,
        kind: 'dropped',
        text: '2 cards dropped in 02 Effectuation. The reasons are listed with the lecture.',
      },
    ])
  })

  it('writes cost and duration of the run', async () => {
    const run = await json<Run>('runs/001.json')
    expect(run).toEqual({
      run: 1,
      startedAt: '2026-11-14T00:00:01.000Z',
      model: 'scripted',
      decisionModel: 'scripted-decisions',
      preset: 'concept',
      goal: 'good',
      lectures: [1, 2],
      cards: 7,
      dropped: 2,
      calls: 14,
      decisions: 34,
      inputTokens: expect.any(Number) as number,
      cachedInputTokens: 0,
      outputTokens: expect.any(Number) as number,
      estimateUsd: 0,
      costUsd: 0,
      durationMs: expect.any(Number) as number,
      phaseMs: { read: 1000, map: 1000, write: 1000, check: 1000 },
    })
    expect(run.inputTokens).toBeGreaterThan(0)
    expect(run.durationMs).toBeGreaterThan(0)
  })

  describe('adding a lecture and building again', () => {
    let before: Map<string, Buffer>
    let decisionsBefore: Decision[]
    let again: Event[]

    beforeAll(async () => {
      before = await snapshot(join(root, 'course/lectures'))
      decisionsBefore = await json<Decision[]>('decisions.json')
      await addSlides(root, '03 Lean startup.pdf', SLIDES['03 Lean startup.pdf']!)
      again = await run({ type: 'build', course: 'course' })
    })

    it('builds only the new lecture', () => {
      expect(again.at(-1)).toMatchObject({
        type: 'built',
        lectures: [{ number: 3, title: 'Lean startup', concepts: 2, cards: 3 }],
        cards: 3,
        dropped: 0,
        flagged: 2,
      })
      expect(model.requests.every((r) => /^Lecture (file: 03|03) /.test(r.context))).toBe(true)
    })

    it('leaves every existing lecture file byte-identical', async () => {
      const after = await snapshot(join(root, 'course/lectures'))
      expect([...before.keys()].sort()).toEqual([
        '01/cards.yaml',
        '01/lecture.json',
        '02/cards.yaml',
        '02/lecture.json',
      ])
      for (const [path, bytes] of before) expect(after.get(path)!.equals(bytes), path).toBe(true)
      expect([...after.keys()].filter((path) => !before.has(path)).sort()).toEqual([
        '03/cards.yaml',
        '03/lecture.json',
      ])
    })

    it('tells the model the vocabulary of the course', () => {
      expect(calls('map')[0]!.prompt).toContain(
        'use exactly that name: risk; uncertainty; effectual principles; bird in hand.',
      )
    })

    it('does not ask for the profile again', () => {
      expect(again.find((e) => e.type === 'profile')).toEqual({
        type: 'profile',
        kind: 'concept',
        confidence: 0.9,
      })
      expect(decider.requests[0]!.questions[0]).toMatchObject({
        ask: expect.stringContaining('What kind of slide') as string,
      })
    })

    it('flags a concept the checks doubt, and keeps it', async () => {
      const doubted = (await json<Lecture>('lectures/03/lecture.json')).topics[0]!.concepts[1]!
      expect(doubted).toMatchObject({
        id: 'entrepreneurial-risk',
        flags: ['may not belong to this lecture', 'may be the same as "risk" from lecture 01'],
      })
      expect(doubted.since).toBeUndefined()
    })

    it('sends a card to the decision model when the free slide check is not sure, and flags a no', async () => {
      const asked = decider.requests
        .flatMap((r) => r.questions)
        .filter((q) => q.type === 'predicate' && q.statement.startsWith('Slide'))
      expect(asked).toEqual([
        {
          type: 'predicate',
          statement:
            'Slide 2 supports this flashcard. Question: Lean startup: how does it lower risk? Answer: By trying ideas out before spending much.',
        },
      ])
      expect((await card('03', '03-entrepreneurial-risk-definition-1')).flags).toEqual([
        'the answer may not be on its slide',
      ])
    })

    it('flags a card that may test the same thing as a card of an earlier lecture', async () => {
      expect((await card('03', '03-build-measure-learn-definition-1')).flags).toEqual([
        'may test the same thing as 01-uncertainty-definition-1',
      ])
    })

    it('appends to the course file, the decisions and the runs', async () => {
      expect((await json<CourseFile>('course.json')).lectures.map((l) => l.number)).toEqual([
        1, 2, 3,
      ])
      expect((await json<Decision[]>('decisions.json')).slice(0, decisionsBefore.length)).toEqual(
        decisionsBefore,
      )
      expect(await json('runs/002.json')).toMatchObject({
        run: 2,
        lectures: [3],
        cards: 3,
        calls: 4,
      })
    })

    it('does nothing when no lecture is new', async () => {
      const course = await snapshot(join(root, 'course'))
      const idle = await run({ type: 'build', course: 'course' })
      expect(idle.at(-1)).toEqual({
        type: 'built',
        lectures: [],
        cards: 0,
        dropped: 0,
        flagged: 0,
        costUsd: 0,
        durationMs: 0,
      })
      expect(model.requests).toEqual([])
      expect(decider.requests).toEqual([])
      expect(await snapshot(join(root, 'course'))).toEqual(course)
    })

    it('exports the course as a Markdown outline', async () => {
      const [event] = await run({ type: 'outline', course: 'course' })
      expect(event).toEqual({ type: 'outline', markdown: OUTLINE })
    })

    it('prints the outline from the command line', async () => {
      const cli = join(import.meta.dirname, '../src/cli.ts')
      const { stdout } = await promisify(execFile)('node', [cli, 'outline', join(root, 'course')])
      expect(stdout).toBe(OUTLINE)
    })

    it('prints events as JSON lines from the command line and names the fix on failure', async () => {
      const cli = join(import.meta.dirname, '../src/cli.ts')
      await addSlides(root, '04 Teams.pdf', [['Teams', 'Founders and early hires']])
      // Nothing can be reached at this address, so the build stops at its first paid call.
      const env = { ...process.env, OPENAI_API_KEY: 'test', OPENAI_BASE_URL: 'http://127.0.0.1:1' }
      const result = await promisify(execFile)('node', [cli, 'build', join(root, 'course')], {
        env,
      }).catch((error: { code: number; stdout: string }) => error)
      const lines = result.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Event)
      expect(lines.slice(0, 3)).toMatchObject([
        { type: 'phase', phase: 'read', status: 'started' },
        { type: 'estimate', lectures: 1, slides: 1 },
        { type: 'profile', kind: 'concept' },
      ])
      expect(lines.at(-1)).toEqual({
        type: 'failed',
        message: 'OpenAI could not be reached.',
        fix: 'Check the internet connection and build again.',
      })
      expect('code' in result && result.code).toBe(1)
      expect((await json<CourseFile>('course.json')).lectures).toHaveLength(3)
    }, 30_000)
  })
})

describe('calibrated checks act instead of flagging', () => {
  const measured = { calibrated: true, threshold: 0.5 }
  let events: Event[]

  beforeAll(async () => {
    await courseOf('01 Risk.pdf', '02 Effectuation.pdf', '03 Lean startup.pdf')
    events = await run(
      { type: 'build', course: 'course' },
      { calibrations: { sameConcept: measured, supported: measured, sameCard: measured } },
    )
  })

  it('merges a concept the decision model calls the same as an earlier one', async () => {
    const merged = (await json<Lecture>('lectures/03/lecture.json')).topics[0]!.concepts[1]!
    expect(merged).toMatchObject({
      id: 'risk',
      name: 'risk',
      since: 1,
      flags: ['may not belong to this lecture'],
    })
  })

  it('sends a card the slide does not support back for repair', async () => {
    const repair = calls('repair').find(about('Lean startup lowers risk by testing early.'))!
    expect(repair.prompt).toContain(
      '- slide 2 does not support this answer; take the answer from the slide',
    )
    const repaired = await card('03', '03-risk-definition-1')
    expect(repaired.fields.Back).toBe(
      'By building a <mark>minimum viable product</mark> and measuring how customers react.',
    )
    expect(repaired.flags).toBeUndefined()
  })

  it('drops a card that tests the same thing as another, and still only flags a near twin', async () => {
    expect((await json<Lecture>('lectures/03/lecture.json')).dropped).toEqual([
      {
        concept: 'build measure learn',
        role: 'definition',
        front: 'Knight (1921): what is uncertainty exactly?',
        problems: ['tests the same thing as 01-uncertainty-definition-1'],
      },
    ])
    expect((await card('02', '02-bird-in-hand-definition-2')).flags).toEqual([
      'looks like 02-bird-in-hand-definition-1',
    ])
    expect(events.at(-1)).toMatchObject({ cards: 9, dropped: 3, flagged: 2 })
  })
})

describe('the card check and the rules on what a card says', () => {
  let events: Event[]

  beforeAll(async () => {
    await courseOf('04 Pivot.pdf')
    events = await run({ type: 'build', course: 'course' })
  })

  it('asks about each card with that card as the whole input, never the lecture', () => {
    const asked = decider.requests.filter((r) => r.context.startsWith('A flashcard written'))
    expect(asked.every((r) => r.questions.length === 1 && r.images.length === 0)).toBe(true)
    expect(asked[0]!.context).toBe(
      'A flashcard written from the slides of a university course.\n' +
        'Question: When does the exam take place?\nAnswer: On 11 February.',
    )
  })

  it('drops a card about the organisation of the course at once, without a repair', async () => {
    expect(calls('repair').filter(about('The exam takes place on 11 February.'))).toHaveLength(0)
    expect((await json<Lecture>('lectures/04/lecture.json')).dropped).toContainEqual({
      concept: 'exam',
      role: 'definition',
      front: 'When does the exam take place?',
      problems: ['is about the organisation of the course, not its subject'],
    })
  })

  it('sends a question that leans on the slides back to be reworded', async () => {
    const repair = calls('repair').find(
      about('A pivot changes the strategy and keeps the vision.'),
    )!
    expect(repair.prompt).toContain(
      '- the question refers to the slides or the session; ask about the subject itself',
    )
    expect((await card('04', '04-pivot-definition-1')).fields.Front).toBe(
      'Lean startup: what does a pivot change?',
    )
  })

  it('drops a card whose answer only turns the question around, after two repairs', async () => {
    expect(
      calls('repair').filter(about('A venture perseveres when its numbers improve.')),
    ).toHaveLength(2)
    expect((await json<Lecture>('lectures/04/lecture.json')).dropped).toContainEqual({
      concept: 'persevere',
      role: 'definition',
      front: 'When does a venture persevere?',
      problems: ['the answer only repeats the question; say what the slide adds'],
    })
    expect(events.at(-1)).toMatchObject({ cards: 1, dropped: 2, flagged: 0 })
  })

  it('only flags the card when the check counts as unmeasured', async () => {
    await courseOf('04 Pivot.pdf')
    await run(
      { type: 'build', course: 'course' },
      { calibrations: { organisation: { calibrated: false, threshold: 0.2 } } },
    )
    expect((await cards('04')).map((c) => [c.id, c.flags])).toEqual([
      ['04-exam-definition-1', ['may be about the organisation of the course']],
      ['04-pivot-definition-1', undefined],
    ])
  })
})

describe('goal, profile and cost', () => {
  it('pass: cards for the core concepts only, one each, and says which concepts it skipped', async () => {
    await courseOf('01 Risk.pdf')
    await run({ type: 'build', course: 'course', goal: 'pass' })
    expect((await json<CourseFile>('course.json')).goal).toBe('pass')
    expect((await cards('01')).map((c) => c.id)).toEqual(['01-risk-definition-1'])
    expect(await json<Decision[]>('decisions.json')).toEqual(
      expect.arrayContaining([
        { lecture: null, kind: 'goal', text: 'Goal "pass": the core concepts, one card each.' },
        {
          lecture: 1,
          kind: 'outside-core',
          text: 'No cards in 01 Risk and uncertainty for "uncertainty": outside the core, and the goal is to pass.',
        },
      ]),
    )
  })

  it('top grade: more facts per concept, and every case', async () => {
    await courseOf('01 Risk.pdf')
    await run({ type: 'build', course: 'course', goal: 'top' })
    expect((await cards('01')).map((c) => c.id)).toEqual([
      '01-risk-definition-1',
      '01-risk-reverse-1',
      '01-risk-case-1',
      '01-uncertainty-definition-1',
      '01-uncertainty-contrast-1',
    ])
    expect((await card('01', '01-risk-case-1')).fields).toMatchObject({
      Back: '<mark>risk</mark>',
      Typed: 'risk',
    })
  })

  it('takes the kind of course from the student when the command names it', async () => {
    await courseOf('01 Risk.pdf')
    const events = await run({ type: 'build', course: 'course', profile: 'formula' })
    expect(events.find((e) => e.type === 'profile')).toEqual({
      type: 'profile',
      kind: 'formula',
      confidence: null,
    })
    expect((await json<CourseFile>('course.json')).profile).toEqual({
      kind: 'formula',
      confidence: null,
    })
    expect(
      decider.requests
        .flatMap((r) => r.questions)
        .some((q) => q.type === 'choice' && q.ask.startsWith('Which kind of course')),
    ).toBe(false)
  })

  it('writes a concept course with the concept preset: its rules reach the map and the cards', async () => {
    await courseOf('01 Risk.pdf')
    await run({ type: 'build', course: 'course' })
    expect(calls('map')[0]!.prompt).toContain(
      '- Only what can be examined is a concept. The organisation of the course is never one',
    )
    const fill = calls('fill')[0]!
    expect(fill.prompt).toContain('- Lead with the answer: the key term comes first')
    expect(fill.prompt).toContain('"question":"Sarasvathy: what is causation?"')
  })

  it('writes with another preset when the command names it', async () => {
    await courseOf('01 Risk.pdf')
    await run({ type: 'build', course: 'course', preset: 'placeholder' })
    expect(calls('map')[0]!.prompt).not.toContain('The organisation of the course is never one')
    expect(await json<Run>('runs/001.json')).toMatchObject({ preset: 'placeholder' })
    expect(await json<Decision[]>('decisions.json')).toContainEqual({
      lecture: null,
      kind: 'profile',
      text: 'Read as a concept course. Cards follow the "placeholder" preset.',
    })
  })

  it('estimates a build without calling a model', async () => {
    await courseOf('01 Risk.pdf', '02 Effectuation.pdf')
    expect(await run({ type: 'estimate', course: 'course', goal: 'top' })).toEqual([
      { type: 'estimate', lectures: 2, slides: 9, cards: 18, costUsd: 0, capUsd: 0.25 },
    ])
    expect(model.requests).toEqual([])
    expect(decider.requests).toEqual([])
    expect(await readdir(join(root, 'course'))).toEqual(['slides'])
  })

  it('takes a spending limit from the command instead of its own cap', async () => {
    await courseOf('01 Risk.pdf')
    const events = await run(
      { type: 'build', course: 'course', capUsd: 0.1 },
      { costPerCall: 0.06 },
    )
    expect(events.find((e) => e.type === 'estimate')).toMatchObject({ capUsd: 0.1 })
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      message: 'The run was stopped at 0.12 dollars, above its cap of 0.10 dollars.',
    })
  })

  it('stops a build whose real cost passes the cap, starts no further call and saves nothing', async () => {
    await courseOf('01 Risk.pdf')
    const events = await run({ type: 'build', course: 'course', goal: 'top' }, { costPerCall: 0.2 })
    expect(events.at(-1)).toEqual({
      type: 'failed',
      message: 'The run was stopped at 0.40 dollars, above its cap of 0.25 dollars.',
      fix: 'Nothing was saved. Build again, or build fewer lectures at once.',
    })
    // One map call, then the four card calls that were already under way. The fifth card never starts.
    expect(model.requests.map((r) => r.task)).toEqual(['map', 'fill', 'fill', 'fill', 'fill'])
    expect(await readdir(join(root, 'course'))).toEqual(['slides'])
  })
})

describe('commands', () => {
  it('fails with a fix when the course has no slides', async () => {
    root = await tempRoot()
    expect((await run({ type: 'build', course: 'course' })).at(-1)).toEqual({
      type: 'failed',
      message: 'No PDF found in course/slides.',
      fix: 'Put one PDF per lecture into the slides folder of the course.',
    })
  })

  it('rejects a command it does not know', async () => {
    const [event] = await run({ type: 'send', course: 'course' })
    expect(event).toMatchObject({
      type: 'failed',
      message: 'Lectern did not understand this command.',
    })
  })
})

const OUTLINE = `# course

## 01 Risk and uncertainty

### Knight

#### risk

- Q: Knight (1921): what is risk?
  A: An outcome with a probability that is known or can be worked out.
- Q: Knight: which kind of outcome has a probability that can be calculated?
  A: Risk

#### uncertainty

- Q: Knight (1921): what is uncertainty?
  A: An outcome whose probability cannot be calculated.
- Q: Risk versus uncertainty: how insurable is each?
  A: Risk: can be insured; Uncertainty: cannot be insured

## 02 Effectuation

### Principles

#### effectual principles

- Q: Sarasvathy's effectual principles: [...] [...] [...] [...] [...]
  A: bird in hand; affordable loss; crazy quilt; lemonade; pilot in the plane

#### bird in hand

- Q: Bird in hand: what does a founder start from?
  A: From who you are, what you know and whom you know.
- Q: Bird in hand: what does a founder put first?
  A: The means; goals follow from the means at hand.

#### risk

## 03 Lean startup

### Loop

#### build measure learn

- Q: Lean loop: which step follows build?
  A: Measure
- Q: Knight (1921): what is uncertainty exactly?
  A: A minimum viable product is built.

#### entrepreneurial risk

- Q: Lean startup: how does it lower risk?
  A: By trying ideas out before spending much.
`
