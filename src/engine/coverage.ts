/**
 * Coverage ledger — faithful port of LecternApp/lectern/coverage.py plus the
 * reflection card selector from lectern/generation_utils.py.
 *
 * Tracks which pages / concepts / relations of the concept map are already
 * covered by generated cards, renders gap text that steers the model toward
 * uncovered material, decides when coverage is sufficient to stop, and greedily
 * picks the best card set after a reflection round.
 */

import {
  COVERAGE_MIN_CONCEPT_PERCENT,
  COVERAGE_MIN_PAGE_PERCENT,
  COVERAGE_MIN_RELATION_PERCENT,
  SATURATION_CARDS_PER_PAGE,
} from './config'
import type { Card, ConceptMap, CoverageCatalog, CoverageData } from './types'
import { relationKeyOf } from './types'

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

/**
 * Port of normalize_relation_key: split into exactly three segments on the
 * first two "|" (extra pipes stay in the target), trim each, require all
 * non-empty.
 */
const normalizeRelationKey = (value: string): string => {
  const first = value.indexOf('|')
  if (first < 0) return ''
  const second = value.indexOf('|', first + 1)
  if (second < 0) return ''
  const parts = [
    value.slice(0, first).trim(),
    value.slice(first + 1, second).trim(),
    value.slice(second + 1).trim(),
  ]
  if (parts.some((part) => part === '')) return ''
  return parts.join('|')
}

const cardRelationKeys = (card: Card): string[] =>
  card.relationKeys.map((key) => normalizeRelationKey(key)).filter((key) => key !== '')

// ---------------------------------------------------------------------------
// Catalog building (port of build_coverage_catalog)
// ---------------------------------------------------------------------------

export function buildCoverageCatalog(conceptMap: ConceptMap): EngineCoverageCatalog {
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

  return {
    conceptIds,
    highPriorityIds,
    relationKeys,
    conceptsByPage,
    pagesByConcept,
    conceptNames,
    pageCount: conceptMap.pageCount,
    relationsByPage,
  }
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
  const explicitRelationKeys = new Set<string>()
  const relationsCoveredByPage = new Set<string>()
  const cardsPerPage = new Map<number, number>()

  for (const card of cards) {
    const pages = cardPageRefs(card)
    for (const page of pages) {
      coveredPages.add(page)
      cardsPerPage.set(page, (cardsPerPage.get(page) ?? 0) + 1)
      for (const conceptId of catalog.conceptsByPage.get(page) ?? []) {
        conceptsCoveredByPage.add(conceptId)
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

  const missingHighPriority = [...catalog.highPriorityIds].filter(
    (id) => !coveredConceptUnion.has(id),
  )

  const saturatedPages = sortedNumbers(cardsPerPage.keys()).filter(
    (page) => (cardsPerPage.get(page) ?? 0) > SATURATION_CARDS_PER_PAGE,
  )

  const cardsPerPageRecord: Record<number, number> = {}
  for (const [page, count] of cardsPerPage) cardsPerPageRecord[page] = count

  const totalConcepts = catalog.conceptIds.size
  const totalRelations = catalog.relationKeys.size

  return {
    pageCount: catalog.pageCount,
    coveredPages: sortedNumbers(coveredPages),
    uncoveredPages,
    pageCoveragePercent: percent(coveredPages.size, catalog.pageCount),
    coveredConceptIds: [...explicitConceptIds].sort(),
    inferredConceptIds: [...conceptsCoveredByPage].filter((id) => !explicitConceptIds.has(id)).sort(),
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
  }
}

// ---------------------------------------------------------------------------
// Gap text (ports of build_generation_gap_text / build_reflection_gap_text)
// ---------------------------------------------------------------------------

const preview = <T>(items: readonly T[], limit: number, render: (item: T) => string): string =>
  items.slice(0, limit).map(render).join(', ') + (items.length > limit ? '...' : '')

const describeConcept = (catalog: CoverageCatalog, id: string): string => {
  const name = catalog.conceptNames.get(id)
  const pages = catalog.pagesByConcept.get(id) ?? []
  const pageText = pages.length > 0 ? pages.join(',') : '?'
  return `${name !== undefined && name !== '' ? name : id}@${pageText}`
}

interface GapSummary {
  coveredConceptCount: number
  explicitConceptCount: number
  coveredRelationCount: number
  uncoveredConceptIds: string[]
  uncoveredRelationKeys: string[]
}

const summarizeGaps = (catalog: CoverageCatalog, coverage: CoverageData): GapSummary => {
  const coveredConcepts = new Set<string>([
    ...coverage.coveredConceptIds,
    ...coverage.inferredConceptIds,
  ])
  const coveredRelations = new Set<string>(coverage.coveredRelationKeys)
  return {
    coveredConceptCount: coveredConcepts.size,
    explicitConceptCount: coverage.coveredConceptIds.length,
    coveredRelationCount: coverage.coveredRelationKeys.length,
    uncoveredConceptIds: [...catalog.conceptIds].filter((id) => !coveredConcepts.has(id)),
    uncoveredRelationKeys: [...catalog.relationKeys].filter((key) => !coveredRelations.has(key)),
  }
}

export function buildGenerationGapText(catalog: CoverageCatalog, coverage: CoverageData): string {
  const gaps = summarizeGaps(catalog, coverage)

  const lines = [
    '- COVERAGE LEDGER:',
    `  - Pages covered: ${coverage.coveredPages.length}/${catalog.pageCount}.`,
    `  - Concepts covered: ${gaps.coveredConceptCount}/${catalog.conceptIds.size} (${gaps.explicitConceptCount} explicit).`,
    `  - Relations covered: ${gaps.coveredRelationCount}/${catalog.relationKeys.size}.`,
  ]

  if (coverage.uncoveredPages.length > 0) {
    lines.push(`  - Prioritize uncovered pages: ${preview(coverage.uncoveredPages, 15, String)}`)
  }

  if (coverage.missingHighPriority.length > 0) {
    lines.push(
      `  - Missing HIGH priority concepts: ${preview(coverage.missingHighPriority, 8, (id) =>
        describeConcept(catalog, id),
      )}`,
    )
  } else if (gaps.uncoveredConceptIds.length > 0) {
    lines.push(
      `  - Remaining concepts: ${preview(gaps.uncoveredConceptIds, 8, (id) =>
        describeConcept(catalog, id),
      )}`,
    )
  }

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

export function buildReflectionGapText(catalog: CoverageCatalog, coverage: CoverageData): string {
  const gaps = summarizeGaps(catalog, coverage)
  const highPriorityTotal = catalog.highPriorityIds.size
  const highPriorityCovered = highPriorityTotal - coverage.missingHighPriority.length

  const lines = [
    'Coverage audit:',
    `- Page coverage: ${coverage.coveredPages.length}/${catalog.pageCount}.`,
    `- Concept coverage: ${gaps.coveredConceptCount}/${catalog.conceptIds.size} (${gaps.explicitConceptCount} explicit).`,
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

// ---------------------------------------------------------------------------
// Reflection card selection
// (ports of generation_utils.CardPriorityScorer / _select_best_reflection_cards)
// ---------------------------------------------------------------------------

export interface ReflectionScoringWeights {
  highPriorityConcept: number
  newConcept: number
  newRelation: number
  newPage: number
  saturationPenalty: number
}

/** Defaults from generation_utils.ReflectionScoringWeights (not in config.ts). */
export const DEFAULT_REFLECTION_WEIGHTS: ReflectionScoringWeights = {
  highPriorityConcept: 8.0,
  newConcept: 4.0,
  newRelation: 3.0,
  newPage: 1.5,
  saturationPenalty: 6.0,
}

export interface ScoringContext {
  selectedPages: ReadonlySet<number>
  selectedConcepts: ReadonlySet<string>
  selectedRelations: ReadonlySet<string>
  perPageCounts: ReadonlyMap<number, number>
  highPriorityIds: ReadonlySet<string>
}

export class CardPriorityScorer {
  private readonly weights: ReflectionScoringWeights

  constructor(weights: ReflectionScoringWeights = DEFAULT_REFLECTION_WEIGHTS) {
    this.weights = weights
  }

  score(card: Card, context: ScoringContext): number {
    const baseScore = Number.isFinite(card.qualityScore) ? card.qualityScore : 0
    const pages = new Set(cardPageRefs(card))
    const concepts = new Set(cardConceptIds(card))
    const relations = new Set(cardRelationKeys(card))

    const newPages = [...pages].filter((page) => !context.selectedPages.has(page))
    const newConcepts = [...concepts].filter((id) => !context.selectedConcepts.has(id))
    const newRelations = [...relations].filter((key) => !context.selectedRelations.has(key))
    const newHighPriority = newConcepts.filter((id) => context.highPriorityIds.has(id))

    let saturation = 0
    for (const page of pages) {
      saturation += Math.max(
        (context.perPageCounts.get(page) ?? 0) + 1 - SATURATION_CARDS_PER_PAGE,
        0,
      )
    }

    return (
      baseScore +
      newHighPriority.length * this.weights.highPriorityConcept +
      newConcepts.length * this.weights.newConcept +
      newRelations.length * this.weights.newRelation +
      newPages.length * this.weights.newPage -
      saturation * this.weights.saturationPenalty
    )
  }
}

// --- Card dedupe key (port of generation_utils.get_card_key) ----------------

const HTML_RE = /<[^>]+>/g
const WHITESPACE_RE = /\s+/g
const CLOZE_RE = /\{\{c\d+::(.*?)(?:::[^}]*)?\}\}/g
const NON_WORD_RE = /[^\w\s]/g

/** Minimal HTML entity unescape (Python uses html.unescape). */
const unescapeEntities = (value: string): string =>
  value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

const stripMarkup = (value: string): string =>
  unescapeEntities(value).replace(HTML_RE, ' ').replace(WHITESPACE_RE, ' ').trim()

const cardKey = (card: Card): string => {
  const raw = card.fields['Text'] ?? card.fields['Front'] ?? ''
  const stripped = stripMarkup(raw)
    .replace(CLOZE_RE, '$1')
    .replace(NON_WORD_RE, ' ')
  return stripped.toLowerCase().split(/\s+/).filter((token) => token !== '').join(' ')
}

/**
 * Greedy marginal-gain selection: repeatedly pick the candidate whose quality
 * plus coverage gain (new high-priority concepts, concepts, relations, pages)
 * minus page-saturation penalty is highest, until `cap` cards are chosen.
 * Falls back to the first `cap` original cards if nothing was selectable.
 */
export function selectBestReflectionCards(
  original: Card[],
  proposed: Card[],
  catalog: CoverageCatalog,
  cap: number,
): Card[] {
  const scorer = new CardPriorityScorer()
  // With zero cards, every high-priority concept is missing — the baseline
  // coverage pass in Python reduces to the catalog's high-priority set.
  const highPriorityIds = catalog.highPriorityIds

  const candidates = [...original, ...proposed].filter((card) => cardKey(card) !== '')

  const selected: Card[] = []
  const selectedKeys = new Set<string>()
  const selectedPages = new Set<number>()
  const selectedConcepts = new Set<string>()
  const selectedRelations = new Set<string>()
  const perPageCounts = new Map<number, number>()

  const remaining = [...candidates]
  while (remaining.length > 0 && selected.length < cap) {
    let bestIdx = -1
    let bestPriority = Number.NEGATIVE_INFINITY
    for (let idx = 0; idx < remaining.length; idx += 1) {
      const card = remaining[idx]
      const key = cardKey(card)
      if (key === '' || selectedKeys.has(key)) continue
      const priority = scorer.score(card, {
        selectedPages,
        selectedConcepts,
        selectedRelations,
        perPageCounts,
        highPriorityIds,
      })
      if (priority > bestPriority) {
        bestPriority = priority
        bestIdx = idx
      }
    }
    if (bestIdx < 0) break

    const [chosen] = remaining.splice(bestIdx, 1)
    selected.push(chosen)
    selectedKeys.add(cardKey(chosen))
    const pages = cardPageRefs(chosen)
    for (const page of pages) {
      selectedPages.add(page)
      perPageCounts.set(page, (perPageCounts.get(page) ?? 0) + 1)
    }
    for (const conceptId of cardConceptIds(chosen)) selectedConcepts.add(conceptId)
    for (const relationKey of cardRelationKeys(chosen)) selectedRelations.add(relationKey)
  }

  if (selected.length === 0) {
    return original.slice(0, Math.max(cap, 0))
  }
  return selected
}
