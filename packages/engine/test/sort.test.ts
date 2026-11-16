import { describe, expect, it } from 'vitest'
import type { DecisionsPort, PdfPort } from '../src/ports.ts'
import {
  isJunkPath,
  kindFromAnswer,
  kindFromName,
  KIND_QUESTION,
  SORT_THRESHOLD,
  sortFiles,
} from '../src/sort.ts'

describe('the kind a path names', () => {
  it.each([
    ['Vorlesung 03 Effectuation.pdf', 'slides'],
    ['Lecture_04_Lean_Startup.pdf', 'slides'],
    ['Folien/Kapitel 2.pdf', 'slides'],
    ['Altklausuren/2019 WS.pdf', 'exam'],
    ['Klausur_SoSe_2023.pdf', 'exam'],
    ['Exams/Midterm.pdf', 'exercise'],
    ['Midterm 3 (S6).pdf', 'exercise'],
    ['GRABERT Steffen, Midterm 1.pdf', 'exercise'],
    ['Altklausuren/Lösungen/2019 WS.pdf', 'exam-solution'],
    ['Klausur 2023 Musterlösung.pdf', 'exam-solution'],
    ['Übungen/Blatt 03.pdf', 'exercise'],
    ['Uebung_05.pdf', 'exercise'],
    ['Tutorial/Sheet 2 Solution.pdf', 'exercise-solution'],
    ['Skript_komplett.pdf', 'notes'],
    ['Zusammenfassung Entrepreneurship.pdf', 'notes'],
    ['Cheat sheet.pdf', 'notes'],
    ['Syllabus WS 25.pdf', 'organisation'],
    // Found among the PDFs of real course folders.
    ['Klausuren/U\u0308bungen/Blatt05.pdf', 'exercise'],
    ['Lecture 3 - Organizational_Privacy.pdf', 'slides'],
    ['lecture/1_Organization.pdf', 'organisation'],
    ['Klausuren/WS22 Endterm Lsg.pdf', 'exam-solution'],
    ['Study Kit/Mock Papers.pdf', 'exam'],
    ['04_Readings/1_Krapp - An Enticing Offer.pdf', 'reading'],
    ['training/Week 1_Training questions.pdf', 'exercise'],
    ['Week 3_Cost estimation - Training questions - Solutions.pdf', 'exercise-solution'],
    ['Analysis/Klausurtraining/WS11 Endterm.pdf', 'exam'],
  ] as const)('%s is %s', (path, kind) => {
    expect(kindFromName(path)).toBe(kind)
  })

  it.each([
    'Introduction.pdf',
    '01_Effectuation.pdf',
    'Examples of business models.pdf',
    'Sarasvathy 2001.pdf',
    'Lösungen/03.pdf',
    'Transcript_of_records.pdf',
  ])('%s names no kind, so the decision model judges it', (path) => {
    expect(kindFromName(path)).toBeNull()
  })
})

describe('the kind the decision model chose', () => {
  const answer = (choice: string, probability: number) =>
    ({ type: 'choice', choice, probability }) as const

  it('takes the chosen kind from the threshold on', () => {
    expect(kindFromAnswer(answer('exam', SORT_THRESHOLD))).toBe('exam')
    expect(kindFromAnswer(answer('reading', 0.9))).toBe('reading')
  })

  it('is unsure below the threshold, so the file stays out', () => {
    expect(kindFromAnswer(answer('slides', SORT_THRESHOLD - 0.01))).toBeNull()
  })

  it('is unsure without an answer, or with one that names no kind', () => {
    expect(kindFromAnswer({ type: 'refusal' })).toBeNull()
    expect(kindFromAnswer(undefined)).toBeNull()
    expect(kindFromAnswer(answer('poem', 0.9))).toBeNull()
  })
})

describe('what a name may decide', () => {
  /** A decision model that reads the pages: rules about an exam are organisation, not an exam. */
  const model = () => {
    const asked: string[] = []
    const decisions: DecisionsPort = {
      model: 'pages',
      price: { input: 0 },
      decide: async ({ context, questions }) => {
        asked.push(context)
        expect(questions).toEqual([KIND_QUESTION])
        const choice = context.includes('Bring a pen') ? 'organisation' : 'exam'
        return [{ type: 'choice', choice, probability: 0.9 }]
      },
    }
    const pdf: PdfPort = { readSlides: async () => [], renderSlides: async () => [] }
    return { asked, ports: { decisions, pdf } }
  }
  const file = (path: string, lines: string[]) => ({
    path,
    bytes: new Uint8Array(),
    pages: [lines],
  })

  it('lets no file in by its name: the first pages decide', async () => {
    const { asked, ports } = model()
    expect(
      await sortFiles(ports, [
        file('Rules for the Summer 2022 exam.pdf', ['Bring a pen']),
        file('Exam Summer 2022.pdf', ['1) What is risk?']),
      ]),
    ).toEqual(['organisation', 'exam'])
    expect(asked).toHaveLength(2)
  })

  it('keeps a file out by its name alone, without asking the model', async () => {
    const { asked, ports } = model()
    expect(await sortFiles(ports, [file('Übungen/Blatt 1.pdf', ['Name three risks'])])).toEqual([
      'exercise',
    ])
    expect(asked).toEqual([])
  })
})

describe('folders no course material lives in', () => {
  it.each([
    'Practicals/2/.venv/lib/python3.12/site-packages/matplotlib/mpl-data/images/back.pdf',
    'Projekt/build/body.pdf',
    'Projekt/node_modules/some-package/docs/guide.pdf',
    '.Trash/Lecture 1.pdf',
  ])('%s is junk', (path) => {
    expect(isJunkPath(path)).toBe(true)
  })

  it('leaves a course folder and a file that only sounds like one alone', () => {
    expect(isJunkPath('Course/Week 1/build systems.pdf')).toBe(false)
    expect(isJunkPath('Lecture 1.pdf')).toBe(false)
  })
})
