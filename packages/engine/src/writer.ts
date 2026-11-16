/**
 * Step 5 and the model's part of step 6: the card writer. The model fills one small form per
 * planned card while it sees the whole lecture, up to three cards of one concept in a call,
 * fills a card again when the gate rejects it, and splits a card that is too long. This file is the seam: how cards are worded lives here
 * and in the preset, nowhere else.
 */

import { z } from 'zod'
import type { AskModel } from './ask.ts'
import { ROLE_SPECS, type Draft, type Role } from './cards/roles.ts'
import { LIMITS } from './cards/validate.ts'
import type { Concept, Fact } from './course.ts'
import { SYSTEM } from './mapper.ts'
import type { SlideImage } from './ports.ts'
import type { Preset } from './presets.ts'

/** What the model contributes to a card. Concept, role and slide are fixed by the plan. */
export type Slots = Omit<Draft, 'concept' | 'role' | 'slide'>

export interface CardJob {
  /** The whole lecture as text, shared by every card of it, so the provider caches it. */
  context: string
  /** The pictures of this card's own slide, if it has one. They come after the lecture. */
  images: SlideImage[]
  concept: Concept
  fact: Fact
  role: Role
}

/** Cards of one concept written in one call, at most. */
export const CARDS_PER_CALL = 3

export interface Writer {
  /**
   * Fill the forms of up to `CARDS_PER_CALL` cards of one concept of one lecture, in one call.
   * Each card sees the whole lecture once instead of once per card (#199).
   */
  fill(jobs: CardJob[]): Promise<Slots[]>
  /** Fill the form again, with everything the gate found wrong. */
  repair(job: CardJob, rejected: Slots, problems: string[]): Promise<Slots>
  /** Turn one card that is too long into two or three atomic ones. */
  split(job: CardJob, tooLong: Slots, problems: string[]): Promise<Slots[]>
}

type Values = Record<string, unknown>

interface Form {
  schema: z.ZodObject
  toSlots: (values: Values) => Slots
  fromSlots: (slots: Slots) => Values
}

const none = { answers: [], labels: [], code: '' }
const empty: Slots = { front: '', extra: '', ...none }
const question = z
  .string()
  .describe(`The question. At most ${LIMITS.frontWords} words. Never a yes/no question.`)
const extra = z
  .string()
  .describe(`Context that is not tested. At most ${LIMITS.extraWords} words, or empty.`)
const sentence = (what: string) =>
  z
    .string()
    .describe(
      `${what} At most ${LIMITS.answerWords} words. Mark the words that answer the question as ` +
        '==words==, never a term the question names.',
    )
const term = z
  .string()
  .describe(`The term alone, at most ${LIMITS.termWords} words, as it appears mid-sentence.`)
const short = (what: string) => z.string().describe(`${what} At most ${LIMITS.slotWords} words.`)
const half = (what: string) =>
  z.string().describe(`${what} About 10 words; both together at most ${LIMITS.answerWords}.`)

function form<S extends z.ZodObject>(
  schema: S,
  toSlots: (values: z.infer<S>) => Slots,
  fromSlots: (slots: Slots) => z.infer<S>,
): Form {
  return { schema, toSlots: toSlots as (values: Values) => Slots, fromSlots }
}

const termForm = form(
  z.object({ question, term, extra }),
  (v) => ({ ...none, front: v.question, answers: [v.term], extra: v.extra }),
  (s) => ({ question: s.front, term: s.answers[0] ?? '', extra: s.extra }),
)
const pairForm = (first: string, second: string) =>
  form(
    z.object({ question, first: half(first), second: half(second), extra }),
    (v) => ({ ...none, front: v.question, answers: [v.first, v.second], extra: v.extra }),
    (s) => ({
      question: s.front,
      first: s.answers[0] ?? '',
      second: s.answers[1] ?? '',
      extra: s.extra,
    }),
  )

/** One small form per card type, with the limits written into its fields. */
const FORMS: Record<Role, Form> = {
  definition: form(
    z.object({ question, answer: sentence('One sentence.'), extra }),
    (v) => ({ ...none, front: v.question, answers: [v.answer], extra: v.extra }),
    (s) => ({ question: s.front, answer: s.answers[0] ?? '', extra: s.extra }),
  ),
  reverse: termForm,
  case: termForm,
  contrast: form(
    z.object({
      question,
      sideA: short('The first side.'),
      valueA: half('What holds for the first side.'),
      sideB: short('The second side.'),
      valueB: half('What holds for the second side.'),
      extra,
    }),
    (v) => ({
      ...none,
      front: v.question,
      labels: [v.sideA, v.sideB],
      answers: [v.valueA, v.valueB],
      extra: v.extra,
    }),
    (s) => ({
      question: s.front,
      sideA: s.labels[0] ?? '',
      valueA: s.answers[0] ?? '',
      sideB: s.labels[1] ?? '',
      valueB: s.answers[1] ?? '',
      extra: s.extra,
    }),
  ),
  chain: form(
    z.object({
      question,
      givenSteps: z
        .array(z.string())
        .describe('The one to four steps the question names, in order.'),
      nextSteps: z
        .array(z.string())
        .describe('The one or two steps that follow. These are the answer.'),
      extra,
    }),
    (v) => ({
      ...none,
      front: v.question,
      labels: v.givenSteps,
      answers: v.nextSteps,
      extra: v.extra,
    }),
    (s) => ({ question: s.front, givenSteps: s.labels, nextSteps: s.answers, extra: s.extra }),
  ),
  'name-two': pairForm('The first item.', 'The second item.'),
  why: form(
    z.object({
      question,
      answer: sentence('The reason, the condition or the consequence, in one sentence.'),
      then: z
        .string()
        .describe(
          `A second step that follows from the first, only when the reasoning needs it; otherwise empty. Both together at most ${LIMITS.answerWords} words.`,
        ),
      extra,
    }),
    (v) => ({
      ...none,
      front: v.question,
      answers: v.then.trim() ? [v.answer, v.then] : [v.answer],
      extra: v.extra,
    }),
    (s) => ({
      question: s.front,
      answer: s.answers[0] ?? '',
      then: s.answers[1] ?? '',
      extra: s.extra,
    }),
  ),
  formula: form(
    z.object({
      question,
      tex: z.string().describe('The formula in TeX, without delimiters.'),
      condition: sentence('One sentence with the condition or the meaning.'),
      extra,
    }),
    (v) => ({ ...none, front: v.question, answers: [v.tex, v.condition], extra: v.extra }),
    (s) => ({
      question: s.front,
      tex: s.answers[0] ?? '',
      condition: s.answers[1] ?? '',
      extra: s.extra,
    }),
  ),
  code: form(
    z.object({
      question,
      listing: z
        .string()
        .describe(
          `The listing, copied from the slide line by line. At most ${LIMITS.codeLines} lines of ${LIMITS.codeChars} characters.`,
        ),
      parts: z
        .array(
          z.object({ label: short('What this part asks, such as "Returns".'), answer: z.string() }),
        )
        .describe(`One or two parts. All answers together at most ${LIMITS.answerWords} words.`),
      extra,
    }),
    (v) => ({
      ...none,
      front: v.question,
      code: v.listing,
      labels: v.parts.map((p) => p.label),
      answers: v.parts.map((p) => p.answer),
      extra: v.extra,
    }),
    (s) => ({
      question: s.front,
      listing: s.code,
      parts: s.answers.map((answer, i) => ({ label: s.labels[i] ?? '', answer })),
      extra: s.extra,
    }),
  ),
  diagram: form(
    z.object({
      question: z
        .string()
        .describe(`Asks to draw the framework from memory. At most ${LIMITS.frontWords} words.`),
      reading: sentence('One sentence that says what the drawing shows.'),
      extra,
    }),
    (v) => ({ ...none, front: v.question, answers: [v.reading], extra: v.extra }),
    (s) => ({ question: s.front, reading: s.answers[0] ?? '', extra: s.extra }),
  ),
  cloze: form(
    z.object({
      sentence: z
        .string()
        .describe(
          `One sentence of at most ${LIMITS.clozeWords} words with one to ${LIMITS.deletions} hidden items, ` +
            `written {{c1::item}}, {{c2::item}}. Each item at most ${LIMITS.deletionWords} words.`,
        ),
      extra,
    }),
    (v) => ({ ...none, front: v.sentence, extra: v.extra }),
    (s) => ({ sentence: s.front, extra: s.extra }),
  ),
  'cloze-list': form(
    z.object({
      leadIn: z
        .string()
        .describe('The lead-in that names the list, such as "The five Cs of lending:".'),
      items: z
        .array(z.string())
        .describe(
          `The two to ${LIMITS.deletions} items in their fixed order, each at most ${LIMITS.deletionWords} words.`,
        ),
      extra,
    }),
    (v) => ({ ...none, front: v.leadIn, answers: v.items, extra: v.extra }),
    (s) => ({ leadIn: s.front, items: s.answers, extra: s.extra }),
  ),
}

/**
 * Every card form, each with its card type. One reply format for every batch of cards, whatever
 * types it holds, so the provider's cache of the lecture holds for all of them.
 */
const ROLES = Object.keys(FORMS) as Role[]
const Batch = z.object({
  cards: z.array(
    z.union(
      ROLES.map((role) =>
        z.object({ cardType: z.enum([role]), ...FORMS[role].schema.shape }),
      ) as unknown as [z.ZodObject, z.ZodObject, ...z.ZodObject[]],
    ),
  ),
})

/** A filled form as the slots of a draft. Checks the form first, as a model's reply is checked. */
export function slotsFromForm(role: Role, values: unknown): Slots {
  const { schema, toSlots } = FORMS[role]
  return toSlots(schema.parse(values))
}

export function createWriter(ask: AskModel, preset: Preset): Writer {
  /** What one card is about: its fact, the exam question it answers, its type and an example. */
  const card = (job: CardJob) => {
    const example = preset.examples[job.role]
    return [
      `Fact to test: ${job.fact.text} (slide ${job.fact.slide})`,
      ...(job.fact.exam
        ? [
            `Past exams asked: ${job.fact.exam.question}`,
            'Ask what that question asks, within the limits of the card.',
          ]
        : []),
      `Card type: ${job.role}. ${ROLE_SPECS[job.role].use}`,
      ...(example
        ? ['An example of this card type, from another course:', JSON.stringify(example)]
        : []),
    ]
  }
  const rules = ['Rules:', ...preset.rules.map((rule) => `- ${rule}`)]
  const brief = (job: CardJob) =>
    [`Concept: ${job.concept.name}`, ...card(job), '', ...rules].join('\n')
  const request = (jobs: CardJob[], task: 'fill' | 'repair' | 'split', prompt: string) => ({
    task,
    system: SYSTEM,
    context: jobs[0]!.context,
    images: [],
    // Each picture once, though several cards of the call may stand on its slide.
    shown: [
      ...new Map(jobs.flatMap((job) => job.images).map((image) => [image.slide, image])).values(),
    ],
    prompt,
    effort: 'low' as const,
  })
  const rejected = (job: CardJob, slots: Slots, problems: string[]) => [
    JSON.stringify(FORMS[job.role].fromSlots(slots)),
    'Problems:',
    ...problems.map((p) => `- ${p}`),
  ]

  return {
    async fill(jobs) {
      const prompt = [
        jobs.length === 1
          ? 'Fill the form for one flashcard. Give it its card type.'
          : `Fill one form for each of these ${jobs.length} flashcards, in this order. Give each card its card type. Each card tests its own fact only.`,
        '',
        `Concept: ${jobs[0]!.concept.name}`,
        ...jobs.flatMap((job, i) => [
          '',
          ...(jobs.length > 1 ? [`Card ${i + 1}`] : []),
          ...card(job),
        ]),
        '',
        ...rules,
      ].join('\n')
      const reply = await ask(request(jobs, 'fill', prompt), Batch)
      return Promise.all(
        jobs.map(async (job, i) => {
          const values = reply.cards[i]
          if (values?.cardType === job.role) return FORMS[job.role].toSlots(values)
          // A card the reply left out or wrote in another form is asked again on its own; alone
          // and still wrong, it goes to the gate empty, and the gate has it filled again.
          return jobs.length > 1 ? (await this.fill([job]))[0]! : empty
        }),
      )
    },
    async repair(job, slots, problems) {
      const prompt = [
        'The checks rejected this card. Fill the form again so that every problem is fixed.',
        ...rejected(job, slots, problems),
        '',
        brief(job),
      ].join('\n')
      const { schema, toSlots } = FORMS[job.role]
      return toSlots(await ask(request([job], 'repair', prompt), schema))
    },
    async split(job, slots, problems) {
      const prompt = [
        'This card is too long for one card. Split it into two or three cards of the same type.',
        'Each card tests one part and stands on its own. Do not shorten by leaving a part out.',
        ...rejected(job, slots, problems),
        '',
        brief(job),
      ].join('\n')
      const { schema, toSlots } = FORMS[job.role]
      const reply = await ask(request([job], 'split', prompt), z.object({ cards: z.array(schema) }))
      return reply.cards.map(toSlots)
    },
  }
}
