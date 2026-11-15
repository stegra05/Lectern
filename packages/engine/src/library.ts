/**
 * What an interface needs besides building: the list of courses, the state of one course,
 * the cards of a lecture, a slide as a picture, and the two ways a course grows (create it,
 * add PDFs to it). Everything comes from the plain files of the course folders; no model is
 * involved.
 */

import type { CardFile } from './cards/assemble.ts'
import type { Goal } from './cards/roles.ts'
import { slug } from './cards/words.ts'
import {
  assignNumbers,
  inCourseOrder,
  paths,
  readCards,
  readJson,
  titleFromFile,
  writeJson,
  type Concept,
  type CourseFile,
  type Decision,
  type Lecture,
  type Run,
} from './course.ts'
import { sentCards } from './deliver.ts'
import { EngineError } from './errors.ts'
import type { Ports, SlideImage, Store } from './ports.ts'

export interface CourseSummary {
  /** The folder name: what every command takes as `course`. */
  id: string
  name: string
  goal: Goal
  /** The numbers of the lectures that have cards. */
  built: number[]
  /** The numbers the PDFs without cards will get when they are built. */
  pending: number[]
  cards: number
}

export interface LectureState extends Omit<Lecture, 'topics'> {
  cards: number
  /** How many of its cards are in Anki. */
  sent: number
  topics: { name: string; concepts: (Concept & { cards: number })[] }[]
}

/** A PDF that is in the course but has no cards yet. */
export interface PendingLecture {
  file: string
  /** The number the next build will give it. */
  number: number
  /** Guessed from the file name. The build replaces it with the lecture's real name. */
  title: string
  slides: number
}

export interface CourseState extends Omit<CourseFile, 'format' | 'lectures'> {
  id: string
  lectures: LectureState[]
  /** In course order. */
  pending: PendingLecture[]
  decisions: Decision[]
  runs: Run[]
}

async function courseFile(store: Store, course: string): Promise<CourseFile> {
  const file = await readJson<CourseFile>(store, paths.course(course))
  if (!file) throw new EngineError(`No course found in ${course}.`, 'Create the course first.')
  return file
}

/** The PDFs no lecture has yet, with the numbers a build would give them. */
async function pendingFiles(store: Store, course: string, file: CourseFile) {
  const built = new Set(file.lectures.map((l) => l.file))
  const files = inCourseOrder(await store.list(paths.slides(course))).filter((f) => !built.has(f))
  const numbers = assignNumbers(
    file.lectures.map((l) => l.number),
    files,
  )
  return files.map((name, i) => ({ file: name, number: numbers[i]! }))
}

export async function listCourses(store: Store): Promise<CourseSummary[]> {
  const out: CourseSummary[] = []
  for (const id of (await store.list('')).sort()) {
    const file = await readJson<CourseFile>(store, paths.course(id)).catch(() => null)
    if (!file) continue
    let cards = 0
    for (const { number } of file.lectures) cards += (await readCards(store, id, number)).length
    out.push({
      id,
      name: file.name,
      goal: file.goal,
      built: file.lectures.map((l) => l.number),
      pending: (await pendingFiles(store, id, file)).map((p) => p.number),
      cards,
    })
  }
  return out
}

export async function readCourse({ store, pdf }: Ports, course: string): Promise<CourseState> {
  const file = await courseFile(store, course)
  const lectures: LectureState[] = []
  const inAnki = await sentCards(store, course)
  for (const { number } of file.lectures) {
    const lecture = (await readJson<Lecture>(store, paths.lecture(course, number)))!
    const cards = await readCards(store, course, number)
    const count = (concept: string) => cards.filter((card) => card.concept === concept).length
    lectures.push({
      ...lecture,
      cards: cards.length,
      sent: cards.filter((card) => inAnki.has(card.id)).length,
      topics: lecture.topics.map((topic) => ({
        name: topic.name,
        concepts: topic.concepts.map((concept) => ({ ...concept, cards: count(concept.id) })),
      })),
    })
  }
  const pending: PendingLecture[] = []
  for (const { file: name, number } of await pendingFiles(store, course, file)) {
    const slides = await pdf.readSlides(await store.readBytes(`${paths.slides(course)}/${name}`))
    pending.push({ file: name, number, title: titleFromFile(name, number), slides: slides.length })
  }
  const runs: Run[] = []
  for (const name of (await store.list(paths.runs(course))).sort()) {
    runs.push((await readJson<Run>(store, `${paths.runs(course)}/${name}`))!)
  }
  return {
    id: course,
    name: file.name,
    goal: file.goal,
    lectures,
    pending,
    decisions: (await readJson<Decision[]>(store, paths.decisions(course))) ?? [],
    runs,
  }
}

export async function readLectureCards(
  store: Store,
  course: string,
  lecture: number,
): Promise<CardFile[]> {
  await courseFile(store, course)
  return readCards(store, course, lecture)
}

/** One slide of a lecture as a picture, whether the lecture has cards yet or not. */
export async function renderSlide(
  { store, pdf }: Ports,
  course: string,
  lecture: number,
  slide: number,
): Promise<SlideImage> {
  const file = await courseFile(store, course)
  const name =
    file.lectures.find((l) => l.number === lecture)?.file ??
    (await pendingFiles(store, course, file)).find((p) => p.number === lecture)?.file
  if (!name)
    throw new EngineError(
      `The course has no lecture ${lecture}.`,
      'Open a lecture from the course.',
    )
  const bytes = await store.readBytes(`${paths.slides(course)}/${name}`)
  if (slide > (await pdf.readSlides(bytes)).length) {
    throw new EngineError(
      `Lecture ${lecture} has no slide ${slide}.`,
      'Open a slide the lecture has.',
    )
  }
  return (await pdf.renderSlides(bytes, [slide]))[0]!
}

/** A new, empty course. Its folder name is made from the name and never reused. */
export async function createCourse(store: Store, name: string, goal: Goal): Promise<string> {
  const taken = new Set(await store.list(''))
  const base = slug(name) || 'course'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  await writeJson(store, paths.course(id), {
    format: 1,
    name: name.trim(),
    goal,
    lectures: [],
  } satisfies CourseFile)
  return id
}

/**
 * Adds PDFs to the course. Nothing is added unless every file can be: a lecture is known by
 * its file name, so a name is never taken twice.
 */
export async function addSlides(
  store: Store,
  course: string,
  files: { name: string; data: Uint8Array }[],
): Promise<string[]> {
  await courseFile(store, course)
  const present = new Set(await store.list(paths.slides(course)))
  const pdfs = files.map(({ name, data }) => ({ name: name.split(/[\\/]/).at(-1)!, bytes: data }))
  for (const [i, { name, bytes }] of pdfs.entries()) {
    const isPdf =
      name.toLowerCase().endsWith('.pdf') && String.fromCharCode(...bytes.slice(0, 4)) === '%PDF'
    if (!isPdf)
      throw new EngineError(`${name} is not a PDF.`, 'Export the slides as PDF and add that file.')
    if (present.has(name) || pdfs.findIndex((other) => other.name === name) !== i) {
      throw new EngineError(
        `The course already has a file named ${name}.`,
        'Rename the new file, then add it again.',
      )
    }
  }
  for (const { name, bytes } of pdfs)
    await store.writeBytes(`${paths.slides(course)}/${name}`, bytes)
  return pdfs.map((pdf) => pdf.name)
}
