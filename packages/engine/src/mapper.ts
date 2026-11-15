/**
 * Step 3: the model maps a lecture in two moves. First it reads the lecture slide by slide,
 * one call per slide with a narrow question: what does this slide state or show. Then one call
 * sorts the facts it found into topics and concepts. `tree.ts` builds and checks the map.
 *
 * Why two moves: one call for a whole lecture passes over much of it. Measured on 2026-11-15
 * against the reference deck, a map of the whole lecture plus a second reading held 40 percent
 * of the reference notes in their facts; read slide by slide, the same slides gave twice the
 * facts for a third of the cost.
 */

import { z } from 'zod'
import type { AskModel } from './ask.ts'
import type { SlideImage } from './ports.ts'
import { TITLE_CHARS, type Grouping, type ReadFact } from './tree.ts'

export const SYSTEM = [
  'You turn university lecture slides into study flashcards.',
  'You only fill forms. A program checks every field against hard limits and builds the cards.',
  'Use only what the slides say, in the language of the slides.',
  'Plain text only: no HTML, no Markdown, no line breaks inside a field, no em-dashes.',
].join('\n')

/** A lecture as the model reads it: `[14] line / line`, pictures announced by their slide. */
export function slidesBlock(heading: string, slides: string[][], images: SlideImage[]): string {
  const pictured = new Set(images.map((image) => image.slide))
  const lines = slides.map((text, i) => {
    const note = pictured.has(i + 1) ? ' (see the picture of this slide)' : ''
    return `[${i + 1}] ${text.join(' / ')}${note}`
  })
  return [heading, 'Slides:', ...lines].join('\n')
}

const SlideSchema = z.object({
  facts: z.array(z.object({ concept: z.string(), text: z.string(), items: z.number() })),
})

export function slidePrompt(slide: number, lines: string[], rules: readonly string[]): string {
  return [
    `Read slide ${slide} of this lecture. Its picture is above.`,
    lines.length > 0 ? `Its text: ${lines.join(' / ')}` : 'It has no text.',
    '',
    `List every fact slide ${slide} states or shows that an exam could ask about.`,
    '- concept: what the fact is about: a term, a model, a principle, a case, a formula. Name it',
    '  as the slides do, in at most 6 words.',
    '- text: one sentence that stands on its own. It names its concept and, where the slides',
    '  give one, the author or the model it belongs to.',
    '- A definition, a reason, a condition, a consequence, a contrast, an example with what it',
    '  shows: each is a fact of its own.',
    '- Several things under one heading (a list, the boxes or phases of a figure, the rows of a',
    '  table, the costs or kinds of something): first one fact that names all of them together,',
    '  in their order, as in "Large exit transactions: IPO, trade sale and leveraged buyout."',
    '  Then one fact for each part only when the slide says more about it than its name.',
    '- items: how many items the fact lists when it is a list to recite, otherwise 0.',
    `Only what slide ${slide} itself states or shows. The other slides are there to understand it.`,
    'A slide that teaches nothing gets an empty list: a title, an agenda, a recap, a question to',
    'the class without its answer.',
    ...rules.map((rule) => `- ${rule}`),
  ].join('\n')
}

/** One slide, read on its own. Its picture comes after the lecture, so the lecture stays cached. */
export async function askSlide(
  ask: AskModel,
  context: string,
  slide: { number: number; lines: string[]; image: SlideImage },
  rules: readonly string[],
): Promise<ReadFact[]> {
  const prompt = slidePrompt(slide.number, slide.lines, rules)
  const request = { system: SYSTEM, context, images: [], shown: [slide.image], prompt }
  const reply = await ask({ task: 'read', ...request, effort: 'low' }, SlideSchema)
  return reply.facts.map((fact) => ({ ...fact, slide: slide.number }))
}

const GroupSchema = z.object({
  title: z.string(),
  topics: z.array(
    z.object({
      name: z.string(),
      concepts: z.array(z.object({ name: z.string(), facts: z.array(z.string()) })),
    }),
  ),
  repeats: z.array(z.string()),
})

/** The facts of a lecture as the grouping call reads them, each with a short id. */
export const factId = (i: number) => `F${i + 1}`

export function groupPrompt(
  facts: ReadFact[],
  rules: readonly string[],
  vocabulary: string[],
): string {
  return [
    'These facts were read from the slides of this lecture, one slide at a time:',
    ...facts.map((fact, i) => `${factId(i)} (slide ${fact.slide}) ${fact.concept}: ${fact.text}`),
    '',
    'Sort them into a map of the lecture:',
    `- title: what this lecture is about, at most ${TITLE_CHARS} characters, without its number. Not the name of the course, which every lecture shares.`,
    '- topics: the parts of the lecture in order, each with its concepts.',
    '- A concept is one thing a student must know: a term, a model, a principle, a case, a formula.',
    '  Name it as the slides do, in at most 6 words. Facts the reading named differently for the',
    '  same thing go under one concept. The parts of one model (the phases of a growth model,',
    '  the blocks of a canvas) go under that model.',
    "- facts: the ids of the concept's facts.",
    '- repeats: the ids of facts that repeat another fact, in the same or in other words, such as',
    '  a recap of an earlier slide. Keep the fullest one in its concept.',
    '- Every id appears exactly once: in one concept, or in repeats.',
    ...rules.map((rule) => `- ${rule}`),
    vocabulary.length > 0
      ? `\nThe course already uses these concept names. When this lecture teaches one of them again, use exactly that name: ${vocabulary.join('; ')}.`
      : '',
  ].join('\n')
}

export function askGroups(
  ask: AskModel,
  lecture: { context: string; images: SlideImage[] },
  facts: ReadFact[],
  rules: readonly string[],
  vocabulary: string[],
): Promise<Grouping> {
  const prompt = groupPrompt(facts, rules, vocabulary)
  return ask({ task: 'map', system: SYSTEM, ...lecture, prompt, effort: 'medium' }, GroupSchema)
}
