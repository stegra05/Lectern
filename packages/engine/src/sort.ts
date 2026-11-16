/**
 * What kind of document each added PDF is, so a course folder can be added whole: lecture slides
 * become lectures, past exams become exam papers, and everything else stays out of the course.
 * A file or folder name can only keep a file out. What comes in is decided by the decision model
 * on the first pages ([RFD 5](../../../docs/rfd/0005-decision-models.md)).
 */

import PQueue from 'p-queue'
import { EngineError, ProviderError } from './errors.ts'
import type { Answer, DecisionsPort, PdfPort, Question, SlideImage, Usage } from './ports.ts'

export const FILE_KINDS = [
  'slides',
  'notes',
  'exam',
  'exam-solution',
  'exercise',
  'exercise-solution',
  'reading',
  'organisation',
] as const
export type FileKind = (typeof FILE_KINDS)[number]

/** Whether files of this kind come into the course: lecture slides and past exams do. */
export const entersCourse = (kind: FileKind): boolean => kind === 'slides' || kind === 'exam'

/** What each kind is, as the decision model reads it beside the file's name and first pages. */
export const KIND_DESCRIPTIONS: Record<FileKind, string> = {
  slides: 'The slide deck of a lecture.',
  notes: 'A script, notes or a summary of a lecture, written as running text.',
  exam: 'An exam paper: questions students had to answer in a test, without the answers.',
  'exam-solution': 'The solution of an exam: exam questions with their answers.',
  exercise: 'An exercise sheet: tasks for students to work on, without the answers.',
  'exercise-solution': 'The solution of an exercise sheet: tasks with their answers.',
  reading: 'A reading: a research paper, an article or a chapter of a book.',
  organisation: 'About the organisation of the course: dates, rules, grading or the syllabus.',
}

/**
 * The one question the decision model answers about a file. The kinds share one whole, so a
 * file that could be two kinds, an exam paper that opens with a page of rules for instance, gets
 * a low probability for either instead of a high one for both.
 */
export const KIND_QUESTION: Question = {
  type: 'choice',
  ask: 'Which kind of document is this?',
  choices: FILE_KINDS,
  descriptions: KIND_DESCRIPTIONS,
}

/**
 * The lowest probability at which the decision model's kind is taken. Below it, the kind is
 * unknown and the file stays out, so a stray PDF never becomes a lecture; the student sees it
 * listed and can add it by hand. Not measured yet (#219).
 */
export const SORT_THRESHOLD = 0.5

/** Decision requests that run at the same time while files are sorted. */
const PARALLEL = 4

/** How much of the first pages the decision model reads. */
const FIRST_PAGES = 3
const MAX_CHARACTERS = 2000

const has = (pattern: RegExp) => (segment: string) => pattern.test(segment)
const isSolution = has(/l(ö|oe)sung|\blsg\b|solution|answers?\b/i)
const isExam = has(/klausur|\bexams?\b|examination|pr(ü|ue)fung|endterm|\bmock\b/i)
const isNotes = has(
  /skript|\bscript\b|lecture notes|notizen|mitschrift|zusammenfassung|summary|cheat ?sheet|formelsammlung|formula sheet/i,
)
/**
 * A midterm counts as an exercise: in the courses seen so far it is a graded take-home
 * assignment, not a paper whose questions come back in the exam (Steffen, 2026-11-16).
 */
const isExercise = has(
  /midterm|(ü|ue)bung|exercise|tutorial|tutorium|\bblatt|\bsheet\b|homework|hausaufgabe|assignment|problem set|aufgaben|\btraining\b|\bquestions\b/i,
)
const isOrganisation = has(
  /syllabus|\borgani[sz]ation\b|\borga\b|modulbeschreibung|zeitplan|schedule|course info/i,
)
const isReading = has(/\breadings?\b|literatur/i)
const isSlides = has(/vorlesung|lecture|folien|slides|\bvl\b|\bweek\b|woche|lektion/i)

/**
 * Folders no course material lives in: hidden ones, and those of code projects and their
 * builds, which a student's course folder often holds. Measured on 740 PDFs of real course
 * folders, where `.venv` alone held dozens of icons as PDFs.
 */
const JUNK_FOLDER = /^(\..*|venv|node_modules|site-packages|__pycache__|build|dist|target)$/i

/** Whether a path runs through a folder no course material lives in. Such a file is dropped. */
export function isJunkPath(path: string): boolean {
  return path
    .split(/[\\/]/)
    .slice(0, -1)
    .some((folder) => JUNK_FOLDER.test(folder))
}

/**
 * The kind a file's path names, or null when it names none. The file name is read first, then
 * its folders from the innermost out, so `Altklausuren/2019.pdf` is an exam. A solution word
 * only counts with an exam or exercise word beside it or above it.
 *
 * A name is a hint, not proof: "Rules for the Summer 2022 exam" and "Exam Playbook" name an exam
 * and are none. So `sortFiles` trusts it only to keep a file out.
 */
export function kindFromName(path: string): FileKind | null {
  const segments = path
    .normalize('NFC')
    .split(/[\\/]/)
    .filter(Boolean)
    .map((segment) => segment.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '))
    .reverse()
  let solution = false
  for (const segment of segments) {
    solution ||= isSolution(segment)
    if (isExam(segment)) return solution ? 'exam-solution' : 'exam'
    if (isExercise(segment) && !isNotes(segment)) return solution ? 'exercise-solution' : 'exercise'
    if (solution) continue
    if (isNotes(segment)) return 'notes'
    if (isSlides(segment)) return 'slides'
    if (isOrganisation(segment)) return 'organisation'
    if (isReading(segment)) return 'reading'
  }
  return null
}

/** The file name and the first pages, as the decision model reads them. */
export function sortInput(path: string, pages: string[][]): string {
  const text = pages
    .slice(0, FIRST_PAGES)
    .map((lines) => lines.join('\n'))
    .join('\n\n')
    .slice(0, MAX_CHARACTERS)
  return `A PDF from the folder of a university course.\nFile: ${path}\nIts first pages:\n${text}`
}

/** The kind the decision model chose, or null when it is less sure than `SORT_THRESHOLD`. */
export function kindFromAnswer(answer: Answer | undefined): FileKind | null {
  if (answer?.type !== 'choice' || answer.probability < SORT_THRESHOLD) return null
  return FILE_KINDS.find((kind) => kind === answer.choice) ?? null
}

/** A PDF to sort: as it was given, its bytes and the text of its pages. */
export interface SortFile {
  path: string
  bytes: Uint8Array
  pages: string[][]
}

/**
 * The decision model's answer to `KIND_QUESTION`, from the file's name and its first pages. A
 * scan without text sends its first page as a picture instead.
 */
export async function askKind(
  { decisions, pdf }: { decisions: DecisionsPort; pdf: PdfPort },
  { path, bytes, pages }: SortFile,
  onUsage: (usage: Usage) => void = () => {},
): Promise<Answer | undefined> {
  const images: SlideImage[] = pages.slice(0, FIRST_PAGES).some((lines) => lines.length > 0)
    ? []
    : await pdf.renderSlides(bytes, [1])
  const [answer] = await decisions.decide({
    context: sortInput(path, pages),
    images,
    questions: [KIND_QUESTION],
    onUsage,
  })
  return answer
}

/** What to do before adding the files again, by what stopped the decision model. */
const ADD_AGAIN: Record<Exclude<ProviderError['reason'], 'rejected'>, string> = {
  key: 'Check the key in OPENAI_API_KEY, then add the files again.',
  credit: 'Add credit to the account, then add the files again.',
  limit: 'Wait a minute, then add the files again.',
  connection: 'Check the internet connection, then add the files again.',
  server: 'Wait a few minutes, then add the files again.',
}

/**
 * The kind of every file, in order, or null where the decision model is not sure.
 *
 * A request the provider rejects for what one file holds leaves only that file unsure. A failure
 * of the key, the account or the connection stops the sort, with what to do before adding again.
 *
 * A name can keep a file out and nothing more: a file named as an exercise sheet or a reading
 * stays out unread, which costs the student one click when the name was wrong. A file that would
 * come in, by its name or because its name says nothing, costs one decision request on its first
 * pages, since a wrong lecture costs a build and a wrong exam paper skews the questions asked.
 */
export async function sortFiles(
  ports: { decisions: DecisionsPort; pdf: PdfPort },
  files: SortFile[],
): Promise<(FileKind | null)[]> {
  // After the first failure no further request starts.
  const queue = new PQueue({ concurrency: PARALLEL })
  const kinds = files.map((file) =>
    queue.add(async () => {
      const named = kindFromName(file.path)
      if (named && !entersCourse(named)) return named
      const answer = await askKind(ports, file).catch((error: unknown) => {
        if (!(error instanceof ProviderError)) throw error
        if (error.reason === 'rejected') return undefined
        throw new EngineError(error.message, ADD_AGAIN[error.reason])
      })
      return kindFromAnswer(answer)
    }),
  )
  return Promise.all(kinds).finally(() => queue.clear())
}
