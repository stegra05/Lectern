/**
 * From the model's map of a lecture to the tree that is stored. Pure. The result is always
 * usable: code closes every gap itself.
 */

import { slug } from './cards/words.ts'
import type { Concept, LeftOut, Topic } from './course.ts'

export const TITLE_CHARS = 32
/** More facts than this per concept means several ideas share one name; the rest is cut. */
export const FACTS_PER_CONCEPT = 12

export interface MapOutput {
  title: string
  topics: {
    name: string
    concepts: {
      name: string
      facts: { text: string; slide: number; items: number }[]
    }[]
  }[]
}

/** One fact as the reading of one slide gives it, with the name of what it is about. */
export interface ReadFact {
  concept: string
  text: string
  slide: number
  items: number
}

/** How the model sorted the facts of a lecture: topics, concepts, and the ids of their facts. */
export interface Grouping {
  title: string
  topics: { name: string; concepts: { name: string; facts: string[] }[] }[]
  /** Ids of facts that repeat another fact, in the same or in other words. They are left out. */
  repeats: string[]
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * The map from the facts of a lecture and how the model sorted them. `idOf` gives the id the
 * model saw for each fact. An id the model names twice counts once and an id it does not know
 * is passed over. A fact it calls a repeat is left out. A fact it forgot is kept, under the
 * concept the reading named for it: an existing one of that name, or a new one in the last
 * topic.
 */
export function fromGroups(
  facts: ReadFact[],
  grouping: Grouping,
  idOf: (i: number) => string,
): MapOutput {
  const byId = new Map(facts.map((fact, i) => [idOf(i), fact]))
  const placed = new Set<ReadFact>(grouping.repeats.flatMap((id) => byId.get(id.trim()) ?? []))
  const take = (id: string) => {
    const fact = byId.get(id.trim())
    if (!fact || placed.has(fact)) return []
    placed.add(fact)
    return [{ text: fact.text, slide: fact.slide, items: fact.items }]
  }
  const topics = grouping.topics.map((topic) => ({
    name: topic.name,
    concepts: topic.concepts.map((concept) => ({
      name: concept.name,
      facts: concept.facts.flatMap(take),
    })),
  }))
  for (const fact of facts.filter((f) => !placed.has(f))) {
    const item = { text: fact.text, slide: fact.slide, items: fact.items }
    const known = topics.flatMap((t) => t.concepts).find((c) => same(c.name, fact.concept))
    if (known) known.facts.push(item)
    else if (topics.length > 0) topics.at(-1)!.concepts.push({ name: fact.concept, facts: [item] })
    else topics.push({ name: fact.concept, concepts: [{ name: fact.concept, facts: [item] }] })
  }
  return { title: grouping.title, topics }
}

export interface MapContext {
  /** The number of slides of the lecture. */
  slides: number
  /** The concepts earlier lectures introduced, by id: the course's vocabulary. */
  earlier: Map<string, { name: string; lecture: number }>
  /** Used when the model gives no title. */
  fallbackTitle: string
}

export interface Settled {
  title: string
  topics: Topic[]
  leftOut: LeftOut[]
}

export function settleMap(out: MapOutput, ctx: MapContext): Settled {
  const exists = (n: number) => Number.isInteger(n) && n >= 1 && n <= ctx.slides

  const title = shorten(out.title.trim() || ctx.fallbackTitle)

  const byId = new Map<string, Concept>()
  const topics: Topic[] = []
  for (const [t, topic] of out.topics.entries()) {
    const concepts: Concept[] = []
    for (const concept of topic.concepts) {
      const name = concept.name.trim()
      if (name === '') continue
      const facts = concept.facts
        .filter((fact) => fact.text.trim() !== '' && exists(fact.slide))
        .map((fact) => ({
          text: fact.text.trim(),
          slide: fact.slide,
          kind: 'definition' as const,
          ...(Number.isInteger(fact.items) && fact.items > 0 ? { items: fact.items } : {}),
        }))
      if (facts.length === 0) continue
      const id = slug(name) || `concept-${byId.size + 1}`
      // A concept named twice is one concept: the later facts join the first.
      const first = byId.get(id)
      if (first) {
        first.facts = [...first.facts, ...facts].slice(0, FACTS_PER_CONCEPT)
        first.slides = slidesOf(first.facts)
        continue
      }
      // One vocabulary: a concept that comes up again keeps the name the course already uses.
      const known = ctx.earlier.get(id)
      const settled: Concept = {
        id,
        name: known?.name ?? name,
        slides: [],
        ...(known ? { since: known.lecture } : {}),
        facts: facts.slice(0, FACTS_PER_CONCEPT),
      }
      settled.slides = slidesOf(settled.facts)
      byId.set(id, settled)
      concepts.push(settled)
    }
    if (concepts.length > 0) topics.push({ name: topic.name.trim() || `Topic ${t + 1}`, concepts })
  }

  return { title, topics, leftOut: unusedSlides(topics, ctx.slides) }
}

const slidesOf = (facts: { slide: number }[]) =>
  [...new Set(facts.map((fact) => fact.slide))].sort((a, b) => a - b)

/** Every slide no concept uses. */
export function unusedSlides(topics: Topic[], slides: number): LeftOut[] {
  const used = new Set(
    topics.flatMap((topic) => topic.concepts.flatMap((concept) => concept.slides)),
  )
  return Array.from({ length: slides }, (_, i) => i + 1)
    .filter((slide) => !used.has(slide))
    .map((slide) => ({ slide, reason: 'No testable fact on this slide' }))
}

/** Cut a title to the limit at a word boundary. */
function shorten(title: string): string {
  if (title.length <= TITLE_CHARS) return title
  const cut = title.slice(0, TITLE_CHARS + 1)
  const space = cut.lastIndexOf(' ')
  return (space > 0 ? cut.slice(0, space) : title.slice(0, TITLE_CHARS)).trim()
}
