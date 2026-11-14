import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import { scriptedModel, type ScriptedModel } from '../src/adapters/fake.ts'
import { nodeStore } from '../src/adapters/node-store.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import {
  createEngine,
  type CardFile,
  type CourseFile,
  type Decision,
  type Event,
  type Lecture,
  type Run,
} from '../src/api.ts'
import { script, SLIDES } from './fixtures.ts'
import { addSlides, snapshot, tempRoot } from './helpers.ts'

let root: string
let model: ScriptedModel
const json = async <T = unknown>(path: string) =>
  JSON.parse(await readFile(join(root, 'course', path), 'utf8')) as T

/** Runs one command against the course folder with the scripted model and a ticking clock. */
async function run(command: unknown): Promise<Event[]> {
  model = scriptedModel(script)
  let clock = Date.UTC(2026, 10, 14)
  const engine = createEngine({
    store: nodeStore(root),
    pdf: pdfjsReader,
    model,
    now: () => (clock += 1000),
  })
  const events: Event[] = []
  await engine.run(command, (event) => events.push(event))
  return events
}

describe('building a course of two lectures, offline', () => {
  let events: Event[]

  beforeAll(async () => {
    root = await tempRoot()
    await addSlides(root, '01 Risk.pdf', SLIDES['01 Risk.pdf']!)
    await addSlides(root, '02 Effectuation.pdf', SLIDES['02 Effectuation.pdf']!)
    events = await run({ type: 'build', course: 'course' })
  })

  it('emits the real phases in order, then the result', () => {
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
    expect(events.at(-1)).toEqual({
      type: 'built',
      lectures: [
        { number: 1, title: 'Risk and uncertainty', concepts: 2, cards: 4 },
        { number: 2, title: 'Effectuation', concepts: 2, cards: 2 },
      ],
      cards: 6,
      dropped: 1,
      costUsd: 0,
      durationMs: expect.any(Number) as number,
    })
    for (const event of events) expect(JSON.parse(JSON.stringify(event))).toEqual(event)
  })

  it('writes the course file', async () => {
    expect(await json('course.json')).toEqual({
      format: 1,
      name: 'course',
      goal: 'good',
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

  it('writes a tree of topics and concepts with slide references per lecture', async () => {
    expect(await json('lectures/01/lecture.json')).toEqual({
      number: 1,
      title: 'Risk and uncertainty',
      file: '01 Risk.pdf',
      slides: 5,
      topics: [
        {
          name: 'Knight',
          concepts: [
            { id: 'risk', name: 'risk', slides: [2, 5] },
            { id: 'uncertainty', name: 'uncertainty', slides: [3, 5] },
          ],
        },
      ],
      leftOut: [
        { slide: 1, reason: 'Title slide' },
        { slide: 4, reason: 'No readable text on this slide' },
      ],
    })
  })

  it('leaves out every unused slide with a reason, also a concept an earlier lecture covers', async () => {
    const lecture = await json<Lecture>('lectures/02/lecture.json')
    expect(lecture.topics[0]!.concepts.map((c) => c.id)).toEqual([
      'effectual-principles',
      'bird-in-hand',
    ])
    expect(lecture.leftOut).toEqual([
      { slide: 1, reason: 'Title slide' },
      { slide: 4, reason: 'Already covered in lecture 1' },
    ])
  })

  it('writes one file per card', async () => {
    expect((await readdir(join(root, 'course/lectures/01/cards'))).sort()).toEqual([
      '01-risk-definition-1.json',
      '01-risk-reverse-1.json',
      '01-uncertainty-contrast-1.json',
      '01-uncertainty-definition-1.json',
    ])
    expect((await readdir(join(root, 'course/lectures/02/cards'))).sort()).toEqual([
      '02-bird-in-hand-reverse-1.json',
      '02-effectual-principles-cloze-list-1.json',
    ])
  })

  it('fills every field of a Q&A card, with slots, typing and provenance from code', async () => {
    expect(await json('lectures/01/cards/01-uncertainty-contrast-1.json')).toEqual({
      id: '01-uncertainty-contrast-1',
      note: 'qa',
      lecture: 1,
      concept: 'uncertainty',
      slide: 5,
      fields: {
        Front: 'Risk versus uncertainty: how insurable is each?',
        Back: '<ul><li><mark>insurable</mark></li><li><mark>not insurable</mark></li></ul>',
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
        Excerpt: 'Risk: insurable Uncertainty: not insurable',
        Slide: '<img src="l01-s05.png">',
        Diagram: '',
        Key: 'uncertainty',
      },
    })
    const reverse = await json<CardFile>('lectures/01/cards/01-risk-reverse-1.json')
    expect(reverse.fields).toMatchObject({ Back: '<mark>Risk</mark>', Typed: 'risk' })
  })

  it('fills every field of a cloze card', async () => {
    const cloze = await json<CardFile>(
      'lectures/02/cards/02-effectual-principles-cloze-list-1.json',
    )
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

  it('sends a rejected card back with its problems and keeps its id through the rewording', async () => {
    const rewrites = model.requests.filter((r) => r.task === 'rewrite')
    const first = rewrites.find((r) => r.prompt.includes('Card 01-uncertainty-definition-1'))!
    expect(first.prompt).toContain(
      'front: Is uncertainty an outcome whose probability cannot be calculated?',
    )
    expect(first.prompt).toContain('- front is a yes/no question; ask what, which, why or how')
    expect(first.prompt).toContain(
      '[3] Uncertainty (Knight 1921) / An outcome whose probability cannot be calculated',
    )

    const card = await json<CardFile>('lectures/01/cards/01-uncertainty-definition-1.json')
    expect(card.fields).toMatchObject({
      Front: 'Knight (1921): what is uncertainty?',
      Back: 'An outcome whose <mark>probability cannot be calculated</mark>.',
      Extra: 'Example: a radically new product.',
    })
  })

  it('drops a card that still fails after two rewrites', async () => {
    const tries = model.requests.filter((r) =>
      r.prompt.includes('Card 02-bird-in-hand-definition-1'),
    )
    expect(tries).toHaveLength(2)
    expect(tries[1]!.prompt).toContain('- the answer has 30 words; the limit is 25')
    expect(await readdir(join(root, 'course/lectures/02/cards'))).not.toContain(
      '02-bird-in-hand-definition-1.json',
    )
  })

  it('writes the decisions taken', async () => {
    expect(await json('decisions.json')).toEqual([
      { lecture: null, kind: 'goal', text: 'Goal "good grade": up to 3 cards per concept.' },
      {
        lecture: 1,
        kind: 'left-out',
        text: 'No cards for slide 1 in 01 Risk and uncertainty: Title slide.',
      },
      {
        lecture: 1,
        kind: 'left-out',
        text: 'No cards for slide 4 in 01 Risk and uncertainty: No readable text on this slide.',
      },
      {
        lecture: 2,
        kind: 'left-out',
        text: 'No cards for slide 1 in 02 Effectuation: Title slide.',
      },
      {
        lecture: 2,
        kind: 'left-out',
        text: 'No cards for slide 4 in 02 Effectuation: Already covered in lecture 1.',
      },
      {
        lecture: 2,
        kind: 'already-covered',
        text: 'No new cards for "Risk" in 02 Effectuation: lecture 01 covers it.',
      },
      {
        lecture: 2,
        kind: 'dropped',
        text: '1 card dropped in 02 Effectuation: still failing the checks after 2 rewrites.',
      },
    ])
  })

  it('writes cost and duration of the run', async () => {
    expect(await json('runs/001.json')).toEqual({
      run: 1,
      startedAt: '2026-11-14T00:00:01.000Z',
      model: 'scripted',
      goal: 'good',
      lectures: [1, 2],
      cards: 6,
      dropped: 1,
      calls: 7,
      inputTokens: expect.any(Number) as number,
      outputTokens: expect.any(Number) as number,
      costUsd: 0,
      durationMs: expect.any(Number) as number,
      phaseMs: { read: 1000, map: 1000, write: 1000, check: 1000 },
    })
    const run = await json<Run>('runs/001.json')
    expect(run.inputTokens).toBeGreaterThan(0)
    expect(run.durationMs).toBeGreaterThan(0)
  })

  it('asks the model for JSON with a closed schema', () => {
    for (const request of model.requests) {
      expect(request.schema).toMatchObject({ type: 'object', additionalProperties: false })
      expect(JSON.stringify(request.schema)).not.toMatch(
        /\$schema|minimum|maximum|minLength|maxItems/,
      )
    }
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
        lectures: [{ number: 3, title: 'Lean startup', concepts: 1, cards: 2 }],
        cards: 2,
        dropped: 0,
      })
      expect(
        model.requests.filter((r) => r.task === 'map').map((r) => r.prompt.split('\n')[0]),
      ).toEqual(['Lecture file: 03 Lean startup.pdf'])
      expect(model.requests.every((r) => !/^Lecture 0[12] /m.test(r.prompt))).toBe(true)
    })

    it('leaves every existing lecture file byte-identical', async () => {
      const after = await snapshot(join(root, 'course/lectures'))
      expect(before.size).toBe(8)
      for (const [path, bytes] of before) expect(after.get(path)!.equals(bytes), path).toBe(true)
      const added = [...after.keys()].filter((path) => !before.has(path)).sort()
      expect(added).toEqual([
        '03/cards/03-build-measure-learn-chain-1.json',
        '03/cards/03-build-measure-learn-definition-1.json',
        '03/lecture.json',
      ])
    })

    it('tells the model which concepts the course already has', () => {
      const map = model.requests.find((r) => r.task === 'map')!
      expect(map.prompt).toContain(
        'Do not list them again: risk; uncertainty; effectual principles; bird in hand.',
      )
    })

    it('rejects a question the course already asks, across lectures', async () => {
      const rewrite = model.requests.find((r) => r.task === 'rewrite')!
      expect(rewrite.prompt).toContain(
        '- another card already asks this; ask about a different fact of the concept',
      )
      const card = await json<CardFile>(
        'lectures/03/cards/03-build-measure-learn-definition-1.json',
      )
      expect(card.fields.Front).toBe('Lean startup: what is the second step of the loop for?')
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
        cards: 2,
        calls: 3,
      })
    })

    it('does nothing when no lecture is new', async () => {
      const course = await snapshot(join(root, 'course'))
      const idle = await run({ type: 'build', course: 'course' })
      expect(idle).toEqual([
        { type: 'built', lectures: [], cards: 0, dropped: 0, costUsd: 0, durationMs: 0 },
      ])
      expect(model.requests).toEqual([])
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
      // No model can be reached at this address, so the build stops at the first model call.
      const env = {
        ...process.env,
        ANTHROPIC_API_KEY: 'test',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
      }
      const result = await promisify(execFile)('node', [cli, 'build', join(root, 'course')], {
        env,
      }).catch((error: { code: number; stdout: string }) => error)
      const lines = result.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Event)
      expect(lines.slice(0, 4)).toEqual([
        { type: 'phase', phase: 'read', status: 'started', total: 1 },
        { type: 'progress', phase: 'read', done: 1, total: 1 },
        { type: 'phase', phase: 'read', status: 'done', total: 1 },
        { type: 'phase', phase: 'map', status: 'started', total: 1 },
      ])
      expect(lines.at(-1)).toEqual({
        type: 'failed',
        message: 'Anthropic could not be reached.',
        fix: 'Check the internet connection and build again.',
      })
      expect('code' in result && result.code).toBe(1)
      expect((await json<CourseFile>('course.json')).lectures).toHaveLength(3)
    }, 30_000)
  })
})

describe('commands', () => {
  it('fails with a fix when the course has no slides', async () => {
    root = await tempRoot()
    expect(await run({ type: 'build', course: 'course' })).toEqual([
      {
        type: 'failed',
        message: 'No PDF found in course/slides.',
        fix: 'Put one PDF per lecture into the slides folder of the course.',
      },
    ])
  })

  it('rejects a command it does not know', async () => {
    const [event] = await run({ type: 'send', course: 'course' })
    expect(event).toMatchObject({
      type: 'failed',
      message: 'Lectern did not understand this command.',
    })
  })

  it('takes the goal from the first build and deepens the cards with it', async () => {
    root = await tempRoot()
    await addSlides(root, '01 Risk.pdf', SLIDES['01 Risk.pdf']!)
    await run({ type: 'build', course: 'course', goal: 'top' })
    expect((await json<CourseFile>('course.json')).goal).toBe('top')
    expect(model.requests.find((r) => r.task === 'write')!.prompt).toContain(
      '"top grade": at least one and at most 4 cards',
    )
  })
})

const OUTLINE = `# course

## 01 Risk and uncertainty

### Knight

#### risk

- Q: Knight (1921): what is risk?
  A: An outcome whose probability can be calculated or known.
- Q: Knight: which kind of outcome has a probability that can be calculated?
  A: Risk

#### uncertainty

- Q: Risk versus uncertainty: how insurable is each?
  A: Risk: insurable; Uncertainty: not insurable
- Q: Knight (1921): what is uncertainty?
  A: An outcome whose probability cannot be calculated.

## 02 Effectuation

### Principles

#### effectual principles

- Q: Sarasvathy's effectual principles: [...] [...] [...] [...] [...]
  A: bird in hand; affordable loss; crazy quilt; lemonade; pilot in the plane

#### bird in hand

- Q: Which effectual principle says to start from who you are, what you know and whom you know?
  A: Bird in hand

## 03 Lean startup

### Loop

#### build measure learn

- Q: Lean loop: which step follows build?
  A: Measure
- Q: Lean startup: what is the second step of the loop for?
  A: To measure how customers react.
`
