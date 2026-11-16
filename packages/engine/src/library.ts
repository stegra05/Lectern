/**
 * What an interface needs besides building: the list of courses, the state of one course,
 * the cards of a lecture, a slide as a picture, and the two ways a course grows (create it,
 * add PDFs to it). Everything comes from the plain files of the course folders; no model is
 * involved.
 */

import type { Card } from './cards/card.ts'
import type { Goal } from './cards/roles.ts'
import { slug } from './cards/words.ts'
import {
  assignNumbers,
  inCourseOrder,
  paths,
  readCards,
  readJson,
  sha256,
  titleFromFile,
  writeJson,
  type Concept,
  type CourseFile,
  type Decision,
  type Lecture,
  type Run,
} from './course.ts'
import { sentCards } from './deliver.ts'
import { cannotRead, EngineError, orUnreadable, type Unreadable } from './errors.ts'
import type { ExamsFile } from './exams.ts'
import type { PdfPort, Ports, SlideImage, Store } from './ports.ts'
import { entersCourse, isJunkPath, sortFiles, type FileKind } from './sort.ts'

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
  /** Why the file cannot be read, when it cannot. It has no slides then, and no build takes it. */
  unreadable?: Unreadable
}

export interface CourseState extends Omit<CourseFile, 'format' | 'lectures'> {
  id: string
  lectures: LectureState[]
  /** In course order. */
  pending: PendingLecture[]
  /** The past papers in the course, in file order. */
  exams: PaperState[]
  decisions: Decision[]
  runs: Run[]
}

/** One past paper: its file, and how many questions a build read from it, or null before. */
export interface PaperState {
  file: string
  questions: number | null
  /** Why the file cannot be read, when it cannot. No build reads it then. */
  unreadable?: Unreadable
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
    let file: CourseFile | null
    try {
      file = await readJson<CourseFile>(store, paths.course(id))
    } catch (error) {
      if (!(error instanceof EngineError)) throw error
      // A damaged course stays in the list under its folder name, and opening it names the file.
      out.push({ id, name: id, goal: 'good', built: [], pending: [], cards: 0 })
      continue
    }
    if (!file) continue
    let cards = 0
    for (const { number } of file.lectures) {
      // A damaged card file counts as none here; opening the course names it.
      cards += (await readCards(store, id, number).catch(() => [])).length
    }
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
    const count = (concept: string) => cards.filter((card) => card.concept.id === concept).length
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
    const title = titleFromFile(name, number)
    const slides = await orUnreadable(
      pdf.readSlides(await store.readBytes(`${paths.slides(course)}/${name}`)),
    )
    if (typeof slides === 'string')
      pending.push({ file: name, number, title, slides: 0, unreadable: slides })
    else pending.push({ file: name, number, title, slides: slides.length })
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
    exams: await papers(store, pdf, course),
    decisions: (await readJson<Decision[]>(store, paths.decisions(course))) ?? [],
    runs,
  }
}

export async function readLectureCards(
  store: Store,
  course: string,
  lecture: number,
): Promise<Card[]> {
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
  const slides = await orUnreadable(pdf.readSlides(bytes))
  if (typeof slides === 'string') throw cannotRead(name, slides)
  if (slide > slides.length) {
    throw new EngineError(
      `Lecture ${lecture} has no slide ${slide}.`,
      'Open a slide the lecture has.',
    )
  }
  return (await pdf.renderSlides(bytes, [slide]))[0]!
}

/**
 * A new, empty course. Its folder name is made from the name and never reused, whatever the
 * spelling of a folder there is: macOS and Windows take `Econ` and `econ` for the same folder.
 */
export async function createCourse(store: Store, name: string, goal: Goal): Promise<string> {
  const spelling = (folder: string) => folder.normalize('NFC').toLowerCase()
  const taken = new Set((await store.list('')).map(spelling))
  const base = slug(name) || 'course'
  let id = base
  for (let n = 2; taken.has(spelling(id)); n++) id = `${base}-${n}`
  await writeJson(store, paths.course(id), {
    format: 1,
    name: name.trim(),
    goal,
    lectures: [],
  } satisfies CourseFile)
  return id
}

/**
 * The past papers of a course: those a build read, with their questions, and those it has not,
 * with why one of those cannot be read.
 */
async function papers(store: Store, pdf: PdfPort, course: string): Promise<PaperState[]> {
  const read = (await readJson<ExamsFile>(store, paths.examsFile(course)))?.papers ?? []
  const files = (await store.list(paths.exams(course))).filter((f) => /\.pdf$/i.test(f)).sort()
  const out: PaperState[] = []
  for (const file of files) {
    const questions = read.find((paper) => paper.file === file)?.questions.length ?? null
    if (questions !== null) {
      out.push({ file, questions })
      continue
    }
    const pages = await orUnreadable(
      pdf.readSlides(await store.readBytes(`${paths.exams(course)}/${file}`)),
    )
    out.push(
      typeof pages === 'string' ? { file, questions, unreadable: pages } : { file, questions },
    )
  }
  return out
}

/** Where an added PDF goes: lecture slides or past exam papers. */
export type Shelf = 'slides' | 'exams'

/** A file of an add that stayed out of the course, and why. */
export interface LeftOut {
  /** As it was given: its name, or its path inside the folder it came in. */
  path: string
  /**
   * `kind`: a kind the course does not use yet, such as an exercise sheet. `unsure`: the
   * decision model could not tell. `already`: the course has a file of that name or that
   * content, or this add holds the same file twice. `password` and `damaged`: a PDF that cannot
   * be read, for that reason; a file that only has the name of a PDF counts as damaged.
   */
  why: 'kind' | 'unsure' | 'already' | Unreadable
  kind: FileKind | null
}

export interface Added {
  added: { file: string; to: Shelf }[]
  left: LeftOut[]
}

const looksLikePdf = (name: string, bytes: Uint8Array) =>
  name.toLowerCase().endsWith('.pdf') && String.fromCharCode(...bytes.slice(0, 4)) === '%PDF'

/**
 * Adds PDFs to the course: lecture slides, which the next build turns into lectures, and past
 * exam papers, whose questions the next build turns into cards for the lectures it builds.
 *
 * With `to`, every file goes there, and nothing is added unless every file can be. Without it,
 * each file is sorted by its kind ([sort.ts](sort.ts)), and only lecture slides and past exams
 * come in. Everything else stays out of the course and is listed, so a whole course folder can
 * be added, and added again once new lectures are in it. The same file under a second name comes
 * in once: a paper counted twice would double how often its questions were asked.
 */
export async function addFiles(
  { store, pdf, decisions }: Ports,
  course: string,
  files: { name: string; data: Uint8Array }[],
  to?: Shelf,
): Promise<Added> {
  await courseFile(store, course)
  const present = new Set([
    ...(await store.list(paths.slides(course))),
    ...(await store.list(paths.exams(course))),
  ])
  const names = fileNames(files.map((file) => file.name))
  const pdfs = files.map(({ name, data }, i) => ({ path: name, name: names[i]!, bytes: data }))
  const taken = (name: string, i: number) =>
    present.has(name) || pdfs.findIndex((other) => other.name === name) !== i

  if (to) {
    for (const [i, { name, bytes }] of pdfs.entries()) {
      if (!looksLikePdf(name, bytes)) {
        const what = to === 'exams' ? 'the exam paper' : 'the slides'
        throw new EngineError(`${name} is not a PDF.`, `Export ${what} as PDF and add that file.`)
      }
      if (taken(name, i)) {
        throw new EngineError(
          `The course already has a file named ${name}.`,
          'Rename the new file, then add it again.',
        )
      }
      const pages = await orUnreadable(pdf.readSlides(bytes))
      if (typeof pages === 'string') throw cannotRead(name, pages)
    }
    for (const { name, bytes } of pdfs)
      await store.writeBytes(`${paths[to](course)}/${name}`, bytes)
    return { added: pdfs.map(({ name }) => ({ file: name, to })), left: [] }
  }

  // Files in hidden folders or code projects are no course material; they are not even listed.
  const courseFiles = pdfs.filter(({ path }) => !isJunkPath(path))
  // Content the course holds, and a second copy inside this add, stay out before any request is
  // paid for them, so adding a folder again costs nothing for what it took in before.
  const held = new Set<string>()
  for (const shelf of ['slides', 'exams'] as const) {
    for (const name of await store.list(paths[shelf](course)))
      held.add(await sha256(await store.readBytes(`${paths[shelf](course)}/${name}`)))
  }
  const left: LeftOut[] = []
  const readable: ((typeof pdfs)[number] & { pages: string[][] })[] = []
  for (const file of courseFiles) {
    const content = await sha256(file.bytes)
    if (taken(file.name, pdfs.indexOf(file)) || held.has(content)) {
      left.push({ path: file.path, why: 'already', kind: null })
      continue
    }
    held.add(content)
    // Read before the sort, so a file that cannot be read costs no request.
    const pages = looksLikePdf(file.name, file.bytes)
      ? await orUnreadable(pdf.readSlides(file.bytes))
      : 'damaged'
    if (typeof pages === 'string') left.push({ path: file.path, why: pages, kind: null })
    else if (pages.length === 0) left.push({ path: file.path, why: 'damaged', kind: null })
    else readable.push({ ...file, pages })
  }
  const kinds = await sortFiles({ pdf, decisions }, readable)
  const added: Added['added'] = []
  for (const [i, { path, name, bytes }] of readable.entries()) {
    const kind = kinds[i]!
    if (!kind || !entersCourse(kind)) {
      left.push({ path, why: kind ? 'kind' : 'unsure', kind })
      continue
    }
    const shelf: Shelf = kind === 'slides' ? 'slides' : 'exams'
    await store.writeBytes(`${paths[shelf](course)}/${name}`, bytes)
    added.push({ file: name, to: shelf })
  }
  return { added, left }
}

/**
 * Moves a file between lecture slides and past exams, for a file that was sorted wrongly, or
 * out of the course, for a file that should not be in it. Out deletes the course's copy only:
 * the student's own file was never touched, and adding it again brings it back. Only a file no
 * build has used yet can move: a built lecture or a paper that was read stays. A lecture gets
 * its number when it is built, so a file without cards taken out leaves no gap.
 */
export async function moveFile(
  store: Store,
  course: string,
  file: string,
  to: Shelf | 'out',
): Promise<void> {
  const state = await courseFile(store, course)
  const shelves: Shelf[] =
    to === 'out' ? ['slides', 'exams'] : [to === 'exams' ? 'slides' : 'exams']
  let from: Shelf | undefined
  for (const shelf of shelves) {
    if (!(await store.list(paths[shelf](course))).includes(file)) continue
    from = shelf
    break
  }
  if (!from) {
    const what = to === 'out' ? 'file' : to === 'slides' ? 'past exam' : 'lecture'
    throw new EngineError(`The course has no ${what} named ${file}.`, 'Move a file the course has.')
  }
  const read = (await readJson<ExamsFile>(store, paths.examsFile(course)))?.papers ?? []
  if (state.lectures.some((l) => l.file === file) || read.some((p) => p.file === file)) {
    throw new EngineError(
      `${file} has cards already, so it ${to === 'out' ? 'stays in the course' : 'cannot move'}.`,
      `Only a file without cards can be ${to === 'out' ? 'taken out' : 'moved'}.`,
    )
  }
  if (to === 'out') await store.remove(`${paths[from](course)}/${file}`)
  else await store.move(`${paths[from](course)}/${file}`, `${paths[to](course)}/${file}`)
}

/**
 * The course's names for files added together, given as names or as paths inside a folder: a
 * file keeps its own name, unless another file has the same one, as `Week 1/slides.pdf` and
 * `Week 2/slides.pdf` do. Those take their path below the folders all files share, joined with
 * spaces: `Week 1 slides.pdf`.
 */
function fileNames(paths: string[]): string[] {
  const parts = paths.map((path) => path.normalize('NFC').split(/[\\/]/).filter(Boolean))
  const own = parts.map((p) => p.at(-1)!)
  let shared = 0
  while (parts.every((p) => p.length - 1 > shared && p[shared] === parts[0]![shared])) shared += 1
  return parts.map((p, i) =>
    own.filter((name) => name === own[i]).length > 1 ? p.slice(shared).join(' ') : own[i]!,
  )
}
