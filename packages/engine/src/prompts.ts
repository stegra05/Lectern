/**
 * The prompts and the reply schemas of the three model tasks. The model maps a lecture, fills
 * card slots, and refills the slots of rejected cards. It never sees or writes a card field.
 */

import { z } from 'zod'
import {
  CARDS_PER_CONCEPT,
  GOAL_LABEL,
  ROLES,
  ROLE_SPECS,
  type Draft,
  type Goal,
} from './cards/roles.ts'
import { LIMITS } from './cards/validate.ts'
import { two } from './cards/words.ts'
import type { Concept, Topic } from './course.ts'
import { TITLE_CHARS } from './tree.ts'

export const SYSTEM = [
  'You turn university lecture slides into study flashcards.',
  'You only fill slots. A program checks every slot against hard limits and builds the cards.',
  'Use only what the slides say, in the language of the slides.',
  'Plain text only: no HTML, no Markdown, no line breaks inside a slot, no em-dashes.',
].join('\n')

// Slide numbers are plain numbers: the schema dialect of the providers has no integer bounds.
export const MapSchema = z.object({
  title: z.string(),
  topics: z.array(
    z.object({
      name: z.string(),
      concepts: z.array(z.object({ name: z.string(), slides: z.array(z.number()) })),
    }),
  ),
  leftOut: z.array(z.object({ slides: z.array(z.number()), reason: z.string() })),
})

const slots = {
  slide: z.number(),
  front: z.string(),
  answers: z.array(z.string()),
  labels: z.array(z.string()),
  extra: z.string(),
}

export const WriteSchema = z.object({
  cards: z.array(z.object({ concept: z.string(), role: z.enum(ROLES), ...slots })),
})

/** A rewrite keeps the card's id, concept and role, so the schema has no slot for them. */
export const RewriteSchema = z.object({
  cards: z.array(z.object({ id: z.string(), ...slots })),
})

/** The JSON Schema a model port receives: closed objects, every property required. */
export function replySchema(schema: z.ZodType): Record<string, unknown> {
  const out: Record<string, unknown> = z.toJSONSchema(schema)
  delete out.$schema
  return out
}

/** The slides as the model reads them: `[14] line / line`. */
function slideBlock(numbers: number[], slides: string[][]): string {
  return numbers.map((n) => `[${n}] ${(slides[n - 1] ?? []).join(' / ')}`).join('\n')
}

function roleLines(roles: readonly string[]): string {
  return roles.map((r) => `- ${r}: ${ROLE_SPECS[r as keyof typeof ROLE_SPECS].use}`).join('\n')
}

const CARD_RULES = [
  `- One fact per card. front: at most ${LIMITS.frontWords} words, never a yes/no question; ask what, which, why or how.`,
  `- The whole answer: at most ${LIMITS.answerWords} words. Aim for about 12.`,
  '- Exactly one defensible answer. Add a context prefix such as "Knight:" only when it rules out a rival answer.',
  '- Mark the key term of an answer as ==term==.',
  '- slide: the one slide of the concept where the answer is found.',
  `- extra: context of at most ${LIMITS.extraWords} words that is not tested, or an empty string.`,
  '- Slots a role does not use stay empty lists.',
].join('\n')

export function mapPrompt(input: {
  file: string
  slides: string[][]
  earlier: string[]
  problems?: string[]
}): string {
  const numbers = input.slides.map((_, i) => i + 1)
  return [
    `Lecture file: ${input.file}`,
    'Slides, text only (pictures are not visible to you):',
    slideBlock(numbers, input.slides),
    '',
    input.earlier.length > 0
      ? `Earlier lectures already cover these concepts. Do not list them again: ${input.earlier.join('; ')}.\n`
      : '',
    'Map this lecture:',
    `- title: the name of the lecture, at most ${TITLE_CHARS} characters, without its number.`,
    '- topics: the parts of the lecture in order, each with its concepts.',
    '- A concept is one thing a student must know: a term, a model, a principle, a case, a formula.',
    '  Name it as the slides do, in at most 6 words. slides: the slide numbers that teach it.',
    '- leftOut: every slide no concept uses, grouped, each group with a reason of at most 12 words',
    '  (title slide, agenda, organisational, repetition, guest lecture).',
    'Every slide belongs either to a concept or to leftOut.',
    input.problems?.length
      ? `\nYour last map had these problems. Return the whole map again with them fixed:\n${input.problems.map((p) => `- ${p}`).join('\n')}`
      : '',
  ].join('\n')
}

export function writePrompt(input: {
  lecture: { number: number; title: string }
  topic: Topic
  concepts: Concept[]
  slides: string[][]
  goal: Goal
}): string {
  const numbers = [...new Set(input.concepts.flatMap((c) => c.slides))].sort((a, b) => a - b)
  const depth = CARDS_PER_CONCEPT[input.goal]
  return [
    `Lecture ${two(input.lecture.number)} ${input.lecture.title}, topic: ${input.topic.name}`,
    '',
    'Write cards for these concepts and no others:',
    ...input.concepts.map((c) => `- ${c.name} (slides ${c.slides.join(', ')})`),
    '',
    'Slides:',
    slideBlock(numbers, input.slides),
    '',
    `The student's goal is "${GOAL_LABEL[input.goal]}": at least one and at most ${depth} cards per concept.`,
    'Several cards on one concept test different facts from different angles.',
    '',
    'Pick the role that fits the kind of knowledge and fill its slots:',
    roleLines(ROLES),
    '',
    'Rules:',
    CARD_RULES,
  ].join('\n')
}

export interface Rejected {
  id: string
  concept: Concept
  draft: Draft
  problems: string[]
}

export function rewritePrompt(input: {
  lecture: { number: number; title: string }
  rejected: Rejected[]
  slides: string[][]
}): string {
  const numbers = [...new Set(input.rejected.flatMap((r) => r.concept.slides))].sort(
    (a, b) => a - b,
  )
  const roles = ROLES.filter((role) => input.rejected.some((r) => r.draft.role === role))
  return [
    `Lecture ${two(input.lecture.number)} ${input.lecture.title}`,
    '',
    'The checks rejected these cards. Fill the slots of each card again so that every problem is',
    'fixed. Keep the id. The concept and the role of a card stay as they are.',
    '',
    ...input.rejected.flatMap((r) => [
      `Card ${r.id}`,
      `  concept: ${r.concept.name} (slides ${r.concept.slides.join(', ')})`,
      `  role: ${r.draft.role}`,
      `  slide: ${r.draft.slide}`,
      `  front: ${r.draft.front}`,
      `  answers: ${JSON.stringify(r.draft.answers)}`,
      `  labels: ${JSON.stringify(r.draft.labels)}`,
      `  extra: ${r.draft.extra}`,
      '  problems:',
      ...r.problems.map((p) => `  - ${p}`),
      '',
    ]),
    'Slides:',
    slideBlock(numbers, input.slides),
    '',
    'Roles:',
    roleLines(roles),
    '',
    'Rules:',
    CARD_RULES,
  ].join('\n')
}
