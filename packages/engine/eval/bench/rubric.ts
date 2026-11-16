/**
 * A rubric put together from one file per held-out paper, as the extractors of `RUBRIC.md`
 * write them. Checked on the way: the marks of the questions add up to the paper's total, with
 * only the counted questions of a choice, and the points of a question earn at least the
 * question's marks.
 */

import { z } from 'zod'
import type { Point, Rubric } from './score.ts'

export const PaperSchema = z.object({
  /** The paper as its file is named, without the extension. */
  paper: z.string().min(1),
  /** The marks of the whole paper, as its cover says. */
  total: z.number().positive(),
  /**
   * Where the paper lets the student answer only some of a set of questions: the numbers of
   * the set and how many of them count.
   */
  choices: z.array(
    z.object({ questions: z.array(z.string()).min(2), pick: z.number().int().positive() }),
  ),
  questions: z.array(
    z.object({
      number: z.string().min(1),
      asks: z.string().min(1),
      marks: z.number().positive(),
      points: z
        .array(
          z.object({
            knows: z.string().min(1),
            marks: z.number().positive(),
            kind: z.enum(['recall', 'apply']),
            basis: z.enum(['solution', 'slides', 'notes', 'own']),
          }),
        )
        .min(1),
    }),
  ),
})
export type Paper = z.infer<typeof PaperSchema>

/** Marks are fractions at times (five points of 0.3), so sums are compared with a tolerance. */
const differ = (a: number, b: number) => Math.abs(a - b) > 1e-9

export function assemble(course: string, papers: Paper[]): Rubric {
  const points: Point[] = []
  for (const { paper, total, choices, questions } of papers) {
    const marksOf = new Map(questions.map((question) => [question.number, question.marks]))
    const choiceOf = new Map<string, { name: string; pick: number }>()
    let marks = 0
    choices.forEach((choice, i) => {
      const each = choice.questions.map((number) => {
        if (!marksOf.has(number)) throw new Error(`${paper}: a choice names question ${number}.`)
        choiceOf.set(number, { name: `choice ${i + 1}`, pick: choice.pick })
        return marksOf.get(number)!
      })
      if (new Set(each).size > 1) {
        throw new Error(`${paper}: the questions of choice ${i + 1} carry different marks.`)
      }
      marks += choice.pick * each[0]!
    })
    for (const question of questions) if (!choiceOf.has(question.number)) marks += question.marks
    if (differ(marks, total)) {
      throw new Error(`${paper}: its questions carry ${marks} marks, the paper ${total}.`)
    }
    for (const question of questions) {
      const earned = question.points.reduce((sum, point) => sum + point.marks, 0)
      if (earned < question.marks && differ(earned, question.marks)) {
        throw new Error(
          `${paper}, question ${question.number}: its points earn ${earned} of ${question.marks} marks.`,
        )
      }
      const choice = choiceOf.get(question.number)
      question.points.forEach((point, i) =>
        points.push({
          id: `${paper}/${question.number}/${i + 1}`,
          paper,
          question: question.number,
          asks: question.asks,
          questionMarks: question.marks,
          choice: choice?.name ?? null,
          pick: choice?.pick ?? null,
          ...point,
        }),
      )
    }
  }
  return { course, papers: papers.map((p) => p.paper), points }
}
