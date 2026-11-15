/**
 * Past exams as questions the cards answer. The model reads each paper into its questions,
 * sorts the questions of all papers into families of the same question, places each family in
 * a lecture of the build, and writes the answer as a fact of that lecture. The answer comes
 * from the lecture's slides where they hold it, otherwise from what the model knows, and the
 * fact says which.
 *
 * Why: measured on 2026-11-15 on Entrepreneurship, 47 of the 52 questions of the four newest
 * papers repeat an older question almost word for word, and even every fact read from the
 * slides answered only 20 of them: the slides imply reasons and relations an exam asks for, or
 * leave out the cases. As weights on facts read from the slides, past exams changed nothing.
 */

import { z } from 'zod'
import type { AskModel } from './ask.ts'
import { SYSTEM } from './mapper.ts'

/** One question of one past paper. */
export interface ExamQuestion {
  /** The paper, as its file is named, without the extension. */
  paper: string
  /** The number of the question as the paper gives it, such as "3" or "2b". */
  number: string
  /** The question as a student reads it, with the options of a multiple choice question. */
  text: string
}

/** The course's past papers, read once each: `exams.json` in the course folder. */
export interface ExamsFile {
  papers: { file: string; questions: ExamQuestion[] }[]
}

const QuestionsSchema = z.object({
  questions: z.array(z.object({ number: z.string(), text: z.string() })),
})

export function questionsPrompt(): string {
  return [
    'This is a past exam paper of the course. List every question a student must answer.',
    '- number: the number of the question as the paper gives it, such as "3" or "2b".',
    '- text: the question in full, in one line. A multiple choice question with its options. A',
    '  question about a case or a text keeps what the student needs of it, in a few words.',
    'Leave out instructions, the cover page, point tables and blank answer space.',
  ].join('\n')
}

/** One paper, from the text of its pages. */
export async function askQuestions(
  ask: AskModel,
  paper: string,
  pages: string[][],
): Promise<ExamQuestion[]> {
  const text = pages.map((lines, i) => `[page ${i + 1}] ${lines.join(' / ')}`).join('\n')
  const reply = await ask(
    {
      task: 'read',
      system: SYSTEM,
      context: `Exam paper: ${paper}\n${text}`,
      images: [],
      prompt: questionsPrompt(),
      effort: 'low',
    },
    QuestionsSchema,
  )
  return reply.questions.map((q) => ({ paper, number: q.number.trim(), text: q.text.trim() }))
}

const FamiliesSchema = z.object({
  families: z.array(
    z.object({
      question: z.string(),
      members: z.array(z.string()),
      lecture: z.number(),
      concept: z.string(),
    }),
  ),
})

/** Questions that ask the same thing, placed in a lecture and a concept. */
export interface Family {
  /** The question in the words the papers use most. */
  question: string
  /** How many papers asked it. */
  papers: number
  lecture: number
  concept: string
}

/** Short ids for the questions in one prompt. */
export const questionId = (i: number) => `Q${i + 1}`

export function familiesPrompt(
  questions: ExamQuestion[],
  lectures: { number: number; title: string; concepts: string[] }[],
): string {
  return [
    'Questions from past exam papers of the course, one per line:',
    ...questions.map((q, i) => `${questionId(i)} (${q.paper}) ${q.text}`),
    '',
    'The lectures, each with its concepts:',
    ...lectures.map((l) => `Lecture ${l.number} ${l.title}: ${l.concepts.join('; ')}`),
    '',
    'Sort the questions into families: questions that ask for the same answer, in the same or in',
    'other words, form one family. A question that is asked once is a family of its own.',
    "- question: the family's question in the words its papers use most. A multiple choice",
    '  question with its options.',
    '- members: the ids of its questions, such as "Q12".',
    '- lecture: the number of the lecture that teaches the answer, or 0 when none of them does.',
    '- concept: the concept of that lecture the question is about, named exactly as above, or a',
    '  new name of at most 6 words when the lecture has no such concept.',
    'Every id appears in exactly one family. Leave out nothing. A family with lecture 0 is dropped.',
  ].join('\n')
}

/** The families of all questions, each placed in one of the given lectures. */
export async function askFamilies(
  ask: AskModel,
  questions: ExamQuestion[],
  lectures: { number: number; title: string; concepts: string[] }[],
): Promise<Family[]> {
  const reply = await ask(
    {
      task: 'map',
      system: SYSTEM,
      context: 'Past exam papers of a university course.',
      images: [],
      prompt: familiesPrompt(questions, lectures),
      effort: 'medium',
    },
    FamiliesSchema,
  )
  const known = new Set(lectures.map((l) => l.number))
  return reply.families.flatMap((family) => {
    const members = family.members
      .map((id) => questions[Number(/^Q(\d+)\b/.exec(id.trim())?.[1]) - 1])
      .filter((q) => q !== undefined)
    if (members.length === 0 || !known.has(family.lecture)) return []
    const papers = new Set(members.map((q) => q.paper)).size
    return [
      {
        question: family.question.trim(),
        papers,
        lecture: family.lecture,
        concept: family.concept.trim(),
      },
    ]
  })
}

const AnswerSchema = z.object({
  answer: z.string(),
  items: z.number(),
  slide: z.number(),
  fromSlides: z.boolean(),
})

export type Answer = z.infer<typeof AnswerSchema>

export function answerPrompt(family: Family): string {
  return [
    `A question past exams of this course asked, in ${family.papers === 1 ? 'one paper' : `${family.papers} papers`}:`,
    family.question,
    `It is about: ${family.concept}`,
    '',
    'Write the answer a student should learn, as one fact.',
    '- answer: one or two sentences that answer the question on their own and name what it is',
    '  about. For a multiple choice question, the right option and why, in a few words. For a',
    '  question that asks for several things, name them all.',
    '- items: how many things the answer lists, when it is a list to recite, otherwise 0.',
    '- fromSlides: true when the slides above hold the answer. Then slide is the slide that',
    '  holds it most.',
    '- When the slides do not hold the answer, answer from what you know of the subject, set',
    '  fromSlides to false and slide to 0.',
  ].join('\n')
}

/** The answer to one family, with the lecture of its family as context. */
export function askAnswer(
  ask: AskModel,
  lecture: { context: string; images: { slide: number; png: string }[] },
  family: Family,
): Promise<Answer> {
  return ask(
    {
      task: 'fill',
      system: SYSTEM,
      ...lecture,
      prompt: answerPrompt(family),
      effort: 'low',
    },
    AnswerSchema,
  )
}
