import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Decision, Event, Lecture } from '../src/api.ts'
import type { ModelRequest } from '../src/ports.ts'
import { EXAM, script, SLIDES } from './fixtures.ts'
import { onlyLecture2Costs, pipeline } from './harness.ts'
import { addSlides, makePdf } from './helpers.ts'

const h = pipeline()
const { courseOf, run, json, cards, calls } = h

describe('past exams', () => {
  beforeAll(async () => {
    await courseOf('01 Risk.pdf')
    await mkdir(join(h.root, 'course', 'exams'), { recursive: true })
    await writeFile(join(h.root, 'course', 'exams', 'Winter 2025-26.pdf'), await makePdf([EXAM]))
    await run({ type: 'build', course: 'course', goal: 'pass' })
  })

  it('reads every paper into its questions once, and keeps them with the course', async () => {
    expect(await json('exams.json')).toEqual({
      papers: [
        {
          file: 'Winter 2025-26.pdf',
          questions: [
            {
              paper: 'Winter 2025-26',
              number: '1',
              text: 'What is risk according to Knight (1921)?',
            },
            {
              paper: 'Winter 2025-26',
              number: '2',
              text: 'When does Kickstarter release the money?',
            },
          ],
        },
      ],
    })
  })

  it('gives every answered exam question a card first, even where the goal is short of cards', async () => {
    // Pass allows 3 cards for the 5 slides of lecture 1: both exam answers get one.
    const all = await cards('01')
    const exam = all.filter((c) => c.fields.Asked === '1x')
    expect(exam.map((c) => [c.fields.Front, c.fields.Source])).toEqual([
      ['Knight (1921): how is risk defined?', 'Lecture 1, slide 2; past exams'],
      [
        'Kickstarter: when does a project get its money?',
        'Past exams; the answer is not on the slides',
      ],
    ])
    expect(exam[1]!.fields.Slide).toBe('')
    expect(all).toHaveLength(3)
  })

  it('tells the writer which exam question the card should answer', () => {
    expect(
      calls('fill').some((r) =>
        r.prompt.includes('Past exams asked: When does Kickstarter release the money?'),
      ),
    ).toBe(true)
  })

  it('puts an answer the lecture has no concept for under a new concept, and says what it did', async () => {
    const lecture = await json<Lecture>('lectures/01/lecture.json')
    const kickstarter = lecture.topics
      .flatMap((t) => t.concepts)
      .find((c) => c.name === 'Kickstarter')!
    expect(kickstarter.facts[0]!.exam).toEqual({
      question: 'When does Kickstarter release the money?',
      papers: 1,
      fromSlides: false,
    })
    expect(await json<Decision[]>('decisions.json')).toContainEqual({
      lecture: null,
      kind: 'exams',
      text: '2 questions from 1 past papers came down to 2 questions that get a card first. The slides answer 1 of them; 1 the model answered from what it knows, and those cards say so.',
    })
  })
})

describe('building again with a new past paper', () => {
  const QUESTION = 'How does the lean startup lower risk?'
  const ANSWER = 'Testing early lowers the risk of a venture.'
  /** The script, and a second paper whose one question belongs to lecture 3. */
  const withSecondPaper = (request: ModelRequest): unknown => {
    if (request.context.startsWith('Exam paper: Summer 2026')) {
      return { questions: [{ number: '1', text: QUESTION }] }
    }
    if (request.prompt.includes('Sort the questions into families')) {
      return {
        families: [
          { question: QUESTION, members: ['Q1'], lecture: 3, concept: 'entrepreneurial risk' },
        ],
      }
    }
    if (request.prompt.startsWith('A question past exams')) {
      return { answer: ANSWER, items: 0, slide: 2, fromSlides: true }
    }
    // Writing: the exam answer's card as here, the other cards of its call as the fixture writes them.
    if (request.task === 'fill' && request.prompt.includes(`Fact to test: ${ANSWER}`)) {
      const blocks = request.prompt.split(/^Fact to test: /m).slice(1)
      const cards = blocks.map((block) =>
        block.startsWith(ANSWER)
          ? {
              cardType: /^Card type: ([^.]+)\./m.exec(block)![1],
              question: 'Lean startup: why test early?',
              answer: 'It ==lowers risk== before money is spent.',
              extra: '',
            }
          : (script({ ...request, prompt: `Fact to test: ${block}` }) as { cards: unknown[] })
              .cards[0],
      )
      return { cards }
    }
    return script(request)
  }
  const price = { input: 1, cachedInput: 0.1, output: 4, fast: 2 }
  const estimateOf = async () => {
    const [event] = await run({ type: 'estimate', course: 'course' }, { price })
    if (event?.type !== 'estimate') throw new Error('No estimate')
    return event
  }
  let withoutPaper: Awaited<ReturnType<typeof estimateOf>>
  let withPaper: Awaited<ReturnType<typeof estimateOf>>
  let events: Event[]

  beforeAll(async () => {
    await courseOf('01 Risk.pdf')
    await mkdir(join(h.root, 'course', 'exams'), { recursive: true })
    await writeFile(join(h.root, 'course', 'exams', 'Winter 2025-26.pdf'), await makePdf([EXAM]))
    await run({ type: 'build', course: 'course', goal: 'pass' })

    await addSlides(h.root, '03 Lean startup.pdf', SLIDES['03 Lean startup.pdf']!)
    withoutPaper = await estimateOf()
    const paper = ['Exam Summer 2026', `1) ${QUESTION}`]
    await writeFile(join(h.root, 'course', 'exams', 'Summer 2026.pdf'), await makePdf([paper]))
    withPaper = await estimateOf()
    events = await run({ type: 'build', course: 'course' }, { script: withSecondPaper, price })
  })

  it('counts the new paper in the estimate, and the papers read before not at all', () => {
    expect(withPaper.costUsd).toBeGreaterThan(withoutPaper.costUsd)
    expect(events.find((e) => e.type === 'estimate')).toEqual(withPaper)
  })

  it('reads and places only the questions of the new paper', async () => {
    const reads = h.model.requests.filter((r) => r.context.startsWith('Exam paper:'))
    expect(reads.map((r) => r.context.split('\n')[0])).toEqual(['Exam paper: Summer 2026'])
    const sorting = calls('map').find((r) => r.prompt.includes('Sort the questions into families'))!
    expect(sorting.prompt).toContain(QUESTION)
    expect(sorting.prompt).not.toContain('Knight')
    expect(sorting.prompt).not.toContain('Kickstarter')
    expect(sorting.prompt).toContain('Lecture 3 Lean startup')
    expect(sorting.prompt).not.toContain('Lecture 1')
  })

  it('keeps the first paper as it was and adds the second', async () => {
    const { papers } = await json<{ papers: { file: string; questions: unknown[] }[] }>(
      'exams.json',
    )
    expect(papers.map((p) => [p.file, p.questions.length])).toEqual([
      ['Winter 2025-26.pdf', 2],
      ['Summer 2026.pdf', 1],
    ])
  })

  it('gives its answer a card first, and says what it did', async () => {
    const exam = (await cards('03')).filter((c) => c.fields.Asked === '1x')
    expect(exam.map((c) => c.fields.Front)).toEqual(['Lean startup: why test early?'])
    const decisions = await json<Decision[]>('decisions.json')
    expect(decisions.filter((d) => d.kind === 'exams').map((d) => d.text)).toEqual([
      expect.stringContaining('2 questions from 1 past papers'),
      expect.stringContaining('1 questions from 1 past papers came down to 1 questions'),
    ])
  })
})

describe('past exams in a build that was stopped', () => {
  let again: Event[]

  beforeAll(async () => {
    await courseOf('01 Risk.pdf', '02 Effectuation.pdf')
    await mkdir(join(h.root, 'course', 'exams'), { recursive: true })
    await writeFile(join(h.root, 'course', 'exams', 'Winter 2025-26.pdf'), await makePdf([EXAM]))
    // Lecture 1 is finished when the cap is passed in lecture 2.
    await run({ type: 'build', course: 'course', capUsd: 0.35 }, onlyLecture2Costs(0.2))
  })

  it('does not count the papers as read, since lecture 2 still waits for its questions', async () => {
    expect((await json<{ lectures: unknown[] }>('course.json')).lectures).toHaveLength(1)
    await expect(readFile(join(h.root, 'course', 'exams.json'))).rejects.toThrow()
  })

  it('reads them again when the build is repeated, and keeps them once it is through', async () => {
    again = await run({ type: 'build', course: 'course' })
    expect(again.at(-1)).toMatchObject({ type: 'built', lectures: [{ number: 2 }] })
    expect(calls('read').some((r) => r.context.startsWith('Exam paper:'))).toBe(true)
    expect((await json<{ papers: unknown[] }>('exams.json')).papers).toHaveLength(1)
  })
})
