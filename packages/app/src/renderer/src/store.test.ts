import { beforeEach, describe, expect, it } from 'vitest'
import type { Command, Event } from '../../shared/contract.ts'
import { useStore } from './store.ts'

type Handler = (command: Command) => Event[] | Promise<Event[]>

/** The bridge the store talks to, answering each kind of command from `handlers`. */
const handlers: Partial<Record<Command['type'], Handler>> = {}

const initial = useStore.getState()

/** A promise the test settles by hand, so an answer can arrive late. */
function gate<T>() {
  let release!: (value: T) => void
  const promise = new Promise<T>((resolve) => (release = resolve))
  return { promise, release }
}

const pendingLecture = { file: '01.pdf', number: 1, title: 'One', slides: 3 }

/** A course with one lecture waiting for cards. */
function courseEvent(id: string): Event {
  return {
    type: 'course',
    course: {
      id,
      name: id,
      goal: 'good',
      lectures: [],
      pending: [pendingLecture],
      exams: [],
      decisions: [],
      runs: [],
    },
  }
}

const failed = (message: string): Event => ({ type: 'failed', message, fix: `Fix for ${message}` })

/** What the Courses list says now. Tests change it to mark a list that was read again. */
let listed = 'before'

beforeEach(() => {
  useStore.setState(initial, true)
  for (const key of Object.keys(handlers)) delete handlers[key as Command['type']]
  listed = 'before'
  handlers.courses = () =>
    [{ type: 'courses', courses: [{ id: 'a', name: listed }] }] as unknown as Event[]
  handlers.course = (c) => [courseEvent((c as { course: string }).course)]
  Object.assign(globalThis, {
    window: {
      lectern: {
        run: async (command: Command, onEvent: (event: Event) => void) => {
          for (const event of (await handlers[command.type]?.(command)) ?? []) onEvent(event)
        },
      },
    },
  })
})

describe('a build that ends while the student is elsewhere', () => {
  async function failWhile(elsewhere: () => Promise<void>) {
    const end = gate<Event[]>()
    handlers.build = () => end.promise
    await useStore.getState().openCourse('a')
    const building = useStore.getState().build()
    await elsewhere()
    listed = 'after'
    end.release([failed('The key was refused.')])
    await building
  }

  it('updates the Courses list and keeps its failure for the course, while the list is open', async () => {
    await failWhile(() => useStore.getState().openCourses())
    expect(useStore.getState().courses).toMatchObject([{ name: 'after' }])
    expect(useStore.getState().failure).toBeNull()
    await useStore.getState().openCourse('a')
    expect(useStore.getState().failure?.message).toBe('The key was refused.')
    expect(useStore.getState().kept).toEqual({})
  })

  it('does the same while another course is open', async () => {
    await failWhile(() => useStore.getState().openCourse('b'))
    expect(useStore.getState().courses).toMatchObject([{ name: 'after' }])
    expect(useStore.getState().failure).toBeNull()
    await useStore.getState().openCourse('a')
    expect(useStore.getState().failure?.fix).toBe('Fix for The key was refused.')
  })
})
