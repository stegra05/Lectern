/**
 * Past exams as a guide to what gets a card. The model reads each paper into its questions,
 * then says for every question which facts of a lecture a student needs to answer it. The
 * number of questions that hit a fact is its weight in the plan.
 *
 * Why: with the slides read well, the plan has twice the facts it may turn into cards, and a
 * score that has never seen an exam chose badly between them. Measured on 2026-11-15 on the
 * Entrepreneurship course: the facts held 279 of the 636 reference notes, the cards made from
 * them 204, and notes the exam asked nine times or more fell from 42 to 33 percent.
 */

import { z } from 'zod'
import type { AskModel } from './ask.ts'
import { SYSTEM } from './mapper.ts'
import type { ReadFact } from './tree.ts'

const QuestionsSchema = z.object({
  questions: z.array(z.object({ number: z.string(), text: z.string() })),
})

export interface ExamQuestion {
  /** Which paper, and the question's number on it, such as "Summer 2024 / 2b". */
  id: string
  /** The question as a student reads it, with the options of a multiple choice question. */
  text: string
}

export function questionsPrompt(): string {
  return [
    'This is a past exam paper of the course. List every question a student must answer.',
    '- number: the number of the question as the paper gives it, such as "3" or "2b".',
    '- text: the question in full, in one line. A multiple choice question with its options. A',
    '  question about a case or a text keeps what the student needs of it, in a few words.',
    'Leave out instructions, the cover page, point tables and blank answer space.',
  ].join('\n')
}

export async function askQuestions(
  ask: AskModel,
  paper: string,
  text: string,
): Promise<ExamQuestion[]> {
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
  return reply.questions.map((q) => ({ id: `${paper} / ${q.number.trim()}`, text: q.text }))
}

const MatchSchema = z.object({
  matches: z.array(z.object({ question: z.string(), facts: z.array(z.string()) })),
})

/** Short ids for the questions in one prompt. */
export const questionId = (i: number) => `Q${i + 1}`

export function matchPrompt(
  facts: { id: string; fact: ReadFact }[],
  questions: ExamQuestion[],
): string {
  return [
    'Facts of this lecture:',
    ...facts.map(({ id, fact }) => `${id} ${fact.concept}: ${fact.text}`),
    '',
    'Questions from past exams of the course:',
    ...questions.map((q, i) => `${questionId(i)} ${q.text}`),
    '',
    'For each question this lecture helps to answer, give the ids of the facts a student needs',
    'for the answer, at most three. Leave out a question the facts do not help to answer.',
    '- question: its id only, such as "Q12". facts: ids only, such as "L03-17".',
  ].join('\n')
}

/** For each question the lecture helps to answer, the ids of the facts it needs. */
export async function askMatches(
  ask: AskModel,
  context: string,
  facts: { id: string; fact: ReadFact }[],
  questions: ExamQuestion[],
): Promise<Map<string, string[]>> {
  const reply = await ask(
    {
      task: 'map',
      system: SYSTEM,
      context,
      images: [],
      prompt: matchPrompt(facts, questions),
      effort: 'medium',
    },
    MatchSchema,
  )
  const known = new Set(facts.map((f) => f.id))
  const out = new Map<string, string[]>()
  for (const { question, facts: ids } of reply.matches) {
    const i = Number(/^Q(\d+)\b/.exec(question.trim())?.[1]) - 1
    const hit = ids.map((id) => id.trim()).filter((id) => known.has(id))
    if (questions[i] && hit.length > 0) out.set(questions[i].id, hit.slice(0, 3))
  }
  return out
}
