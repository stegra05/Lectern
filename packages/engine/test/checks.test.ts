import { beforeAll, describe, expect, it } from 'vitest'
import { ORGANISATION_THRESHOLD } from '../src/decide.ts'
import type { Event, Lecture } from '../src/api.ts'
import { decisions } from './fixtures.ts'
import { pipeline } from './harness.ts'

const h = pipeline()
const { courseOf, run, json, cards, card, calls, about } = h

describe('the card check and the rules on what a card says', () => {
  let events: Event[]

  beforeAll(async () => {
    await courseOf('04 Pivot.pdf')
    events = await run({ type: 'build', course: 'course' })
  })

  it('asks about each card with that card as the whole input, never the lecture', () => {
    const asked = h.decider.requests.filter((r) => r.context.startsWith('A flashcard written'))
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
    expect(events.at(-1)).toMatchObject({ cards: 1, dropped: 2 })
  })
})

describe('the organisation check drops from its threshold on', () => {
  /** A decision model that gives the exam date card this probability and every other card a low one. */
  const scoring =
    (p: number): typeof decisions =>
    (question, request) =>
      question.type === 'predicate'
        ? {
            type: 'predicate',
            probability: request.context.includes('When does the exam take place?') ? p : 0.02,
          }
        : decisions(question, request)

  const examCard = async () => (await cards('04')).find((c) => c.id === '04-exam-definition-1')

  it('keeps a card just under it', async () => {
    await courseOf('04 Pivot.pdf')
    await run(
      { type: 'build', course: 'course' },
      { decide: scoring(ORGANISATION_THRESHOLD - 0.01) },
    )
    expect(await examCard()).toBeDefined()
  })

  it('drops a card just over it', async () => {
    await courseOf('04 Pivot.pdf')
    await run(
      { type: 'build', course: 'course' },
      { decide: scoring(ORGANISATION_THRESHOLD + 0.01) },
    )
    expect(await examCard()).toBeUndefined()
    expect((await json<Lecture>('lectures/04/lecture.json')).dropped).toContainEqual(
      expect.objectContaining({ concept: 'exam' }),
    )
  })
})
