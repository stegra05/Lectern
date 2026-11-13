/**
 * Concept-map cleanup, run once between mapping and the first card. The deck
 * size and the facet-repeat rule both rest on the facet list, so a fact that
 * sits in two slots gets two cards, and a map split too finely pads the deck.
 *
 * The app merges what is certainly one fact; whatever only looks like one is
 * flagged for the model, together with a facet total the lecture cannot
 * support. Facets carry no citation of their own, so "the same page sentence"
 * is only approximated: two concepts must share a page before the app merges
 * their facets.
 *
 * All functions are pure.
 */

import { CLEANUP_MIN_SHARE, FACETS_PER_CONCEPT_LIMIT } from './config'
import { facetCount } from './pacing'
import { jaccard, stripMarkup, wordsKey } from './quality'
import type { Concept, ConceptMap, Importance } from './types'

/** Words this short carry no subject ("the", "of", "is"); digits always do
 *  ("HPV 16/18"). */
const MIN_WORD_LEN = 3
/** Inflections share a prefix: freezing/freeze, parameter/parameters. */
const STEM_LEN = 5
/** Above this stem overlap two labels name one fact. "Freezing parameters"
 *  and "freezing pretrained parameters" share 2 of 3; "HPV 16/18 high-risk
 *  types" and "HPV low-risk types" share 3 of 7 and stay apart. */
export const OVERLAP_SIMILARITY = 2 / 3
/** Across concepts a label is read without the concept that gives it its
 *  subject: "Definition" under two concepts is two facts. A label needs this
 *  many words of its own before it is compared with another concept's. */
const MIN_STEMS_ACROSS = 2

export interface FacetRef {
  conceptId: string
  label: string
}

export interface MapFlags {
  /** Facet pairs that look like one fact in two slots. */
  overlaps: Array<[FacetRef, FacetRef]>
  /** The facets the deck is sized from: one per facet, at least one per concept. */
  facetTotal: number
  /** The most facets the lecture supports. */
  facetLimit: number
}

const labelKey = (label: string): string => wordsKey(stripMarkup(label))

const labelStems = (label: string): Set<string> =>
  new Set(
    labelKey(label)
      .split(' ')
      .filter((word) => word.length >= MIN_WORD_LEN || /\d/.test(word))
      .map((word) => word.slice(0, STEM_LEN)),
  )

const IMPORTANCE_RANK: Record<Importance, number> = { high: 2, medium: 1, low: 0 }

const sharesPage = (a: Concept, b: Concept): boolean =>
  a.pageReferences.some((page) => b.pageReferences.includes(page))

export const facetTotal = (map: ConceptMap): number =>
  map.concepts.reduce((sum, concept) => sum + facetCount(concept), 0)

/**
 * Merge the facets that are certainly one fact: the same label twice in one
 * concept, or a specific label under two concepts taught on a shared page.
 * The fact stays with the more important concept (the earlier one on a tie),
 * so an overview that drops low-importance concepts keeps it. A concept is
 * never left without facets: a concept that would be is the same idea as
 * the other, and that is the model's call, not a label match.
 *
 * Facet ids number a concept's facets, so later ones shift; nothing holds
 * them yet, the first card is written after this.
 */
export function mergeExactRepeats(map: ConceptMap): { conceptMap: ConceptMap; merged: number } {
  const concepts = map.concepts.map((concept) => ({
    ...concept,
    facets: concept.facets.filter(
      (label, i) => concept.facets.findIndex((other) => labelKey(other) === labelKey(label)) === i,
    ),
  }))
  for (let i = 0; i < concepts.length; i++) {
    for (let j = i + 1; j < concepts.length; j++) {
      const [a, b] = [concepts[i], concepts[j]]
      if (!sharesPage(a, b)) continue
      for (const label of a.facets) {
        const key = labelKey(label)
        if (labelStems(label).size < MIN_STEMS_ACROSS) continue
        if (!b.facets.some((other) => labelKey(other) === key)) continue
        const loser = IMPORTANCE_RANK[b.importance] > IMPORTANCE_RANK[a.importance] ? a : b
        if (loser.facets.length < 2) continue
        loser.facets = loser.facets.filter((other) => labelKey(other) !== key)
      }
    }
  }
  const before = map.concepts.reduce((sum, c) => sum + c.facets.length, 0)
  const after = concepts.reduce((sum, c) => sum + c.facets.length, 0)
  return { conceptMap: { ...map, concepts }, merged: before - after }
}

/** What the model is asked to look at again. */
export function checkConceptMap(map: ConceptMap, target: { max: number }): MapFlags {
  const facets = map.concepts.flatMap((concept) =>
    concept.facets.map((label) => ({ conceptId: concept.id, label, stems: labelStems(label) })),
  )
  const overlaps: Array<[FacetRef, FacetRef]> = []
  for (let i = 0; i < facets.length; i++) {
    for (let j = i + 1; j < facets.length; j++) {
      const [a, b] = [facets[i], facets[j]]
      const across = a.conceptId !== b.conceptId
      if (across && (a.stems.size < MIN_STEMS_ACROSS || b.stems.size < MIN_STEMS_ACROSS)) continue
      if (jaccard(a.stems, b.stems) < OVERLAP_SIMILARITY) continue
      overlaps.push([
        { conceptId: a.conceptId, label: a.label },
        { conceptId: b.conceptId, label: b.label },
      ])
    }
  }
  return {
    overlaps,
    facetTotal: facetTotal(map),
    facetLimit: target.max * FACETS_PER_CONCEPT_LIMIT,
  }
}

const flagCount = (flags: MapFlags): number =>
  flags.overlaps.length + Number(flags.facetTotal > flags.facetLimit)

export const hasFlags = (flags: MapFlags): boolean => flagCount(flags) > 0

/**
 * The map with the model's corrected facets, or null when the correction is
 * not one to trust. It must name exactly the map's concepts, leave no concept
 * that had facets without any, add no facets, not fall below half of the
 * size it was asked to reach, and not fare worse on the same check. Only the
 * facets are taken: the turn was about them, and the rest of the map stays
 * as first read.
 */
export function applyFacetCorrection(
  map: ConceptMap,
  corrected: Map<string, string[]>,
  target: { max: number },
): ConceptMap | null {
  const ids = map.concepts.map((concept) => concept.id.trim())
  if (corrected.size !== ids.length || !ids.every((id) => corrected.has(id))) return null
  const facetsOf = (concept: Concept): string[] => corrected.get(concept.id.trim()) ?? []
  if (map.concepts.some((c) => c.facets.length > 0 && facetsOf(c).length === 0)) return null

  const { conceptMap: candidate } = mergeExactRepeats({
    ...map,
    concepts: map.concepts.map((concept) => ({ ...concept, facets: facetsOf(concept) })),
  })
  const before = checkConceptMap(map, target)
  const asked = Math.min(before.facetTotal, before.facetLimit)
  const total = facetTotal(candidate)
  if (total > before.facetTotal || total < asked * CLEANUP_MIN_SHARE) return null
  return flagCount(checkConceptMap(candidate, target)) > flagCount(before) ? null : candidate
}
