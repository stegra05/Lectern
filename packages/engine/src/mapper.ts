/**
 * Step 3: the model reads a lecture into topics, concepts and testable facts. `tree.ts`
 * checks what comes back.
 */

import { z } from 'zod'
import type { AskModel } from './ask.ts'
import type { SlideImage } from './ports.ts'
import { TITLE_CHARS, type MapOutput, type MoreOutput } from './tree.ts'

export const SYSTEM = [
  'You turn university lecture slides into study flashcards.',
  'You only fill forms. A program checks every field against hard limits and builds the cards.',
  'Use only what the slides say, in the language of the slides.',
  'Plain text only: no HTML, no Markdown, no line breaks inside a field, no em-dashes.',
].join('\n')

// Slide numbers are plain numbers: the schema dialect of the providers has no integer bounds.
const MapSchema = z.object({
  title: z.string(),
  topics: z.array(
    z.object({
      name: z.string(),
      concepts: z.array(
        z.object({
          name: z.string(),
          facts: z.array(z.object({ text: z.string(), slide: z.number(), items: z.number() })),
        }),
      ),
    }),
  ),
})

/** A lecture as the model reads it: `[14] line / line`, pictures announced by their slide. */
export function slidesBlock(heading: string, slides: string[][], images: SlideImage[]): string {
  const pictured = new Set(images.map((image) => image.slide))
  const lines = slides.map((text, i) => {
    const note = pictured.has(i + 1) ? ' (see the picture of this slide)' : ''
    return `[${i + 1}] ${text.join(' / ')}${note}`
  })
  return [heading, 'Slides:', ...lines].join('\n')
}

export function mapPrompt(
  rules: readonly string[],
  vocabulary: string[],
  problems: string[],
): string {
  return [
    'Map this lecture:',
    `- title: the name of the lecture, at most ${TITLE_CHARS} characters, without its number.`,
    '- topics: the parts of the lecture in order, each with its concepts.',
    '- A concept is one thing a student must know: a term, a model, a principle, a case, a formula.',
    '  Name it as the slides do, in at most 6 words. Do not split one idea into several concepts.',
    '- facts: everything the slides state or show about the concept that can be asked.',
    '  One fact is one sentence: a definition, a contrast, a list, a sequence, a formula, a listing,',
    '  a case, a drawing, a reason. slide: the one slide that states it.',
    '  items: how many items the fact lists when it is a list to recite, otherwise 0.',
    'Every slide that teaches something carries at least one fact.',
    ...rules.map((rule) => `- ${rule}`),
    vocabulary.length > 0
      ? `\nThe course already uses these concept names. When this lecture teaches one of them again, use exactly that name: ${vocabulary.join('; ')}.`
      : '',
    problems.length > 0
      ? `\nYour last map had these problems. Return the whole map again with them fixed:\n${problems.map((p) => `- ${p}`).join('\n')}`
      : '',
  ].join('\n')
}

export function askMap(
  ask: AskModel,
  lecture: { context: string; images: SlideImage[] },
  rules: readonly string[],
  vocabulary: string[],
  problems: string[] = [],
): Promise<MapOutput> {
  const prompt = mapPrompt(rules, vocabulary, problems)
  return ask({ task: 'map', system: SYSTEM, ...lecture, prompt, effort: 'medium' }, MapSchema)
}

const MoreSchema = z.object({
  facts: z.array(
    z.object({
      topic: z.string(),
      concept: z.string(),
      text: z.string(),
      slide: z.number(),
      items: z.number(),
    }),
  ),
})

/** The map as the model reads it back: topics, concepts, and each fact with its slide. */
export function mapAsText(map: MapOutput): string {
  return map.topics
    .flatMap((topic) => [
      topic.name,
      ...topic.concepts.flatMap((concept) => [
        `  ${concept.name}`,
        ...concept.facts.map((fact) => `    - ${fact.text} (slide ${fact.slide})`),
      ]),
    ])
    .join('\n')
}

/**
 * The second reading. One call that maps a whole lecture passes over much of it: measured on
 * 2026-11-15 against the reference deck, 137 of 636 notes test a fact the slide text states
 * and the map did not have, and 81 of 232 concepts had a single fact.
 */
export function morePrompt(rules: readonly string[], map: MapOutput, pictured: number[]): string {
  return [
    'Your map of this lecture so far:',
    mapAsText(map),
    '',
    'Go through the slides once more, one by one, and list the facts the map does not have yet.',
    '- A list or a table in the text: each item or row that teaches something is a fact of its own.',
    '- A definition, a reason, a condition, a consequence or an example the map passes over.',
    ...(pictured.length > 0
      ? [
          `- Slides ${pictured.join(', ')} are shown as pictures. Read each figure or table: every labelled part (a phase, a box, a quadrant, a row, an axis) with what the picture says about it is a fact.`,
        ]
      : []),
    '- concept: the concept of the map the fact belongs to, named exactly as there. For something',
    '  the map has no concept for, a new name of at most 6 words. A figure with several parts',
    '  may need one concept per part.',
    '- topic: the topic of the map the concept belongs to.',
    '- text: one sentence. slide: the one slide that states or shows it.',
    '  items: how many items the fact lists when it is a list to recite, otherwise 0.',
    'Do not repeat or reword a fact the map has. Only what the slides state or show.',
    'When nothing is missing, return an empty list.',
    ...rules.map((rule) => `- ${rule}`),
  ].join('\n')
}

export function askMore(
  ask: AskModel,
  lecture: { context: string; images: SlideImage[] },
  rules: readonly string[],
  map: MapOutput,
): Promise<MoreOutput> {
  const pictured = lecture.images.map((image) => image.slide)
  const prompt = morePrompt(rules, map, pictured)
  return ask({ task: 'deepen', system: SYSTEM, ...lecture, prompt, effort: 'medium' }, MoreSchema)
}
