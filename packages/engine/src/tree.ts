/**
 * From the model's map of a lecture to the tree that is stored. Pure. The result is always
 * usable: code closes every gap itself. `problems` says what the model got wrong, so the
 * caller can ask once more before settling for the repaired tree.
 */

import { slideRange, slug, words } from './cards/words.ts'
import type { LeftOut, Topic } from './course.ts'

export const TITLE_CHARS = 32
const CONCEPT_WORDS = 6

export interface MapOutput {
  title: string
  topics: { name: string; concepts: { name: string; slides: number[] }[] }[]
  leftOut: { slides: number[]; reason: string }[]
}

export interface MapContext {
  slideCount: number
  /** Slides without text. Nothing can be asked from them yet. */
  emptySlides: number[]
  /** Concept ids of earlier lectures, with the lecture that covers them. */
  earlier: Map<string, number>
  /** Used when the model gives no title. */
  fallbackTitle: string
}

export interface Settled {
  title: string
  topics: Topic[]
  leftOut: LeftOut[]
  /** Concepts dropped because an earlier lecture has them. */
  covered: { name: string; lecture: number }[]
  problems: string[]
}

export function settleMap(out: MapOutput, ctx: MapContext): Settled {
  const problems: string[] = []
  const empty = new Set(ctx.emptySlides)
  const readable = (n: number) =>
    Number.isInteger(n) && n >= 1 && n <= ctx.slideCount && !empty.has(n)

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
  const used = new Set<number>()
  const covered: Settled['covered'] = []
  const coveredSlides = new Map<number, number>()
  const topics: Topic[] = []
  for (const [t, topic] of out.topics.entries()) {
    const concepts = []
    for (const concept of topic.concepts) {
      const name = concept.name.trim()
      if (name === '') {
        problems.push('a concept has no name')
        continue
      }
      if (words(name) > CONCEPT_WORDS)
        problems.push(`concept "${name}" has more than ${CONCEPT_WORDS} words`)
      const slides = [...new Set(concept.slides)].filter(readable).sort((a, b) => a - b)
      const bad = concept.slides.filter((n) => !readable(n))
      if (bad.length > 0)
        problems.push(`concept "${name}" names ${slideRange(bad)} without readable text`)
      if (slides.length === 0) {
        problems.push(`concept "${name}" has no slide`)
        continue
      }
      const id = slug(name) || `concept-${ids.size + 1}`
      const earlier = ctx.earlier.get(id)
      if (earlier !== undefined) {
        covered.push({ name, lecture: earlier })
        for (const s of slides) coveredSlides.set(s, earlier)
        continue
      }
      if (ids.has(id)) {
        problems.push(`concept "${name}" appears twice`)
        continue
      }
      ids.add(id)
      for (const s of slides) used.add(s)
      concepts.push({ id, name, slides })
    }
    if (topic.concepts.length === 0) problems.push(`topic "${topic.name}" has no concepts`)
    if (concepts.length > 0) topics.push({ name: topic.name.trim() || `Topic ${t + 1}`, concepts })
  }
  if (topics.length === 0 && covered.length === 0) problems.push('the map has no concepts')

  const reasons = new Map<number, string>()
  for (const group of out.leftOut) {
    const reason = group.reason.trim()
    if (reason === '') problems.push(`${slideRange(group.slides)} left out without a reason`)
    for (const s of group.slides) {
      if (readable(s) && !reasons.has(s)) reasons.set(s, reason || 'No reason given')
    }
  }
  const unaccounted: number[] = []
  const leftOut: LeftOut[] = []
  for (let slide = 1; slide <= ctx.slideCount; slide++) {
    if (used.has(slide)) continue
    const earlier = coveredSlides.get(slide)
    if (empty.has(slide)) leftOut.push({ slide, reason: 'No readable text on this slide' })
    else if (earlier !== undefined)
      leftOut.push({ slide, reason: `Already covered in lecture ${earlier}` })
    else if (reasons.has(slide)) leftOut.push({ slide, reason: reasons.get(slide)! })
    else {
      unaccounted.push(slide)
      leftOut.push({ slide, reason: 'No concept found on this slide' })
    }
  }
  if (unaccounted.length > 0) {
    problems.push(
      `${slideRange(unaccounted)}: neither used by a concept nor left out with a reason`,
    )
  }
  return { title, topics, leftOut, covered, problems }
}

/** Cut a title to the limit at a word boundary. */
function shorten(title: string): string {
  const cut = title.slice(0, TITLE_CHARS + 1)
  const space = cut.lastIndexOf(' ')
  return (space > 0 ? cut.slice(0, space) : title.slice(0, TITLE_CHARS)).trim()
}
