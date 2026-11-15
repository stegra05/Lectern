import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CourseFile, Decision, Event, Lecture, Run } from '../src/api.ts'
import { SLIDES } from './fixtures.ts'
import { pipeline } from './harness.ts'
import { addSlides, snapshot } from './helpers.ts'

const h = pipeline()
const { courseOf, run, json, cards, card, calls, about, text } = h

describe('building a course of two lectures, offline', () => {
  let events: Event[]

  beforeAll(async () => {
    await courseOf('01 Risk.pdf', '02 Effectuation.pdf')
    events = await run({ type: 'build', course: 'course' })
  })

  it('emits the real phases in order, the estimate first, then the result', () => {
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
    expect(events.slice(0, 2)).toEqual([
      { type: 'phase', phase: 'read', status: 'started', total: 0 },
      {
        type: 'estimate',
        lectures: 2,
        slides: 9,
        cards: 9,
        costUsd: 0,
        costEur: 0,
        capUsd: 0.25,
      },
    ])
    expect(events.at(-1)).toEqual({
      type: 'built',
      lectures: [
        { number: 1, title: 'Risk and uncertainty', concepts: 2, cards: 5 },
        { number: 2, title: 'Effectuation', concepts: 3, cards: 3 },
      ],
      cards: 8,
      dropped: 2,
      costUsd: 0,
      durationMs: expect.any(Number) as number,
    })
    for (const event of events) expect(JSON.parse(JSON.stringify(event))).toEqual(event)
  })

  it('never reports more done than in total, also when a split adds cards', () => {
    const checks = events.filter((e) => e.type === 'progress' && e.phase === 'check')
    expect(checks.map((e) => (e.type === 'progress' ? [e.done, e.total] : []))).toEqual([
      [6, 9],
      [9, 10],
      [9, 10],
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
            facts: [
              {
                text: 'Risk is an outcome whose probability can be calculated or known.',
                slide: 2,
                kind: 'definition',
                worth: 2,
              },
              {
                text: 'An outcome with a calculable probability is called risk.',
                slide: 2,
                kind: 'definition',
                worth: 2,
              },
              {
                text: 'Opening a hairdresser shop is an example of risk.',
                slide: 2,
                kind: 'case',
                worth: 2,
              },
            ],
          },
          {
            id: 'uncertainty',
            name: 'uncertainty',
            slides: [3, 5],
            facts: [
              {
                text: 'Uncertainty is an outcome whose probability cannot be calculated.',
                slide: 3,
                kind: 'definition',
                worth: 2,
              },
              {
                text: 'Risk can be insured, uncertainty cannot.',
                slide: 5,
                kind: 'contrast',
                worth: 2,
              },
            ],
          },
        ],
      },
    ])
  })

  it('leaves out every unused slide, with the reason', async () => {
    expect((await json<Lecture>('lectures/01/lecture.json')).leftOut).toEqual([
      { slide: 1, reason: 'No testable fact on this slide' },
      { slide: 4, reason: 'No testable fact on this slide' },
    ])
  })

  it('plans the cards in code: one per slide at most for a good grade, the card type from the kind of fact', async () => {
    expect((await cards('01')).map((c) => c.id)).toEqual([
      '01-risk-definition-1',
      '01-risk-reverse-1',
      '01-risk-case-1',
      '01-uncertainty-definition-1',
      '01-uncertainty-contrast-1',
    ])
    expect(calls('fill')).toHaveLength(9)
  })

  it('reads every slide on its own with its picture, then sorts what it found in one call per lecture', () => {
    // Five slides in lecture 1, four in lecture 2.
    expect(calls('read')).toHaveLength(9)
    const second = calls('read')[1]!
    expect(second.shown!.map((image) => image.slide)).toEqual([2])
    expect(second.images).toEqual([])
    expect(second.prompt).toMatch(/^Read slide 2 of this lecture\./)
    expect(calls('map')).toHaveLength(2)
    expect(calls('map')[0]!.prompt).toContain(
      'F1 (slide 2) risk: Risk is an outcome whose probability can be calculated or known.',
    )
  })

  it('asks how much each fact is worth, each fact as the whole input of its own request', () => {
    const asked = h.decider.requests.filter((r) => r.context.startsWith('One fact taken'))
    expect(asked).toHaveLength(9)
    expect(asked[0]!.context.split('\n').slice(1)).toEqual([
      'Concept: risk',
      'Fact: Risk is an outcome whose probability can be calculated or known.',
    ])
    expect(asked.every((r) => r.questions.length === 1 && r.questions[0]!.type === 'score')).toBe(
      true,
    )
  })

  it('writes one readable YAML file per lecture', async () => {
    expect((await readdir(join(h.root, 'course/lectures/01'))).sort()).toEqual([
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
      Typed: '',
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
    for (const request of h.model.requests) {
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

  it('writes the decisions taken', async () => {
    expect(await json('decisions.json')).toEqual([
      {
        lecture: null,
        kind: 'goal',
        text: 'Goal "good grade": the facts worth most get a card, at most 1 per slide.',
      },
      {
        lecture: 1,
        kind: 'left-out',
        text: 'No cards for slides 1 and 4 in 01 Risk and uncertainty: no testable fact on this slide.',
      },
      {
        lecture: 2,
        kind: 'left-out',
        text: 'No cards for slide 1 in 02 Effectuation: no testable fact on this slide.',
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
      goal: 'good',
      lectures: [1, 2],
      cards: 8,
      dropped: 2,
      calls: 24,
      decisions: 27,
      inputTokens: expect.any(Number) as number,
      cachedInputTokens: 0,
      outputTokens: expect.any(Number) as number,
      estimateUsd: 0,
      costUsd: 0,
      costEur: 0,
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
      before = await snapshot(join(h.root, 'course/lectures'))
      decisionsBefore = await json<Decision[]>('decisions.json')
      await addSlides(h.root, '03 Lean startup.pdf', SLIDES['03 Lean startup.pdf']!)
      // Top grade, so that the two slides of this lecture may carry its three facts.
      again = await run({ type: 'build', course: 'course', goal: 'top' })
    })

    it('builds only the new lecture', () => {
      expect(again.at(-1)).toMatchObject({
        type: 'built',
        lectures: [{ number: 3, title: 'Lean startup', concepts: 2, cards: 3 }],
        cards: 3,
        dropped: 0,
      })
      expect(h.model.requests.every((r) => /^Lecture (file: 03|03) /.test(r.context))).toBe(true)
    })

    it('leaves every existing lecture file byte-identical', async () => {
      const after = await snapshot(join(h.root, 'course/lectures'))
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
        calls: 6,
      })
    })

    it('does nothing when no lecture is new', async () => {
      const course = await snapshot(join(h.root, 'course'))
      const idle = await run({ type: 'build', course: 'course' })
      expect(idle.at(-1)).toEqual({
        type: 'built',
        lectures: [],
        cards: 0,
        dropped: 0,
        costUsd: 0,
        durationMs: 0,
      })
      expect(h.model.requests).toEqual([])
      expect(h.decider.requests).toEqual([])
      expect(await snapshot(join(h.root, 'course'))).toEqual(course)
    })
  })
})

describe('slides with little text', () => {
  it('go to the decision model as pictures only with the facts that come from them', async () => {
    await courseOf()
    // Slides 1, 2, 4 and 5 are short, so each is also shown as a picture. Slide 3 is not.
    await addSlides(h.root, '01 Risk.pdf', [
      ['Entrepreneurship'],
      ['Risk', 'Probability is known'],
      SLIDES['01 Risk.pdf']![2]!,
      ['Agenda'],
      ['Insurance', 'Risk can be insured'],
    ])
    await run({ type: 'build', course: 'course', goal: 'top' })
    const slideOf = new Map<string, number>()
    const lecture = await json<Lecture>('lectures/01/lecture.json')
    for (const concept of lecture.topics.flatMap((topic) => topic.concepts)) {
      for (const fact of concept.facts) slideOf.set(fact.text, fact.slide)
    }
    const pictured = h.decider.requests.filter((r) => r.images.length > 0)
    expect(pictured.length).toBeGreaterThan(0)
    for (const request of pictured) {
      const slides = request.questions.map((q) => {
        const fact = q.type === 'choice' ? /: "(.+)"$/.exec(q.ask)?.[1] : undefined
        return slideOf.get(fact ?? '')
      })
      expect(slides).not.toContain(undefined)
      const shown = request.images.map((image) => image.slide)
      expect(new Set(shown).size).toBe(shown.length)
      expect(shown.sort()).toEqual([...new Set(slides)].filter((s) => shown.includes(s!)).sort())
      expect(shown).not.toContain(1)
      expect(shown).not.toContain(4)
    }
  })
})

describe('goal and cost', () => {
  it('pass: half a card per slide, for the facts worth most, and says which concepts it skipped', async () => {
    await courseOf('01 Risk.pdf')
    await run({ type: 'build', course: 'course', goal: 'pass' })
    expect((await json<CourseFile>('course.json')).goal).toBe('pass')
    expect((await cards('01')).map((c) => c.id)).toEqual([
      '01-risk-definition-1',
      '01-risk-reverse-1',
      '01-risk-case-1',
    ])
    expect(await json<Decision[]>('decisions.json')).toEqual(
      expect.arrayContaining([
        {
          lecture: null,
          kind: 'goal',
          text: 'Goal "pass": the facts worth most get a card, at most 0.5 per slide.',
        },
        {
          lecture: 1,
          kind: 'beyond-goal',
          text: 'No cards in 01 Risk and uncertainty for "uncertainty": the goal allows 3 cards in this build, and other facts are worth more.',
        },
      ]),
    )
  })

  it('top grade: nearly two cards per slide, here every fact', async () => {
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
      Typed: '',
    })
  })

  it('reads the concept rules into the map and the cards of every course', async () => {
    await courseOf('01 Risk.pdf')
    await run({ type: 'build', course: 'course' })
    expect(calls('map')[0]!.prompt).toContain(
      '- Only what can be examined is a concept. The organisation of the course is never one',
    )
    const fill = calls('fill')[0]!
    expect(fill.prompt).toContain('- Lead with the answer: the key term comes first')
    expect(fill.prompt).toContain('"question":"Sarasvathy: what is causation?"')
  })

  it('estimates a build without calling a model', async () => {
    await courseOf('01 Risk.pdf', '02 Effectuation.pdf')
    expect(await run({ type: 'estimate', course: 'course', goal: 'top' })).toEqual([
      {
        type: 'estimate',
        lectures: 2,
        slides: 9,
        cards: 16,
        costUsd: 0,
        costEur: 0,
        capUsd: 0.25,
      },
    ])
    expect(h.model.requests).toEqual([])
    expect(h.decider.requests).toEqual([])
    expect(await readdir(join(h.root, 'course'))).toEqual(['slides'])
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

  it('stops a build whose real cost passes the cap, starts no further call and saves only its run record', async () => {
    await courseOf('01 Risk.pdf')
    const events = await run({ type: 'build', course: 'course', goal: 'top' }, { costPerCall: 0.2 })
    expect(events.at(-1)).toEqual({
      type: 'failed',
      message: 'The run was stopped at 0.40 dollars, above its cap of 0.25 dollars.',
      fix: 'Nothing was saved. Build again, or build fewer lectures at once.',
    })
    // The first slide, then the four reads already under way, pass the cap. Nothing more starts.
    expect(h.model.requests.map((r) => r.task)).toEqual(['read', 'read', 'read', 'read', 'read'])
    // Only the record of the run is kept, so that the money it spent still shows.
    expect((await readdir(join(h.root, 'course'))).sort()).toEqual(['runs', 'slides'])
    expect(await json('runs/001.json')).toMatchObject({ run: 1, failed: true, cards: 0 })
  })
})

describe('commands', () => {
  it('fails with a fix when the course has no slides', async () => {
    await courseOf()
    expect((await run({ type: 'build', course: 'course' })).at(-1)).toEqual({
      type: 'failed',
      message: 'No PDF found in course/slides.',
      fix: 'Put one PDF per lecture into the slides folder of the course.',
    })
  })

  it('rejects a command it does not know', async () => {
    const [event] = await run({ type: 'outline', course: 'course' })
    expect(event).toMatchObject({
      type: 'failed',
      message: 'Lectern did not understand this command.',
    })
  })
})
