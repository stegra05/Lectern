/**
 * From the model's map of a lecture to the tree that is stored. Pure. The result is always
 * usable: code closes every gap itself. `problems` says what the model got wrong, so the
 * caller can ask once more before settling for the repaired tree.
 */

import { slideRange, slug, words } from './cards/words.ts'
import type { Concept, LeftOut, Topic } from './course.ts'
import type { SlideKind } from './decide.ts'

export const TITLE_CHARS = 32
const CONCEPT_WORDS = 6
/** More facts than this per concept means the map is split too finely; the rest is cut. */
export const FACTS_PER_CONCEPT = 6

export interface MapOutput {
  title: string
  topics: {
    name: string
    concepts: {
      name: string
      core: boolean
      facts: { text: string; slide: number; items: number }[]
    }[]
  }[]
}

export interface MapContext {
  /** The kind of every slide, in slide order. Its length is the number of slides. */
  kinds: SlideKind[]
  /** True once the slide labels are calibrated: then only content slides may carry facts. */
  contentOnly: boolean
  /** The concepts earlier lectures introduced, by id: the course's vocabulary. */
  earlier: Map<string, { name: string; lecture: number }>
  /** Used when the model gives no title. */
  fallbackTitle: string
}

export interface Settled {
  title: string
  topics: Topic[]
  leftOut: LeftOut[]
  problems: string[]
}

/** Why a slide that is not content has no cards, as the student reads it. */
const REASON: Record<SlideKind, string> = {
  title: 'Title slide',
  agenda: 'Agenda slide',
  recap: 'Recap slide',
  'reading list': 'Reading list',
  content: 'No testable fact found on this slide',
}

export function settleMap(out: MapOutput, ctx: MapContext): Settled {
  const problems: string[] = []
  const count = ctx.kinds.length
  const exists = (n: number) => Number.isInteger(n) && n >= 1 && n <= count
  const usable = (n: number) => exists(n) && (!ctx.contentOnly || ctx.kinds[n - 1] === 'content')

  let title = out.title.trim()
  if (title === '') {
    problems.push('title is empty')
    title = ctx.fallbackTitle
  }
  if (title.length > TITLE_CHARS) {
    problems.push(`title has ${title.length} characters; the limit is ${TITLE_CHARS}`)
    title = shorten(title)
  }

  const ids = new Set<string>()
  const topics: Topic[] = []
  for (const [t, topic] of out.topics.entries()) {
    const concepts: Concept[] = []
    for (const concept of topic.concepts) {
      const name = concept.name.trim()
      if (name === '') {
        problems.push('a concept has no name')
        continue
      }
      if (words(name) > CONCEPT_WORDS)
        problems.push(`concept "${name}" has more than ${CONCEPT_WORDS} words`)
      const stated = concept.facts.filter((fact) => fact.text.trim() !== '')
      const bad = stated.filter((fact) => !usable(fact.slide)).map((fact) => fact.slide)
      if (bad.length > 0) {
        const why = bad.every(exists)
          ? 'which are not content slides'
          : 'which the lecture does not have'
        problems.push(`concept "${name}" takes facts from ${slideRange(bad)}, ${why}`)
      }
      const facts = stated
        .filter((fact) => usable(fact.slide))
        .slice(0, FACTS_PER_CONCEPT)
        .map((fact) => ({
          text: fact.text.trim(),
          slide: fact.slide,
          kind: 'definition' as const,
          ...(Number.isInteger(fact.items) && fact.items > 0 ? { items: fact.items } : {}),
        }))
      if (facts.length === 0) {
        problems.push(`concept "${name}" has no fact`)
        continue
      }
      const id = slug(name) || `concept-${ids.size + 1}`
      if (ids.has(id)) {
        problems.push(`concept "${name}" appears twice`)
        continue
      }
      ids.add(id)
      const slides = [...new Set(facts.map((fact) => fact.slide))].sort((a, b) => a - b)
      // One vocabulary: a concept that comes up again keeps the name the course already uses.
      const known = ctx.earlier.get(id)
      concepts.push({
        id,
        name: known?.name ?? name,
        slides,
        core: concept.core,
        ...(known ? { since: known.lecture } : {}),
        facts,
      })
    }
    if (topic.concepts.length === 0) problems.push(`topic "${topic.name}" has no concepts`)
    if (concepts.length > 0) topics.push({ name: topic.name.trim() || `Topic ${t + 1}`, concepts })
  }
  const all = topics.flatMap((topic) => topic.concepts)
  if (all.length === 0) problems.push('the map has no concepts')
  else if (!all.some((concept) => concept.core)) {
    problems.push('no concept is marked as core; mark the ones a student needs to pass')
    for (const concept of all) concept.core = true
  }

  const leftOut = unusedSlides(topics, ctx.kinds)
  const unused = leftOut
    .filter(({ slide }) => ctx.kinds[slide - 1] === 'content')
    .map(({ slide }) => slide)
  if (unused.length > 0) problems.push(`${slideRange(unused)}: content slides without any fact`)
  return { title, topics, leftOut, problems }
}

/** Every slide no concept uses, with the reason: its kind. */
export function unusedSlides(topics: Topic[], kinds: SlideKind[]): LeftOut[] {
  const used = new Set(
    topics.flatMap((topic) => topic.concepts.flatMap((concept) => concept.slides)),
  )
  return kinds.flatMap((kind, i) =>
    used.has(i + 1) ? [] : [{ slide: i + 1, reason: REASON[kind] }],
  )
}

/** Cut a title to the limit at a word boundary. */
function shorten(title: string): string {
  const cut = title.slice(0, TITLE_CHARS + 1)
  const space = cut.lastIndexOf(' ')
  return (space > 0 ? cut.slice(0, space) : title.slice(0, TITLE_CHARS)).trim()
}
