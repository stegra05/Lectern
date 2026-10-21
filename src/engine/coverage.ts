/**
 * Coverage ledger — tracks which pages / concepts / relations of the concept
 * map are already covered by generated cards, renders gap text that steers
 * the model toward uncovered material, and decides when coverage is
 * sufficient to stop.
 */

import {
  COVERAGE_MIN_CONCEPT_PERCENT,
  COVERAGE_MIN_PAGE_PERCENT,
  COVERAGE_MIN_RELATION_PERCENT,
  SATURATION_CARDS_PER_PAGE,
} from './config'
import { allocateBudgets } from './pacing'
import { normalizeRelationKey } from './quality'
import type { Card, ConceptMap, CoverageCatalog, CoverageData } from './types'
import { facetIdOf, relationKeyOf } from './types'

// ---------------------------------------------------------------------------
// Local extension of the shared catalog type
// ---------------------------------------------------------------------------

/**
 * The shared CoverageCatalog does not carry relation page references, but the
 * Python original infers relation coverage from page overlap. We keep that
 * behavior by extending the contract type locally (structurally compatible —
 * every EngineCoverageCatalog is a valid CoverageCatalog).
 */
export interface EngineCoverageCatalog extends CoverageCatalog {
  /** page number -> relation keys referenced on that page */
  relationsByPage: Map<number, string[]>
}

const isEngineCatalog = (catalog: CoverageCatalog): catalog is EngineCoverageCatalog =>
  (catalog as Partial<EngineCoverageCatalog>).relationsByPage instanceof Map

// ---------------------------------------------------------------------------
// Normalization helpers (ports of coverage.py normalize_*)
// ---------------------------------------------------------------------------

/** Positive-int normalization: truncate, keep > 0, dedupe preserving order. */
const normalizePages = (pages: readonly number[]): number[] => {
  const result: number[] = []
  const seen = new Set<number>()
  for (const raw of pages) {
    if (!Number.isFinite(raw)) continue
    const page = Math.trunc(raw)
    if (page > 0 && !seen.has(page)) {
      result.push(page)
      seen.add(page)
    }
  }
  return result
}

/** Port of get_card_page_references: sourcePages, else slideNumber fallback. */
const cardPageRefs = (card: Card): number[] => {
  const pages = normalizePages(card.sourcePages)
  if (pages.length > 0) return pages
  if (card.slideNumber !== undefined && Number.isFinite(card.slideNumber)) {
    const slide = Math.trunc(card.slideNumber)
    if (slide > 0) return [slide]
  }
  return []
}

const cardConceptIds = (card: Card): string[] =>
  card.conceptIds.map((id) => id.trim()).filter((id) => id !== '')

const cardRelationKeys = (card: Card): string[] =>
  card.relationKeys.map((key) => normalizeRelationKey(key)).filter((key) => key !== '')

// ---------------------------------------------------------------------------
// Catalog building (port of build_coverage_catalog)
// ---------------------------------------------------------------------------

/**
 * @param pageCount Pages the PDF actually has. The concept map carries a
 *   page_count too, but the model estimates it — and when it under-counts,
 *   every page past its number silently leaves the ledger: no gap is ever
 *   reported for them and page coverage reads 100% (or more) while a third
 *   of the lecture has no cards.
 */
export function buildCoverageCatalog(
  conceptMap: ConceptMap,
  pageCount?: number,
  /** Cards per concept at the run's density; standard depth if absent. */
  budgets?: Map<string, number>,
): EngineCoverageCatalog {
  const conceptIds = new Set<string>()
  const highPriorityIds = new Set<string>()
  const conceptNames = new Map<string, string>()
  const pagesByConcept = new Map<string, number[]>()
  const conceptsByPage = new Map<number, string[]>()

  for (const concept of conceptMap.concepts) {
    const id = concept.id.trim()
    if (id === '') continue
    conceptIds.add(id)
    if (concept.importance === 'high') highPriorityIds.add(id)
    conceptNames.set(id, concept.name.trim())

    const pages = normalizePages(concept.pageReferences)
    const existing = pagesByConcept.get(id)
    if (existing === undefined) {
      pagesByConcept.set(id, pages)
    } else {
      for (const page of pages) {
        if (!existing.includes(page)) existing.push(page)
      }
    }
    for (const page of pages) {
      const onPage = conceptsByPage.get(page)
      if (onPage === undefined) {
        conceptsByPage.set(page, [id])
      } else if (!onPage.includes(id)) {
        onPage.push(id)
      }
    }
  }

  const relationKeys = new Set<string>()
  const relationsByPage = new Map<number, string[]>()
  for (const relation of conceptMap.relations) {
    const key = normalizeRelationKey(
      relationKeyOf({
        source: relation.source.trim(),
        type: relation.type.trim(),
        target: relation.target.trim(),
      }),
    )
    if (key === '') continue
    relationKeys.add(key)
    for (const page of normalizePages(relation.pageReferences)) {
      const onPage = relationsByPage.get(page)
      if (onPage === undefined) {
        relationsByPage.set(page, [key])
      } else if (!onPage.includes(key)) {
        onPage.push(key)
      }
    }
  }

  const facetsByConcept = new Map(
    conceptMap.concepts
      .filter((c) => c.id.trim() !== '')
      .map((c) => [c.id.trim(), c.facets] as const),
  )
  const facets = new Map<string, { conceptId: string; label: string }>()
  for (const [conceptId, labels] of facetsByConcept) {
    labels.forEach((label, i) => facets.set(facetIdOf(conceptId, i), { conceptId, label }))
  }

  return {
    conceptIds,
    highPriorityIds,
    relationKeys,
    conceptsByPage,
    pagesByConcept,
    conceptNames,
    pageCount: pageCount !== undefined && pageCount > 0 ? pageCount : conceptMap.pageCount,
    relationsByPage,
    budgets: budgets ?? allocateBudgets(conceptMap, 'standard'),
    facetsByConcept,
    facets,
  }
}

/** The facets the model tags its cards with, one line per concept:
 *  "c-a Concept A: #1 what A is; #2 where A applies". */
export function buildFacetCatalogText(catalog: CoverageCatalog): string {
  return [...catalog.facetsByConcept]
    .filter(([, labels]) => labels.length > 0)
    .map(
      ([id, labels]) =>
        `${id} ${catalog.conceptNames.get(id) || id}: ` +
        labels.map((label, i) => `#${i + 1} ${label}`).join('; '),
    )
    .join('\n')
}

/**
 * Would this card only re-test what the deck already tests? True when it
 * claims at least one facet and every facet it claims already has a card in
 * `deck`, at every depth: Thorough's extra slots buy depth, never a second
 * card on one fact. A card that names no facet is never a repeat by this
 * measure, there is nothing to compare it on. Neither is a connection: a
 * card that spans facets of two concepts, or teaches a mapped relation, asks
 * what neither facet's own card does. That is the why/how/compare card the
 * depth ledger asks for.
 */
export function repeatsTestedFacets(
  card: Pick<Card, 'facetIds' | 'relationKeys'>,
  deck: readonly Card[],
  catalog: CoverageCatalog,
): boolean {
  if (card.facetIds.length === 0 || card.relationKeys.length > 0) return false
  const concepts = new Set(card.facetIds.map((id) => catalog.facets.get(id)?.conceptId))
  if (concepts.size > 1) return false
  return card.facetIds.every((id) => deck.some((other) => other.facetIds.includes(id)))
}

// ---------------------------------------------------------------------------
// Coverage computation (port of compute_coverage_data)
// ---------------------------------------------------------------------------

const sortedNumbers = (values: Iterable<number>): number[] => [...values].sort((a, b) => a - b)

const percent = (covered: number, total: number): number =>
  total > 0 ? Math.round((covered / total) * 100) : 0

export function computeCoverageData(catalog: CoverageCatalog, cards: Card[]): CoverageData {
  const relationsByPage = isEngineCatalog(catalog)
    ? catalog.relationsByPage
    : new Map<number, string[]>()

  const coveredPages = new Set<number>()
  const explicitConceptIds = new Set<string>()
  const conceptsCoveredByPage = new Set<string>()
  /** Page-inferred concepts of cards that *cannot* name ids: a card read back
   *  out of Anki lost them to a fresh concept map, so page overlap is the
   *  only evidence it will ever have. */
  const conceptsCoveredByInheritedPage = new Set<string>()
  const explicitRelationKeys = new Set<string>()
  const relationsCoveredByPage = new Set<string>()
  const cardsPerPage = new Map<number, number>()
  const cardsByConcept = new Map<string, number>()
  const cardsByFacet = new Map<string, number>()
  const countFor = (id: string) => cardsByConcept.set(id, (cardsByConcept.get(id) ?? 0) + 1)

  for (const card of cards) {
    const pages = cardPageRefs(card)
    // What a card teaches: the concepts it names, or, for a card read back
    // from Anki (which lost its ids), the concepts on the pages it cites.
    const taught =
      card.fromAnki === true
        ? new Set(pages.flatMap((page) => catalog.conceptsByPage.get(page) ?? []))
        : new Set(cardConceptIds(card).filter((id) => catalog.conceptIds.has(id)))
    for (const id of taught) countFor(id)
    // Like its concept ids, an inherited card's facet ids belonged to another
    // concept map; it answers for concepts only, by page.
    const facets = card.fromAnki === true ? [] : new Set(card.facetIds)
    for (const id of facets) {
      if (catalog.facets.has(id)) cardsByFacet.set(id, (cardsByFacet.get(id) ?? 0) + 1)
    }
    for (const page of pages) {
      coveredPages.add(page)
      cardsPerPage.set(page, (cardsPerPage.get(page) ?? 0) + 1)
      for (const conceptId of catalog.conceptsByPage.get(page) ?? []) {
        conceptsCoveredByPage.add(conceptId)
        if (card.fromAnki === true) conceptsCoveredByInheritedPage.add(conceptId)
      }
      for (const relationKey of relationsByPage.get(page) ?? []) {
        relationsCoveredByPage.add(relationKey)
      }
    }
    for (const conceptId of cardConceptIds(card)) explicitConceptIds.add(conceptId)
    for (const relationKey of cardRelationKeys(card)) explicitRelationKeys.add(relationKey)
  }

  const coveredConceptUnion = new Set<string>(explicitConceptIds)
  for (const conceptId of conceptsCoveredByPage) coveredConceptUnion.add(conceptId)

  const coveredRelationUnion = new Set<string>(explicitRelationKeys)
  for (const relationKey of relationsCoveredByPage) coveredRelationUnion.add(relationKey)

  const uncoveredPages: number[] = []
  for (let page = 1; page <= catalog.pageCount; page += 1) {
    if (!coveredPages.has(page)) uncoveredPages.push(page)
  }

  // A high-importance concept counts as taught when a card claims it
  // outright. Page overlap stays good enough for the percentages — one card
  // on page 5 does say something about page 5 — but it is not evidence that
  // the card teaches the hard concept that happens to live there, and this
  // list is what decides whether the run is allowed to stop. Cards inherited
  // from Anki are the exception: ids are the one thing they cannot carry.
  const missingHighPriority = [...catalog.highPriorityIds].filter(
    (id) => !explicitConceptIds.has(id) && !conceptsCoveredByInheritedPage.has(id),
  )

  const saturatedPages = sortedNumbers(cardsPerPage.keys()).filter(
    (page) => (cardsPerPage.get(page) ?? 0) > SATURATION_CARDS_PER_PAGE,
  )

  const cardsPerPageRecord: Record<number, number> = {}
  for (const [page, count] of cardsPerPage) cardsPerPageRecord[page] = count

  // Breadth before depth: a concept with no card at all outranks a second
  // card for one that has some. A blind review found decks spending slots on
  // a third CIN card while whole organs went without one.
  const deficit = (id: string) => (catalog.budgets.get(id) ?? 0) - (cardsByConcept.get(id) ?? 0)
  const unstarted = (id: string) => Number(!cardsByConcept.has(id))
  const underBudget = [...catalog.conceptIds]
    .filter((id) => deficit(id) > 0)
    .sort(
      (a, b) =>
        unstarted(b) - unstarted(a) ||
        Number(catalog.highPriorityIds.has(b)) - Number(catalog.highPriorityIds.has(a)) ||
        deficit(b) - deficit(a),
    )
  // A concept credited by inherited cards may be short with facets those
  // cards already test; they cannot say which, so all of its facets show.
  // One they fully satisfy is not short and shows none.
  // Never more than the budget still has room for: an overview that wants
  // one more card of a four-facet concept lists one facet, not three.
  const untestedFacets = underBudget.flatMap((id) =>
    (catalog.facetsByConcept.get(id) ?? [])
      .map((_, i) => facetIdOf(id, i))
      .filter((facetId) => !cardsByFacet.has(facetId))
      .slice(0, Math.max(0, (catalog.budgets.get(id) ?? 0) - (cardsByConcept.get(id) ?? 0))),
  )

  const totalConcepts = catalog.conceptIds.size
  const totalRelations = catalog.relationKeys.size

  return {
    pageCount: catalog.pageCount,
    coveredPages: sortedNumbers(coveredPages),
    uncoveredPages,
    pageCoveragePercent: percent(coveredPages.size, catalog.pageCount),
    coveredConceptIds: [...explicitConceptIds].sort(),
    inferredConceptIds: [...conceptsCoveredByPage]
      .filter((id) => !explicitConceptIds.has(id))
      .sort(),
    conceptCoveragePercent: percent(explicitConceptIds.size, totalConcepts),
    effectiveConceptCoveragePercent: percent(coveredConceptUnion.size, totalConcepts),
    coveredRelationKeys: [...coveredRelationUnion].sort(),
    // When the catalog has no relations there is nothing left to cover, so
    // report 100 (Python reported 0 but special-cased "no relations" in the
    // sufficiency check; CoverageData alone must carry that information here).
    relationCoveragePercent:
      totalRelations > 0 ? percent(coveredRelationUnion.size, totalRelations) : 100,
    missingHighPriority,
    saturatedPages,
    cardsPerPage: cardsPerPageRecord,
    cardsByConcept: Object.fromEntries(cardsByConcept),
    underBudget,
    cardsByFacet: Object.fromEntries(cardsByFacet),
    untestedFacets,
  }
}

/** Cards the deck still lacks to meet every concept's budget. */
export function budgetShortfall(catalog: CoverageCatalog, coverage: CoverageData): number {
  return coverage.underBudget.reduce(
    (sum, id) => sum + (catalog.budgets.get(id) ?? 0) - (coverage.cardsByConcept[id] ?? 0),
    0,
  )
}

/** Budgeted concepts with no card at all. */
export const conceptsWithoutCards = (coverage: CoverageData): string[] =>
  coverage.underBudget.filter((id) => (coverage.cardsByConcept[id] ?? 0) === 0)

/** Cards a concept needs before each of its facets has one: its facets,
 *  within its budget (an overview budgets fewer). */
const facetTarget = (catalog: CoverageCatalog, id: string): number =>
  Math.min(catalog.budgets.get(id) ?? 0, Math.max(1, catalog.facetsByConcept.get(id)?.length ?? 0))

/** Concepts with a facet no card tests yet. Past that point the rest of a
 *  concept's budget (thorough only) is for depth, not for another fact. */
export const conceptsWithUntestedFacets = (
  catalog: CoverageCatalog,
  coverage: CoverageData,
): string[] =>
  coverage.underBudget.filter((id) => (coverage.cardsByConcept[id] ?? 0) < facetTarget(catalog, id))

// ---------------------------------------------------------------------------
// Gap text (ports of build_generation_gap_text / build_reflection_gap_text)
// ---------------------------------------------------------------------------

const preview = <T>(
  items: readonly T[],
  limit: number,
  render: (item: T) => string,
  separator = ', ',
): string => items.slice(0, limit).map(render).join(separator) + (items.length > limit ? '...' : '')

const describeConcept = (catalog: CoverageCatalog, id: string): string => {
  const name = catalog.conceptNames.get(id)
  const pages = catalog.pagesByConcept.get(id) ?? []
  const pageText = pages.length > 0 ? pages.join(',') : '?'
  return `${name !== undefined && name !== '' ? name : id}@${pageText}`
}

/** "Endometriose@3 (1/2 cards)" */
const describeShortConcept = (
  catalog: CoverageCatalog,
  coverage: CoverageData,
  id: string,
  /** Cards the line counts toward: the facets, or the whole budget for depth. */
  target: number,
): string => `${describeConcept(catalog, id)} (${coverage.cardsByConcept[id] ?? 0}/${target} cards)`

/** "c-a#2 where A applies; c-b#1 what B is", cut at `limit`. Labels can hold
 *  commas, so facets are kept apart by semicolons. */
export const describeFacets = (
  catalog: CoverageCatalog,
  facetIds: readonly string[],
  limit: number,
): string =>
  preview(facetIds, limit, (id) => `${id} ${catalog.facets.get(id)?.label ?? ''}`.trim(), '; ')

interface GapSummary {
  /** Concepts a card names outright. Page overlap is not counted here: the
   *  ledger reports what the deck demonstrably teaches, and a model reading
   *  "17/17 covered" for five concepts without a card repeated it as fact. */
  explicitConceptCount: number
  coveredRelationCount: number
  uncoveredRelationKeys: string[]
}

const summarizeGaps = (catalog: CoverageCatalog, coverage: CoverageData): GapSummary => {
  const coveredRelations = new Set<string>(coverage.coveredRelationKeys)
  return {
    explicitConceptCount: coverage.coveredConceptIds.length,
    coveredRelationCount: coverage.coveredRelationKeys.length,
    uncoveredRelationKeys: [...catalog.relationKeys].filter((key) => !coveredRelations.has(key)),
  }
}

// ---------------------------------------------------------------------------
// Question mix
// ---------------------------------------------------------------------------

/** Below this the mix is noise rather than a pattern worth steering. */
const MIX_MIN_CARDS = 8

const QUESTION_KINDS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'why', re: /\b(why|warum|wieso|weshalb)\b/i },
  { kind: 'how', re: /\b(how|wie)\b/i },
  {
    kind: 'compare',
    re: /\b(compare|comparison|difference|differs?|versus|vs\.?|unterschied|vergleich)\w*\b/i,
  },
  { kind: 'apply', re: /\b(given|calculate|compute|derive|apply|predict|berechne|gegeben)\w*\b/i },
]

/**
 * What kinds of question the deck is made of.
 *
 * The system prompt asks for variety and for understanding over recall, but
 * nothing measured it, so nothing steered it — a deck of forty "What is …?"
 * definitions satisfied every counter in this ledger. Naming the mix back to
 * the model is the same trick the coverage numbers already play.
 */
export function summarizeQuestionMix(cards: readonly Card[]): string | null {
  if (cards.length < MIX_MIN_CARDS) return null
  const counts = new Map<string, number>()
  for (const card of cards) {
    const front = (card.fields?.['Front'] ?? card.fields?.['Text'] ?? '')
      .replace(/<[^>]+>/g, ' ')
      .slice(0, 200)
    const kind = QUESTION_KINDS.find((k) => k.re.test(front))?.kind ?? 'recall/definition'
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${count} ${kind}`)
  return `${parts.join(', ')} (of ${cards.length})`
}

export function buildGenerationGapText(
  catalog: CoverageCatalog,
  coverage: CoverageData,
  cards: readonly Card[] = [],
): string {
  const gaps = summarizeGaps(catalog, coverage)

  const lines = [
    '- COVERAGE LEDGER:',
    `  - Pages covered: ${coverage.coveredPages.length}/${catalog.pageCount}.`,
    `  - Concepts a card names: ${gaps.explicitConceptCount}/${catalog.conceptIds.size}.`,
    `  - Relations covered: ${gaps.coveredRelationCount}/${catalog.relationKeys.size}.`,
  ]

  const mix = summarizeQuestionMix(cards)
  if (mix !== null) {
    lines.push(
      `  - Question mix so far: ${mix}. A deck that only asks for definitions tests recall, not understanding; weight the next batch toward why/how/compare/apply.`,
    )
  }

  if (coverage.uncoveredPages.length > 0) {
    lines.push(`  - Prioritize uncovered pages: ${preview(coverage.uncoveredPages, 15, String)}`)
  }

  if (coverage.missingHighPriority.length > 0) {
    lines.push(
      `  - Missing HIGH priority concepts: ${preview(coverage.missingHighPriority, 8, (id) =>
        describeConcept(catalog, id),
      )}`,
    )
  }
  const withoutCards = conceptsWithoutCards(coverage)
  const toFacets = (id: string) =>
    describeShortConcept(catalog, coverage, id, facetTarget(catalog, id))
  if (withoutCards.length > 0) {
    lines.push(
      `  - Concepts with no card yet (cover these first): ${preview(withoutCards, 10, toFacets)}`,
    )
  }
  if (coverage.untestedFacets.length > 0) {
    lines.push(
      `  - Facets no card tests yet (one card each, tagged with its facet id): ${describeFacets(
        catalog,
        coverage.untestedFacets,
        12,
      )}`,
    )
  }
  // A thorough budget runs past the facets. Those slots open only once every
  // facet has its card, and they buy depth: a further card on a tested fact
  // is the repetition the review pass removes.
  const breadthDone =
    coverage.untestedFacets.length === 0 &&
    conceptsWithUntestedFacets(catalog, coverage).length === 0
  if (breadthDone && coverage.underBudget.length > 0) {
    lines.push(
      `  - Every facet has its card. Room for depth (a why/how/compare/apply card that links the concept to another or puts it to use; never a facet a card already tests): ${preview(
        coverage.underBudget,
        8,
        (id) => describeShortConcept(catalog, coverage, id, catalog.budgets.get(id) ?? 0),
      )}`,
    )
  }
  if (coverage.underBudget.length === 0) lines.push('  - Every concept has its budgeted cards.')

  if (gaps.uncoveredRelationKeys.length > 0) {
    lines.push(`  - Missing relations: ${preview(gaps.uncoveredRelationKeys, 6, (key) => key)}`)
  }

  if (coverage.saturatedPages.length > 0) {
    lines.push(
      `  - Over-covered pages to deprioritize: ${preview(coverage.saturatedPages, 8, String)}`,
    )
  }

  return lines.join('\n') + '\n'
}

/**
 * The ledger for a run that has nowhere left to go outward.
 *
 * Extending an already-thorough deck starts at full page coverage, where the
 * generation ledger reads as "done" and would stop the run with nothing
 * added. What is actually left is depth: pages carrying a single card,
 * concepts no card names outright, and the relations between concepts —
 * which are where a deck stops testing recall and starts testing
 * understanding. This names those instead of counting pages.
 */
export function buildDepthGapText(catalog: CoverageCatalog, coverage: CoverageData): string {
  const gaps = summarizeGaps(catalog, coverage)

  // Pages the deck touches only once are the likeliest to be under-taught;
  // saturated pages are where another card would just crowd.
  const thinPages = coverage.coveredPages.filter((page) => (coverage.cardsPerPage[page] ?? 0) <= 1)
  const unnamedConcepts = [...catalog.conceptIds].filter(
    (id) => !coverage.coveredConceptIds.includes(id),
  )

  const lines = [
    '- DEPTH LEDGER (breadth is already complete; add depth, not repeats):',
    `  - Cards in the deck cover ${coverage.coveredPages.length}/${catalog.pageCount} pages.`,
  ]

  if (thinPages.length > 0) {
    lines.push(`  - Pages carrying only one card: ${preview(thinPages, 15, String)}`)
  }
  if (gaps.uncoveredRelationKeys.length > 0) {
    lines.push(
      `  - Relations no card teaches yet: ${preview(gaps.uncoveredRelationKeys, 8, (key) => key)}`,
    )
  }
  if (unnamedConcepts.length > 0) {
    lines.push(
      `  - Concepts no card names directly: ${preview(unnamedConcepts, 8, (id) =>
        describeConcept(catalog, id),
      )}`,
    )
  }
  if (coverage.saturatedPages.length > 0) {
    lines.push(`  - Already crowded, leave alone: ${preview(coverage.saturatedPages, 8, String)}`)
  }

  return lines.join('\n') + '\n'
}

export function buildReflectionGapText(catalog: CoverageCatalog, coverage: CoverageData): string {
  const gaps = summarizeGaps(catalog, coverage)
  const highPriorityTotal = catalog.highPriorityIds.size
  const highPriorityCovered = highPriorityTotal - coverage.missingHighPriority.length

  const lines = [
    'Coverage audit:',
    `- Page coverage: ${coverage.coveredPages.length}/${catalog.pageCount}.`,
    `- Concepts a card names: ${gaps.explicitConceptCount}/${catalog.conceptIds.size}.`,
    `- Relation coverage: ${gaps.coveredRelationCount}/${catalog.relationKeys.size}.`,
    `- High-priority concept coverage: ${highPriorityCovered}/${highPriorityTotal}.`,
  ]

  if (coverage.uncoveredPages.length > 0) {
    lines.push(`- Uncovered pages: ${preview(coverage.uncoveredPages, 15, String)}`)
  }
  if (coverage.missingHighPriority.length > 0) {
    lines.push(
      `- Missing high-priority concepts: ${preview(coverage.missingHighPriority, 10, (id) => {
        const name = catalog.conceptNames.get(id)
        return name !== undefined && name !== '' ? name : id
      })}`,
    )
  }
  const withoutCards = conceptsWithoutCards(coverage)
  if (withoutCards.length > 0) {
    lines.push(
      `- Concepts with no card: ${preview(withoutCards, 10, (id) =>
        describeShortConcept(catalog, coverage, id, facetTarget(catalog, id)),
      )}`,
    )
  }
  if (coverage.untestedFacets.length > 0) {
    lines.push(
      `- Facets no card tests yet (add_cards targets): ${describeFacets(
        catalog,
        coverage.untestedFacets,
        10,
      )}`,
    )
  }
  if (gaps.uncoveredRelationKeys.length > 0) {
    lines.push(`- Missing relations: ${preview(gaps.uncoveredRelationKeys, 8, (key) => key)}`)
  }
  if (coverage.saturatedPages.length > 0) {
    lines.push(`- Saturated pages to thin out: ${preview(coverage.saturatedPages, 10, String)}`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Sufficiency (port of generation_utils._coverage_is_sufficient)
// ---------------------------------------------------------------------------

export function isCoverageSufficient(coverage: CoverageData): boolean {
  const highPriorityOk = coverage.missingHighPriority.length === 0
  // relationCoveragePercent is 100 when the catalog has no relations, which
  // mirrors Python's "total_relations == 0 or relation_pct >= 50" check.
  const relationOk = coverage.relationCoveragePercent >= COVERAGE_MIN_RELATION_PERCENT
  return (
    highPriorityOk &&
    relationOk &&
    (coverage.conceptCoveragePercent >= COVERAGE_MIN_CONCEPT_PERCENT ||
      coverage.pageCoveragePercent >= COVERAGE_MIN_PAGE_PERCENT)
  )
}
