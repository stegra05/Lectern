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
  Estimate,
  Event,
  Goal,
  KeyResult,
  LeftFile,
  Lecture,
  Limits,
  Phase,
  Problem,
  Settings,
  Slots,
} from '../../shared/contract.ts'
import { PHASES } from '../../shared/contract.ts'
import type { Picked } from './picked.ts'

/** Slide decks, documents and photos: course material a student can export as PDF. */
const NOT_PDF = /\.(pptx?|key|odp|docx?|odt|pages|rtf|png|jpe?g|heic)$/i

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
  /** When each phase started, for the time left. Phases overlap, so each has its own. */
  phaseStartedAt: Partial<Record<Phase, number>>
  /** The lecture the engine is working on, when it says so. */
  lecture: number | null
}

/** Where the map is: the whole course, or inside one lecture with an optional selection. */
export type View =
  { level: 'course' } | { level: 'lecture'; lecture: number; topic?: number; concept?: string }

/** What the side panel shows. Null is the full-width map. */
export type Panel = null | 'setup' | 'run' | 'cards' | 'details'

/** Where a course stands. It decides the bar and the default panel. */
export type Stage = 'empty' | 'setup' | 'running' | 'ready'

/** A send to Anki that is under way. */
export interface SendState {
  course: string
  done: number
  total: number
  /** The lecture whose cards are going now. */
  lecture: number | null
}

/** The card form in the side panel. */
export interface Editor {
  lecture: number
  /** The card being changed. Null while the student writes one of their own. */
  card: string | null
  /** The id of the concept the card belongs to. */
  concept: string
  slots: Slots
  /** `slots` as the form opened, as JSON, to tell whether the student changed anything. */
  start: string
  limits: Limits
  /** What has to be fixed before the card is taken, by field of the form. */
  problems: Problem[]
  busy: boolean
}

export interface Failure {
  message: string
  fix: string
}

/** A file an add kept out, with the file itself so it can be added by hand. */
export type LeftEntry = LeftFile & { picked: Picked }

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
  sending: SendState | null
  editor: Editor | null
  /** Forms with unsaved changes that a click on the map or the panel closed, by card. */
  drafts: Record<string, Editor>
  failure: Failure | null
  /** What ended a build or send while the student was elsewhere, by course, until it is opened. */
  kept: Record<string, Failure>
  /** Why files could not be added. Apart from `failure`, which labels the build button. */
  addProblem: Failure | null
  /** The course whose added files are being sorted now. Nothing else is added meanwhile. */
  adding: string | null
  /**
   * What the adds of this session kept out, by course, so a file left out wrongly can still be
   * added after more files came in or another course was open.
   */
  leftOut: Record<string, LeftEntry[]>
  view: View
  panel: Panel
  detailsTab: 'decisions' | 'statistics'

  start: () => Promise<void>
  saveKey: (key: string) => Promise<KeyResult>
  openCourses: () => Promise<void>
  createCourse: (name: string) => Promise<void>
  openCourse: (course: string) => Promise<void>
  /** Adds files, a course folder too: the engine sorts them and keeps out what it does not use. */
  addFiles: (files: Picked[]) => Promise<void>
  /** Adds past exam papers. The next build turns their recurring questions into cards first. */
  addExams: (files: Picked[]) => Promise<void>
  /** Adds a file that was left out, as lecture slides or as a past exam. */
  addLeftOut: (path: string, to: 'slides' | 'exams') => Promise<void>
  /** Moves a file without cards between lecture slides and past exams, or out of the course. */
  moveFile: (file: string, to: 'slides' | 'exams' | 'out') => Promise<void>
  setGoal: (goal: Goal) => Promise<void>
  build: () => Promise<void>
  /** Sends the cards that are not in Anki yet. */
  send: () => Promise<void>
  /** Opens the form on a card of the open lecture. */
  editCard: (card: Card) => Promise<void>
  /** Opens the form for a card of the student's own on a concept of the open lecture. */
  writeCard: (concept: string) => Promise<void>
  setEditor: (changes: Partial<Pick<Editor, 'slots' | 'concept'>>) => void
  /** A card of the student's own is a question with its answer, or a sentence with gaps. */
  setEditorKind: (role: 'definition' | 'cloze') => Promise<void>
  saveCard: () => Promise<void>
  removeCard: () => Promise<void>
  closeEditor: () => void
  showCourse: () => void
  openLecture: (lecture: number) => void
  selectTopic: (topic: number) => void
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
  return { course, phases, startedAt: now, phaseStartedAt: {}, lecture: null }
}

/** Runs a command and hands back its events once it has finished. */
async function ask(command: Command, onEvent?: (event: Event) => void): Promise<Event[]> {
  const events: Event[] = []
  try {
    await window.lectern.run(command, (event) => {
      events.push(event)
      onEvent?.(event)
    })
  } catch {
    // The channel itself broke, so the command never answered.
    events.push({
      type: 'failed',
      message: 'Lectern could not run this step.',
      fix: 'Run it again. If it keeps failing, restart Lectern.',
    })
  }
  return events
}

function failureOf(events: Event[]): Failure | null {
  const failed = events.find((e) => e.type === 'failed')
  return failed ? { message: failed.message, fix: failed.fix } : null
}

export const useStore = create<State>((set, get) => {
  /** The course the student has open, or is opening. Answers about any other are dropped. */
  let open: string | null = null

  /**
   * A build or send ended while its course was not on show: the Courses list says how it
   * stands now, and a failure waits for the student to open the course.
   */
  async function endedElsewhere(course: string, failure: Failure | null): Promise<void> {
    if (failure) set({ kept: { ...get().kept, [course]: failure } })
    const found = (await ask({ type: 'courses' })).find((e) => e.type === 'courses')
    if (found) set({ courses: found.courses })
  }

  /** Reads the open course again, with the cards of every lecture. */
  async function refresh(course: string): Promise<CourseView | null> {
    const events = await ask({ type: 'course', course })
    if (open !== course) return null
    const state = events.find((e) => e.type === 'course')?.course
    if (!state) {
      set({ failure: failureOf(events) })
      return null
    }
    const lectures = await Promise.all(
      state.lectures.map(async (lecture) => {
        const reply = await ask({ type: 'cards', course, lecture: lecture.number })
        const found = reply.find((e) => e.type === 'cards')
        return { ...lecture, cards: found?.cards ?? [], inAnki: found?.sent ?? [] }
      }),
    )
    if (open !== course) return null
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
    // Another goal or course may have been chosen while this one was counted.
    if (get().goal !== goal || get().course?.id !== course.id) return
    set({ estimate: found ?? null })
    // A failure that is already shown stays: a working estimate says nothing about it.
    const failure = failureOf(events)
    if (failure) set({ failure })
  }

  /**
   * Adds files. Without `to` the engine sorts them, and what it keeps out is listed in the
   * setup panel, with the slide decks, documents and photos that are not PDFs. Other files,
   * hidden ones among them, are dropped without a word: a course folder holds all sorts.
   */
  async function addPdfs(files: Picked[], to?: 'slides' | 'exams'): Promise<void> {
    const { course, sending, adding } = get()
    if (!course || sending || adding) return
    const visible = files.filter(({ file }) => !file.name.startsWith('.'))
    const pdfs = visible.filter(({ file }) => /\.pdf$/i.test(file.name))
    const formats: LeftEntry[] = visible
      .filter(({ file }) => NOT_PDF.test(file.name))
      .map((picked) => ({ path: picked.path, why: 'format', kind: null, picked }))
    if (pdfs.length === 0 && formats.length === 0) {
      set({
        addProblem: {
          message: 'There is no PDF in what you added.',
          fix:
            to === 'exams'
              ? 'Add the exam paper as a PDF.'
              : 'Add the lectures as PDFs, or a folder that holds them.',
        },
      })
      return
    }
    set({ adding: course.id })
    try {
      let left = formats
      let problem: Failure | null = null
      if (pdfs.length > 0) {
        const data = await Promise.all(
          pdfs.map(async ({ path, file }) => ({
            name: path,
            data: new Uint8Array(await file.arrayBuffer()),
          })),
        )
        const events = await ask({ type: 'add', course: course.id, files: data, to })
        problem = failureOf(events)
        const added = events.find((e) => e.type === 'added')
        const picked = new Map(pdfs.map((p) => [p.path, p]))
        left = [...(added?.left ?? []).map((l) => ({ ...l, picked: picked.get(l.path)! })), ...left]
      }
      // An add that failed wrote nothing, so the list stays. Otherwise what this add took in
      // leaves the list, and what it kept out joins it.
      const before = get().leftOut[course.id] ?? []
      const sent = new Set(visible.map((p) => p.path))
      const list = problem ? before : [...before.filter((l) => !sent.has(l.path)), ...left]
      // The problem belongs to the course the files went to, not to the one open by now.
      set({
        addProblem: open === course.id ? problem : get().addProblem,
        leftOut: { ...get().leftOut, [course.id]: list },
      })
      const view = await refresh(course.id)
      if (view && (view.pending.length > 0 || list.length > 0)) {
        set({ panel: 'setup', view: { level: 'course' } })
      }
    } finally {
      set({ adding: null })
    }
    if (open === course.id) await estimate()
  }

  async function deliver(): Promise<void> {
    const { course } = get()
    if (!course) return
    set({
      sending: { course: course.id, done: 0, total: unsentCount(course), lecture: null },
      failure: null,
      addProblem: null,
    })
    const events = await ask({ type: 'send', course: course.id }, (event) => {
      if (event.type !== 'sending') return
      const { done, total, lecture } = event
      set({ sending: { course: course.id, done, total, lecture } })
    })
    set({ sending: null })
    if (get().course?.id !== course.id || get().screen === 'courses') {
      await endedElsewhere(course.id, failureOf(events))
      return
    }
    // Also after a failure: the cards that went before it are in Anki.
    await refresh(course.id)
    // An add that failed meanwhile is old news next to the result of the send.
    set({ failure: failureOf(events), addProblem: null })
  }

  /** The key of a form's card: the card itself, or the concept of a card still being written. */
  const draftKey = (e: Pick<Editor, 'lecture' | 'card' | 'concept'>) =>
    `${e.lecture}/${e.card ?? `new:${e.concept}`}`

  /**
   * The drafts once the open form is closed by a click elsewhere: a form with changes joins
   * them, one without is let go. The student gets a draft back by opening its card again.
   */
  function parked(): Pick<State, 'drafts'> {
    const { editor, drafts } = get()
    if (!editor || editor.busy || JSON.stringify(editor.slots) === editor.start) return { drafts }
    return { drafts: { ...drafts, [draftKey(editor)]: { ...editor, busy: false } } }
  }

  /** Opens the form on a draft, which stops being one. */
  function reopen(key: string): void {
    const { [key]: editor, ...drafts } = get().drafts
    set({ editor: editor ?? null, drafts })
  }

  /** Empty slots of a kind, or the slots of a card, with the limits of the form. */
  async function slotsFor(
    lecture: number,
    of: { card: string } | { role: 'definition' | 'cloze' },
  ): Promise<{ slots: Slots; limits: Limits } | null> {
    const { course } = get()
    if (!course) return null
    const events = await ask({ type: 'slots', course: course.id, lecture, ...of })
    const found = events.find((e) => e.type === 'slots')
    if (!found) set({ failure: failureOf(events) })
    return found ?? null
  }

  /** Runs a command of the form. What the engine refuses stays in the form as its problems. */
  async function submit(command: Command): Promise<void> {
    const { editor, course } = get()
    if (!editor || !course || editor.busy) return
    set({ editor: { ...editor, busy: true, problems: [] } })
    const events = await ask(command)
    // The answer may come late, when the student has another form open or another course.
    const mine = () => {
      const now = get().editor
      return open === course.id &&
        now?.lecture === editor.lecture &&
        now.card === editor.card &&
        now.concept === editor.concept
        ? now
        : null
    }
    const refused = events.find((e) => e.type === 'refused')?.problems
    const failure = failureOf(events)
    const problems: Problem[] =
      refused ?? (failure ? [{ field: 'card', message: `${failure.message} ${failure.fix}` }] : [])
    if (problems.length > 0) {
      const now = mine()
      if (now) set({ editor: { ...now, busy: false, problems } })
      return
    }
    await refresh(course.id)
    if (mine()) set({ editor: null })
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
    sending: null,
    editor: null,
    drafts: {},
    failure: null,
    kept: {},
    addProblem: null,
    adding: null,
    leftOut: {},
    view: { level: 'course' },
    panel: null,
    detailsTab: 'decisions',

    async start() {
      let settings: Settings
      try {
        settings = await window.lectern.settings()
      } catch {
        // Better a screen that says so than a blank window. The list comes up without settings.
        await get().openCourses()
        set({
          failure: {
            message: 'Lectern could not read its settings.',
            fix: 'Restart Lectern. If it keeps failing, check that its data folder can be read.',
          },
        })
        return
      }
      set({ settings })
      if (settings.hasKey) await get().openCourses()
      else set({ screen: 'first-run' })
    },

    async saveKey(key) {
      try {
        const result = await window.lectern.saveKey(key)
        if (result.ok) set({ settings: await window.lectern.settings() })
        return result
      } catch {
        return {
          ok: false,
          message: 'Lectern could not store the key.',
          fix: 'Save the key again. If it keeps failing, restart Lectern.',
        }
      }
    },

    async openCourses() {
      open = null
      const events = await ask({ type: 'courses' })
      const found = events.find((e) => e.type === 'courses')
      set({
        screen: 'courses',
        courses: found?.courses ?? [],
        course: null,
        drafts: {},
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
      open = course
      const { [course]: kept, ...rest } = get().kept
      set({
        failure: kept ?? null,
        kept: rest,
        addProblem: null,
        estimate: null,
        view: { level: 'course' },
        editor: null,
        drafts: {},
      })
      const view = await refresh(course)
      if (!view) return
      const running = get().run?.course === course
      set({
        screen: 'course',
        goal: view.goal,
        panel: running
          ? 'run'
          : view.pending.length > 0 || (get().leftOut[course]?.length ?? 0) > 0
            ? 'setup'
            : null,
      })
      if (!running) await estimate()
    },

    addFiles: (files) => addPdfs(files),
    addExams: (files) => addPdfs(files, 'exams'),

    async addLeftOut(path, to) {
      const { course, leftOut } = get()
      const left = course ? leftOut[course.id]?.find((l) => l.path === path) : undefined
      if (left) await addPdfs([left.picked], to)
    },

    async moveFile(file, to) {
      const { course, adding } = get()
      if (!course || adding) return
      set({ addProblem: failureOf(await ask({ type: 'move', course: course.id, file, to })) })
      await refresh(course.id)
      await estimate()
    },

    async setGoal(goal) {
      set({ goal })
      await estimate()
    },

    async build() {
      const { course, goal, run, sending } = get()
      if (!course || sending) return
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
        addProblem: null,
        panel: 'run',
        view: { level: 'course' },
      })
      const events = await ask({ type: 'build', course: course.id, goal }, (event) => {
        const current = get().run
        if (!current) return
        if (event.type === 'estimate' && get().course?.id === course.id) set({ estimate: event })
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
              phaseStartedAt:
                event.status === 'started'
                  ? { ...current.phaseStartedAt, [event.phase]: Date.now() }
                  : current.phaseStartedAt,
              lecture: null,
            },
          })
        }
        if (event.type === 'progress') {
          const phase: PhaseState = { status: 'started', done: event.done, total: event.total }
          set({
            run: {
              ...current,
              phases: { ...current.phases, [event.phase]: phase },
              lecture: event.lecture ?? null,
            },
          })
        }
      })
      const failure = failureOf(events)
      set({ run: null })
      // The student may have left for another course while the cards were made.
      if (get().course?.id !== course.id || get().screen === 'courses') {
        await endedElsewhere(course.id, failure)
        return
      }
      await refresh(course.id)
      // A failed run keeps its panel open, so the student reads what went wrong and the fix.
      set({ failure, addProblem: null, estimate: null, panel: failure ? 'run' : null })
      if (failure) await estimate()
    },

    async send() {
      if (get().sending) return
      await deliver()
    },

    async editCard(card) {
      const { view } = get()
      if (view.level !== 'lecture') return
      const key = draftKey({ lecture: view.lecture, card: card.id, concept: card.concept.id })
      const draft = get().drafts[key]
      if (draft) return reopen(key)
      const found = await slotsFor(view.lecture, { card: card.id })
      if (!found) return
      set({
        editor: {
          lecture: view.lecture,
          card: card.id,
          concept: card.concept.id,
          ...found,
          start: JSON.stringify(found.slots),
          problems: [],
          busy: false,
        },
      })
    },

    async writeCard(concept) {
      const { view } = get()
      if (view.level !== 'lecture') return
      const key = draftKey({ lecture: view.lecture, card: null, concept })
      if (get().drafts[key]) return reopen(key)
      const found = await slotsFor(view.lecture, { role: 'definition' })
      if (!found) return
      set({
        editor: {
          lecture: view.lecture,
          card: null,
          concept,
          ...found,
          start: JSON.stringify(found.slots),
          problems: [],
          busy: false,
        },
      })
    },

    setEditor(changes) {
      const { editor } = get()
      // A problem is about the text as it was. It goes once the text changes.
      if (editor) set({ editor: { ...editor, ...changes, problems: [] } })
    },

    async setEditorKind(role) {
      const { editor } = get()
      if (!editor || editor.card !== null || editor.slots.role === role) return
      const found = await slotsFor(editor.lecture, { role })
      const now = get().editor
      if (!found || !now) return
      // What is written so far moves over: the question becomes the sentence, and back.
      const { front, extra } = now.slots
      set({ editor: { ...now, slots: { ...found.slots, front, extra }, problems: [] } })
    },

    async saveCard() {
      const { editor, course } = get()
      if (!editor || !course) return
      const place = { course: course.id, lecture: editor.lecture, slots: editor.slots }
      await submit(
        editor.card === null
          ? { type: 'write', ...place, concept: editor.concept }
          : { type: 'edit', ...place, card: editor.card },
      )
    },

    async removeCard() {
      const { editor, course } = get()
      if (!editor || !course || editor.card === null) return
      await submit({
        type: 'remove',
        course: course.id,
        lecture: editor.lecture,
        card: editor.card,
      })
    },

    closeEditor() {
      // Cancel: what was written is let go, with no draft left behind.
      set({ editor: null })
    },

    showCourse() {
      const { panel } = get()
      set({
        view: { level: 'course' },
        panel: panel === 'cards' ? null : panel,
        editor: null,
        ...parked(),
      })
    },

    openLecture(lecture) {
      set({ view: { level: 'lecture', lecture }, panel: 'cards', editor: null, ...parked() })
    },

    selectTopic(topic) {
      const { view } = get()
      if (view.level !== 'lecture') return
      set({
        view: { level: 'lecture', lecture: view.lecture, topic },
        panel: 'cards',
        editor: null,
        ...parked(),
      })
    },

    selectConcept(concept) {
      const { view } = get()
      if (view.level !== 'lecture') return
      set({
        view: { level: 'lecture', lecture: view.lecture, concept },
        panel: 'cards',
        editor: null,
        ...parked(),
      })
      // Coming back to the concept of a draft shows the form as it was left.
      const back = Object.entries(get().drafts).find(
        ([, d]) => d.lecture === view.lecture && d.concept === concept,
      )
      if (back) reopen(back[0])
    },

    openDetails(tab) {
      set({ panel: 'details', detailsTab: tab ?? get().detailsTab, editor: null, ...parked() })
    },

    openPanel(panel) {
      set({ panel })
    },

    closePanel() {
      const { view } = get()
      // Closing the cards of a concept or topic keeps the lecture and drops the selection.
      set({
        panel: null,
        editor: null,
        ...parked(),
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

/** The phase running now, or null before the first starts. */
export function currentPhase(run: RunState): Phase | null {
  return PHASES.find((p) => run.phases[p].status === 'started') ?? null
}

/** Where the open course stands. */
export function stageOf(course: CourseView, run: RunState | null): Stage {
  if (run?.course === course.id) return 'running'
  if (course.pending.length > 0) return 'setup'
  return course.lectures.length > 0 ? 'ready' : 'empty'
}

export function cardCount(course: CourseView): number {
  return course.lectures.reduce((sum, l) => sum + l.cards.length, 0)
}

/** The cards that are made and not in Anki yet. */
export function unsentCount(course: CourseView): number {
  return course.lectures.reduce((sum, l) => sum + l.cards.length - l.sent, 0)
}

export function conceptCount(course: CourseView): number {
  return course.lectures.reduce(
    (sum, l) => sum + l.topics.reduce((n, t) => n + t.concepts.length, 0),
    0,
  )
}

/** The cards of one concept of a lecture. */
export function cardsOfConcept(lecture: Lecture, concept: string): Card[] {
  return lecture.cards.filter((c) => c.concept.id === concept)
}

/** The cards the side panel lists for the map's selection, in the lecture's own order. */
export function selectedCards(lecture: Lecture, view: View): Card[] {
  if (view.level !== 'lecture') return []
  if (view.concept) return cardsOfConcept(lecture, view.concept)
  if (view.topic !== undefined) {
    const ids = new Set(lecture.topics[view.topic]?.concepts.map((c) => c.id))
    return lecture.cards.filter((c) => ids.has(c.concept.id))
  }
  return lecture.cards
}
