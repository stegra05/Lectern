/**
 * What an interface needs besides building: the list of courses, the state of one course,
 * the cards of a lecture, and the two ways a course grows (create it, add PDFs to it).
 * Everything is read from the plain files of the course folders; no model is involved.
 */

import type { CardFile } from './cards/assemble.ts'
import type { Goal } from './cards/roles.ts'
import { slug } from './cards/words.ts'
import {
  inCourseOrder,
  paths,
  readCards,
  readJson,
  writeJson,
  type Concept,
  type CourseFile,
  type Decision,
  type Lecture,
  type Run,
} from './course.ts'
import { EngineError } from './errors.ts'
import type { Store } from './ports.ts'

export interface CourseSummary {
  /** The folder name: what every command takes as `course`. */
  id: string
  name: string
  goal: Goal
  lectures: number
  cards: number
  /** PDFs that are in the course but have no cards yet. */
  pending: number
}

export interface LectureState extends Omit<Lecture, 'topics'> {
  cards: number
  topics: { name: string; concepts: (Concept & { cards: number })[] }[]
}

export interface CourseState extends Omit<CourseFile, 'format' | 'lectures'> {
  id: string
  lectures: LectureState[]
  /** PDFs waiting for the next build, in course order. */
  pending: string[]
  decisions: Decision[]
  runs: Run[]
}

async function courseFile(store: Store, course: string): Promise<CourseFile> {
  const file = await readJson<CourseFile>(store, paths.course(course))
  if (!file) throw new EngineError(`No course found in ${course}.`, 'Create the course first.')
  return file
}

async function pendingSlides(store: Store, course: string, file: CourseFile): Promise<string[]> {
  const built = new Set(file.lectures.map((l) => l.file))
  return inCourseOrder(await store.list(paths.slides(course))).filter((f) => !built.has(f))
}

export async function listCourses(store: Store): Promise<CourseSummary[]> {
  const out: CourseSummary[] = []
  for (const id of (await store.list('')).sort()) {
    const file = await readJson<CourseFile>(store, paths.course(id)).catch(() => null)
    if (!file) continue
    let cards = 0
    for (const { number } of file.lectures) cards += (await readCards(store, id, number)).length
    const pending = (await pendingSlides(store, id, file)).length
    out.push({
      id,
      name: file.name,
      goal: file.goal,
      lectures: file.lectures.length,
      cards,
      pending,
    })
  }
  return out
}

export async function readCourse(store: Store, course: string): Promise<CourseState> {
  const file = await courseFile(store, course)
  const lectures: LectureState[] = []
  for (const { number } of file.lectures) {
    const lecture = (await readJson<Lecture>(store, paths.lecture(course, number)))!
    const cards = await readCards(store, course, number)
    const count = (concept: string) => cards.filter((card) => card.concept === concept).length
    lectures.push({
      ...lecture,
      cards: cards.length,
      topics: lecture.topics.map((topic) => ({
        name: topic.name,
        concepts: topic.concepts.map((concept) => ({ ...concept, cards: count(concept.id) })),
      })),
    })
  }
  const runs: Run[] = []
  for (const name of (await store.list(paths.runs(course))).sort()) {
    runs.push((await readJson<Run>(store, `${paths.runs(course)}/${name}`))!)
  }
  return {
    id: course,
    name: file.name,
    goal: file.goal,
    ...(file.profile ? { profile: file.profile } : {}),
    lectures,
    pending: await pendingSlides(store, course, file),
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
 * Copies PDFs from the student's disk into the course. Nothing is copied unless every file
 * can be: a lecture is known by its file name, so a name is never taken twice.
 */
export async function addSlides(
  store: Store,
  course: string,
  sources: string[],
): Promise<string[]> {
  await courseFile(store, course)
  const present = new Set(await store.list(paths.slides(course)))
  const names = sources.map((source) => source.split(/[\\/]/).at(-1)!)
  for (const [i, name] of names.entries()) {
    if (!name.toLowerCase().endsWith('.pdf')) {
      throw new EngineError(`${name} is not a PDF.`, 'Export the slides as PDF and add that file.')
    }
    if (present.has(name) || names.indexOf(name) !== i) {
      throw new EngineError(
        `The course already has a file named ${name}.`,
        'Rename the new file, then add it again.',
      )
    }
  }
  for (const [i, source] of sources.entries()) {
    await store.copyIn(source, `${paths.slides(course)}/${names[i]!}`)
  }
  return names
}
