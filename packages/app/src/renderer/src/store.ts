/**
 * The one store of the interface. Screens read it and call its actions; only this file talks
 * to `window.lectern`.
 */

import { create } from 'zustand'
import type {
  Bridge,
  Card,
  Command,
  CourseSummary,
  CourseView,
  Design,
  Estimate,
  Event,
  Goal,
  KeyResult,
  Lecture,
  Phase,
  Settings,
} from '../../shared/contract.ts'
import { PHASES } from '../../shared/contract.ts'

declare global {
  interface Window {
    lectern: Bridge
  }
}

export type Screen = 'loading' | 'first-run' | 'courses' | 'course' | 'settings'

export interface PhaseState {
  status: 'waiting' | 'started' | 'done'
  done: number
  total: number
}

export interface RunState {
  /** The course whose cards are being made. One run at a time. */
  course: string
  phases: Record<Phase, PhaseState>
  startedAt: number
  /** When the phase that is running now started, for the time left. */
  phaseStartedAt: number
}

/** Where the map is: the whole course, or inside one lecture with an optional selection. */
export type View =
  { level: 'course' } | { level: 'lecture'; lecture: number; topic?: string; concept?: string }

/** What the side panel shows. Null is the full-width map. */
export type Panel = null | 'setup' | 'run' | 'cards' | 'details'

/** Where a course stands. It decides the bar and the default panel. */
export type Stage = 'empty' | 'setup' | 'running' | 'ready'

export interface Failure {
  message: string
  fix: string
}

interface State {
  screen: Screen
  /** The screen settings returns to. */
  back: Screen
  settings: Settings | null
  courses: CourseSummary[]
  course: CourseView | null
  goal: Goal
  estimate: Estimate | null
  run: RunState | null
  failure: Failure | null
  view: View
  panel: Panel
  detailsTab: 'decisions' | 'statistics'

  start: () => Promise<void>
  saveKey: (key: string) => Promise<KeyResult>
  setDesign: (design: Design) => Promise<void>
  openCourses: () => Promise<void>
  createCourse: (name: string) => Promise<void>
  openCourse: (course: string) => Promise<void>
  addFiles: (files: File[]) => Promise<void>
  setGoal: (goal: Goal) => Promise<void>
  build: () => Promise<void>
  showCourse: () => void
  openLecture: (lecture: number) => void
  selectTopic: (topic: string) => void
  selectConcept: (concept: string) => void
  openDetails: (tab?: 'decisions' | 'statistics') => void
  openPanel: (panel: Panel) => void
  closePanel: () => void
  openSettings: () => void
  closeSettings: () => void
}

function freshRun(course: string, now: number): RunState {
  const phases = Object.fromEntries(
    PHASES.map((p) => [p, { status: 'waiting', done: 0, total: 0 }]),
  ) as Record<Phase, PhaseState>
  return { course, phases, startedAt: now, phaseStartedAt: now }
}

/** Runs a command and hands back its events once it has finished. */
async function ask(command: Command, onEvent?: (event: Event) => void): Promise<Event[]> {
  const events: Event[] = []
  await window.lectern.run(command, (event) => {
    events.push(event)
    onEvent?.(event)
  })
  return events
}

function failureOf(events: Event[]): Failure | null {
  const failed = events.find((e) => e.type === 'failed')
  return failed ? { message: failed.message, fix: failed.fix } : null
}

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export const useStore = create<State>((set, get) => {
  /** Reads the open course again, with the cards of every lecture. */
  async function refresh(course: string): Promise<CourseView | null> {
    const events = await ask({ type: 'course', course })
    const state = events.find((e) => e.type === 'course')?.course
    if (!state) {
      set({ failure: failureOf(events) })
      return null
    }
    const lectures = await Promise.all(
      state.lectures.map(async (lecture) => {
        const reply = await ask({ type: 'cards', course, lecture: lecture.number })
        const cards = reply.find((e) => e.type === 'cards')?.cards ?? []
        return { ...lecture, cards }
      }),
    )
    const view: CourseView = { ...state, lectures }
    set({ course: view })
    return view
  }

  async function estimate(): Promise<void> {
    const { course, goal } = get()
    if (!course || course.pending.length === 0) {
      set({ estimate: null })
      return
    }
    const events = await ask({ type: 'estimate', course: course.id, goal })
    const found = events.find((e) => e.type === 'estimate')
    // A newer goal may have been chosen while this one was counted.
    if (get().goal !== goal) return
    set({ estimate: found ?? null })
    // A failure that is already shown stays: a working estimate says nothing about it.
    const failure = failureOf(events)
    if (failure) set({ failure })
  }

  return {
    screen: 'loading',
    back: 'courses',
    settings: null,
    courses: [],
    course: null,
    goal: 'good',
    estimate: null,
    run: null,
    failure: null,
    view: { level: 'course' },
    panel: null,
    detailsTab: 'decisions',

    async start() {
      const settings = await window.lectern.settings()
      set({ settings })
      if (settings.hasKey) await get().openCourses()
      else set({ screen: 'first-run' })
    },

    async saveKey(key) {
      const result = await window.lectern.saveKey(key)
      if (result.ok) set({ settings: await window.lectern.settings() })
      return result
    },

    async setDesign(design) {
      set({ settings: await window.lectern.setDesign(design) })
    },

    async openCourses() {
      const events = await ask({ type: 'courses' })
      const found = events.find((e) => e.type === 'courses')
      set({
        screen: 'courses',
        courses: found?.courses ?? [],
        course: null,
        failure: failureOf(events),
      })
    },

    async createCourse(name) {
      const events = await ask({ type: 'create', name })
      const created = events.find((e) => e.type === 'created')
      if (created) await get().openCourse(created.course)
      else set({ failure: failureOf(events) })
    },

    async openCourse(course) {
      set({ failure: null, estimate: null, view: { level: 'course' } })
      const view = await refresh(course)
      if (!view) return
      const running = get().run?.course === course
      set({
        screen: 'course',
        goal: view.goal,
        panel: running ? 'run' : view.pending.length > 0 ? 'setup' : null,
      })
      if (!running) await estimate()
    },

    async addFiles(files) {
      const { course } = get()
      const pdfs = files.filter((f) => f.name.toLowerCase().endsWith('.pdf'))
      if (!course || pdfs.length === 0) return
      const data = await Promise.all(
        pdfs.map(async (f) => ({ name: f.name, data: await toBase64(f) })),
      )
      const events = await ask({ type: 'add', course: course.id, files: data })
      set({ failure: failureOf(events) })
      const view = await refresh(course.id)
      if (view && view.pending.length > 0) set({ panel: 'setup', view: { level: 'course' } })
      await estimate()
    },

    async setGoal(goal) {
      set({ goal })
      await estimate()
    },

    async build() {
      const { course, goal, run } = get()
      if (!course) return
      if (run) {
        set({
          failure: {
            message: 'Lectern is still making the cards of another course.',
            fix: 'Wait until that course is ready, then make these cards.',
          },
        })
        return
      }
      set({
        run: freshRun(course.id, Date.now()),
        failure: null,
        panel: 'run',
        view: { level: 'course' },
      })
      const events = await ask({ type: 'build', course: course.id, goal }, (event) => {
        const current = get().run
        if (!current) return
        if (event.type === 'estimate') set({ estimate: event })
        if (event.type === 'phase') {
          const phase: PhaseState = {
            status: event.status,
            done: event.status === 'done' ? event.total : 0,
            total: event.total,
          }
          set({
            run: {
              ...current,
              phases: { ...current.phases, [event.phase]: phase },
              phaseStartedAt: event.status === 'started' ? Date.now() : current.phaseStartedAt,
            },
          })
        }
        if (event.type === 'progress') {
          const phase: PhaseState = { status: 'started', done: event.done, total: event.total }
          set({ run: { ...current, phases: { ...current.phases, [event.phase]: phase } } })
        }
      })
      const failure = failureOf(events)
      set({ run: null })
      // The student may have left for another course while the cards were made.
      if (get().course?.id !== course.id || get().screen === 'courses') return
      await refresh(course.id)
      // A failed run keeps its panel open, so the student reads what went wrong and the fix.
      set({ failure, estimate: null, panel: failure ? 'run' : null })
      if (failure) await estimate()
    },

    showCourse() {
      const { panel } = get()
      set({ view: { level: 'course' }, panel: panel === 'cards' ? null : panel })
    },

    openLecture(lecture) {
      set({ view: { level: 'lecture', lecture }, panel: 'cards' })
    },

    selectTopic(topic) {
      const { view } = get()
      if (view.level !== 'lecture') return
      set({ view: { level: 'lecture', lecture: view.lecture, topic }, panel: 'cards' })
    },

    selectConcept(concept) {
      const { view } = get()
      if (view.level !== 'lecture') return
      set({ view: { level: 'lecture', lecture: view.lecture, concept }, panel: 'cards' })
    },

    openDetails(tab) {
      set({ panel: 'details', detailsTab: tab ?? get().detailsTab })
    },

    openPanel(panel) {
      set({ panel })
    },

    closePanel() {
      const { view } = get()
      // Closing the cards of a concept or topic keeps the lecture and drops the selection.
      set({
        panel: null,
        view: view.level === 'lecture' ? { level: 'lecture', lecture: view.lecture } : view,
      })
    },

    openSettings() {
      const { screen } = get()
      if (screen !== 'settings') set({ screen: 'settings', back: screen })
    },

    closeSettings() {
      set({ screen: get().back })
    },
  }
})

/** Where the open course stands. */
export function stageOf(course: CourseView, run: RunState | null): Stage {
  if (run?.course === course.id) return 'running'
  if (course.pending.length > 0) return 'setup'
  return course.lectures.length > 0 ? 'ready' : 'empty'
}

export function cardCount(course: CourseView): number {
  return course.lectures.reduce((sum, l) => sum + l.cards.length, 0)
}

export function conceptCount(course: CourseView): number {
  return course.lectures.reduce(
    (sum, l) => sum + l.topics.reduce((n, t) => n + t.concepts.length, 0),
    0,
  )
}

/** The cards of one concept of a lecture. */
export function cardsOfConcept(lecture: Lecture, concept: string): Card[] {
  return lecture.cards.filter((c) => c.concept === concept)
}

/** The cards the side panel lists for the map's selection, in the lecture's own order. */
export function selectedCards(lecture: Lecture, view: View): Card[] {
  if (view.level !== 'lecture') return []
  if (view.concept) return cardsOfConcept(lecture, view.concept)
  if (view.topic) {
    const ids = new Set(
      lecture.topics.find((t) => t.name === view.topic)?.concepts.map((c) => c.id),
    )
    return lecture.cards.filter((c) => ids.has(c.concept))
  }
  return lecture.cards
}
