import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Command, Event } from '../../shared/contract.ts'
import { timeLeft } from './course/panels/RunPanel.tsx'
import { useStore } from './store.ts'

/** Answers a command. `emit` hands an event over at once, before the answer is complete. */
type Handler = (command: Command, emit: (event: Event) => void) => Event[] | Promise<Event[]>

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

/** A course whose first lecture has cards. */
function lectureEvent(): Event {
  const event = courseEvent('a') as Extract<Event, { type: 'course' }>
  return {
    ...event,
    course: { ...event.course, lectures: [{ number: 1, title: 'One', topics: [] }] },
  } as unknown as Event
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
          for (const event of (await handlers[command.type]?.(command, onEvent)) ?? [])
            onEvent(event)
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

describe('a save that answers late', () => {
  const cards = [
    { id: 'c1', concept: 'k1' },
    { id: 'c2', concept: 'k2' },
  ]

  /** Press Save on card c1, then open the form on c2 before c1's answer comes. */
  async function saveThenOpenOther(answer: Event[]) {
    const end = gate<Event[]>()
    handlers.cards = () => [{ type: 'cards', cards, sent: [] }] as unknown as Event[]
    handlers.slots = () =>
      [{ type: 'slots', slots: { front: '' }, limits: {} }] as unknown as Event[]
    handlers.edit = () => end.promise
    handlers.course = () => [lectureEvent()]
    const store = useStore.getState()
    await store.openCourse('a')
    store.openLecture(1)
    await store.editCard(cards[0] as never)
    const saving = store.saveCard()
    await store.editCard(cards[1] as never)
    useStore.getState().setEditor({ slots: { front: 'my draft' } as never })
    end.release(answer)
    await saving
  }

  it('leaves another open form with its draft when the save is taken', async () => {
    await saveThenOpenOther([])
    const { editor } = useStore.getState()
    expect(editor?.card).toBe('c2')
    expect(editor?.slots.front).toBe('my draft')
  })

  it('keeps the problems of a refused save out of another open form', async () => {
    await saveThenOpenOther([
      { type: 'refused', problems: [{ field: 'front', message: 'Too long.' }] },
    ] as unknown as Event[])
    const { editor } = useStore.getState()
    expect(editor?.card).toBe('c2')
    expect(editor?.problems).toEqual([])
  })
})

describe('a problem from adding files', () => {
  const bad = { path: 'bad.pdf', file: new File(['x'], 'bad.pdf') }

  it('goes away when a build starts and stays away over its result', async () => {
    const end = gate<Event[]>()
    handlers.add = () => [failed('bad.pdf is not a PDF.')]
    handlers.build = () => end.promise
    await useStore.getState().openCourse('a')
    await useStore.getState().addFiles([bad])
    expect(useStore.getState().addProblem?.message).toBe('bad.pdf is not a PDF.')
    const building = useStore.getState().build()
    expect(useStore.getState().addProblem).toBeNull()
    end.release([])
    await building
    expect(useStore.getState().addProblem).toBeNull()
  })

  it('shows only on the course the files went to', async () => {
    const end = gate<Event[]>()
    handlers.add = () => end.promise
    await useStore.getState().openCourse('a')
    const adding = useStore.getState().addFiles([bad])
    await useStore.getState().openCourse('b')
    end.release([failed('bad.pdf is not a PDF.')])
    await adding
    expect(useStore.getState().addProblem).toBeNull()
    expect(useStore.getState().course?.id).toBe('b')
  })

  it('goes away when a send starts', async () => {
    handlers.add = () => [failed('bad.pdf is not a PDF.')]
    handlers.send = () => []
    await useStore.getState().openCourse('a')
    await useStore.getState().addFiles([bad])
    await useStore.getState().send()
    expect(useStore.getState().addProblem).toBeNull()
  })
})

describe('the time left of a phase', () => {
  afterEach(() => vi.useRealTimers())

  it('counts from the start of that phase, also when the next one has begun', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    const end = gate<Event[]>()
    handlers.build = async (_, emit) => {
      emit({ type: 'phase', phase: 'write', status: 'started', total: 100 })
      vi.setSystemTime(100_000)
      emit({ type: 'progress', phase: 'write', done: 40, total: 100 })
      // The check of the first lecture begins while write is still going.
      emit({ type: 'phase', phase: 'check', status: 'started', total: 100 })
      return end.promise
    }
    await useStore.getState().openCourse('a')
    const building = useStore.getState().build()
    await vi.waitFor(() => expect(useStore.getState().run?.phases.check.status).toBe('started'))
    // 40 of 100 in 100 s: 150 s to go, which is 3 minutes. Counted from check it was under 1.
    expect(timeLeft(useStore.getState().run!)).toBe('About 3 minutes')
    end.release([])
    await building
  })
})
