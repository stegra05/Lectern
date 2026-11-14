/**
 * Step 3: the model reads a lecture into topics, concepts and testable facts. `tree.ts`
 * checks what comes back.
 */

import { z } from 'zod'
import type { AskModel } from './ask.ts'
import type { SlideImage } from './ports.ts'
import { TITLE_CHARS, FACTS_PER_CONCEPT, type MapOutput } from './tree.ts'

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
          core: z.boolean(),
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
    '- core: true for the concepts a student needs to pass the exam, false for the rest.',
    `- facts: what can be asked about the concept, most important first, at most ${FACTS_PER_CONCEPT}.`,
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
