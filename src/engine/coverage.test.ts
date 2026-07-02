import { describe, expect, it } from 'vitest'

import {
  buildCoverageCatalog,
  buildGenerationGapText,
  buildReflectionGapText,
  computeCoverageData,
  isCoverageSufficient,
} from './coverage'
import type { Card, ConceptMap, CoverageData } from './types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeConceptMap = (overrides: Partial<ConceptMap> = {}): ConceptMap => ({
  objectives: ['Understand deep learning basics'],
  concepts: [
    {
      id: 'c1',
      name: 'Neural Network',
      importance: 'high',
      difficulty: 'foundational',
      pageReferences: [1, 2],
    },
    {
      id: 'c2',
      name: 'Backpropagation',
      importance: 'high',
      difficulty: 'intermediate',
      pageReferences: [3],
    },
    {
      id: 'c3',
      name: 'Overfitting',
      importance: 'medium',
      difficulty: 'intermediate',
      pageReferences: [4],
    },
    // Blank id — must be skipped entirely.
    {
      id: '   ',
      name: 'Ghost',
      importance: 'low',
      difficulty: 'foundational',
      pageReferences: [5],
    },
  ],
  relations: [
    { source: 'c1', type: 'uses', target: 'c2', pageReferences: [3] },
    { source: 'c2', type: 'mitigates', target: 'c3', pageReferences: [4] },
    // Empty source — invalid, must be dropped.
    { source: '', type: 'relates', target: 'c3', pageReferences: [6] },
  ],
  language: 'en',
  slideSetName: 'DL Intro',
  pageCount: 8,
  estimatedTextChars: 4000,
  documentType: 'slides',
  ...overrides,
})

const makeCard = (overrides: Partial<Card> & { uid: string }): Card => ({
  modelName: 'Basic',
  fields: { Front: `Question ${overrides.uid}?`, Back: 'Answer.' },
  sourcePages: [],
  conceptIds: [],
  relationKeys: [],
  qualityScore: 70,
  qualityIssues: [],
  ...overrides,
})

const makeCoverage = (overrides: Partial<CoverageData> = {}): CoverageData => ({
  pageCount: 10,
  coveredPages: [],
  uncoveredPages: [],
  pageCoveragePercent: 0,
  coveredConceptIds: [],
  inferredConceptIds: [],
  conceptCoveragePercent: 0,
  effectiveConceptCoveragePercent: 0,
  coveredRelationKeys: [],
  relationCoveragePercent: 100,
  missingHighPriority: [],
  saturatedPages: [],
  cardsPerPage: {},
  ...overrides,
})

// ---------------------------------------------------------------------------
// buildCoverageCatalog
// ---------------------------------------------------------------------------

describe('buildCoverageCatalog', () => {
  const catalog = buildCoverageCatalog(makeConceptMap())

  it('collects concept ids, high-priority ids and names', () => {
    expect([...catalog.conceptIds]).toEqual(['c1', 'c2', 'c3'])
    expect([...catalog.highPriorityIds]).toEqual(['c1', 'c2'])
    expect(catalog.conceptNames.get('c2')).toBe('Backpropagation')
  })

  it('indexes concepts by page and pages by concept', () => {
    expect(catalog.conceptsByPage.get(1)).toEqual(['c1'])
    expect(catalog.conceptsByPage.get(3)).toEqual(['c2'])
    expect(catalog.pagesByConcept.get('c1')).toEqual([1, 2])
  })

  it('builds relation keys and drops invalid relations', () => {
    expect([...catalog.relationKeys]).toEqual(['c1|uses|c2', 'c2|mitigates|c3'])
    expect(catalog.relationsByPage.get(3)).toEqual(['c1|uses|c2'])
    expect(catalog.relationsByPage.get(6)).toBeUndefined()
  })

  it('carries the page count', () => {
    expect(catalog.pageCount).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// computeCoverageData
// ---------------------------------------------------------------------------

describe('computeCoverageData', () => {
  const catalog = buildCoverageCatalog(makeConceptMap())

  it('returns full-gap coverage for zero cards', () => {
    const coverage = computeCoverageData(catalog, [])
    expect(coverage.coveredPages).toEqual([])
    expect(coverage.uncoveredPages).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(coverage.pageCoveragePercent).toBe(0)
    expect(coverage.missingHighPriority).toEqual(['c1', 'c2'])
    expect(coverage.relationCoveragePercent).toBe(0)
  })

  it('tracks explicit concept coverage and page coverage', () => {
    const cards = [makeCard({ uid: 'a', sourcePages: [1, 2], conceptIds: ['c1'] })]
    const coverage = computeCoverageData(catalog, cards)

    expect(coverage.coveredPages).toEqual([1, 2])
    expect(coverage.pageCoveragePercent).toBe(25) // 2/8
    expect(coverage.coveredConceptIds).toEqual(['c1'])
    expect(coverage.inferredConceptIds).toEqual([])
    expect(coverage.conceptCoveragePercent).toBe(33) // 1/3
    expect(coverage.missingHighPriority).toEqual(['c2'])
  })

  it('infers concept and relation coverage from page overlap', () => {
    const cards = [
      makeCard({ uid: 'a', sourcePages: [1], conceptIds: ['c1'] }),
      // No conceptIds claimed, but page 3 teaches c2 and relation c1|uses|c2.
      makeCard({ uid: 'b', sourcePages: [3] }),
    ]
    const coverage = computeCoverageData(catalog, cards)

    expect(coverage.coveredConceptIds).toEqual(['c1'])
    expect(coverage.inferredConceptIds).toEqual(['c2'])
    expect(coverage.conceptCoveragePercent).toBe(33) // explicit only: 1/3
    expect(coverage.effectiveConceptCoveragePercent).toBe(67) // union: 2/3
    expect(coverage.coveredRelationKeys).toEqual(['c1|uses|c2'])
    expect(coverage.relationCoveragePercent).toBe(50)
    expect(coverage.missingHighPriority).toEqual([])
  })

  it('falls back to slideNumber when sourcePages is empty', () => {
    const cards = [makeCard({ uid: 'a', sourcePages: [], slideNumber: 4 })]
    const coverage = computeCoverageData(catalog, cards)
    expect(coverage.coveredPages).toEqual([4])
    // Page 4 teaches c3 (inferred) and relation c2|mitigates|c3.
    expect(coverage.inferredConceptIds).toEqual(['c3'])
    expect(coverage.coveredRelationKeys).toEqual(['c2|mitigates|c3'])
  })

  it('normalizes page references (truncate, positive, dedupe)', () => {
    const cards = [makeCard({ uid: 'a', sourcePages: [2, 2, 0, -1, 3.7] })]
    const coverage = computeCoverageData(catalog, cards)
    expect(coverage.coveredPages).toEqual([2, 3])
    expect(coverage.cardsPerPage).toEqual({ 2: 1, 3: 1 })
  })

  it('normalizes explicit relation keys and drops malformed ones', () => {
    const cards = [
      makeCard({
        uid: 'a',
        sourcePages: [1],
        relationKeys: [' c2 | mitigates | c3 ', 'c1|uses', '||'],
      }),
    ]
    const coverage = computeCoverageData(catalog, cards)
    expect(coverage.coveredRelationKeys).toEqual(['c2|mitigates|c3'])
  })

  it('flags saturated pages above the per-page threshold', () => {
    const cards = [
      makeCard({ uid: 'a', sourcePages: [1] }),
      makeCard({ uid: 'b', sourcePages: [1] }),
      makeCard({ uid: 'c', sourcePages: [1] }),
      makeCard({ uid: 'd', sourcePages: [2] }),
    ]
    const coverage = computeCoverageData(catalog, cards)
    expect(coverage.saturatedPages).toEqual([1])
    expect(coverage.cardsPerPage).toEqual({ 1: 3, 2: 1 })
  })

  it('reports 100% relation coverage when the catalog has no relations', () => {
    const emptyRelations = buildCoverageCatalog(makeConceptMap({ relations: [] }))
    const coverage = computeCoverageData(emptyRelations, [])
    expect(coverage.relationCoveragePercent).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// isCoverageSufficient
// ---------------------------------------------------------------------------

describe('isCoverageSufficient', () => {
  it('fails while any high-priority concept is missing', () => {
    const coverage = makeCoverage({
      missingHighPriority: ['c2'],
      conceptCoveragePercent: 90,
      pageCoveragePercent: 90,
      relationCoveragePercent: 90,
    })
    expect(isCoverageSufficient(coverage)).toBe(false)
  })

  it('fails when relation coverage is below 50%', () => {
    const coverage = makeCoverage({
      relationCoveragePercent: 40,
      conceptCoveragePercent: 80,
      pageCoveragePercent: 80,
    })
    expect(isCoverageSufficient(coverage)).toBe(false)
  })

  it('passes at concept >= 60% with relations >= 50%', () => {
    const coverage = makeCoverage({
      relationCoveragePercent: 50,
      conceptCoveragePercent: 60,
      pageCoveragePercent: 10,
    })
    expect(isCoverageSufficient(coverage)).toBe(true)
  })

  it('passes via page coverage >= 75% even with low explicit concept coverage', () => {
    const coverage = makeCoverage({
      relationCoveragePercent: 55,
      conceptCoveragePercent: 30,
      pageCoveragePercent: 75,
    })
    expect(isCoverageSufficient(coverage)).toBe(true)
  })

  it('fails when both concept and page coverage are below their thresholds', () => {
    const coverage = makeCoverage({
      relationCoveragePercent: 100,
      conceptCoveragePercent: 59,
      pageCoveragePercent: 74,
    })
    expect(isCoverageSufficient(coverage)).toBe(false)
  })

  it('treats a relation-free catalog (100%) as satisfying the relation gate', () => {
    const coverage = makeCoverage({
      relationCoveragePercent: 100, // computeCoverageData emits 100 when no relations exist
      conceptCoveragePercent: 60,
    })
    expect(isCoverageSufficient(coverage)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Gap text
// ---------------------------------------------------------------------------

describe('buildGenerationGapText', () => {
  const catalog = buildCoverageCatalog(makeConceptMap())

  it('renders the ledger with missing high-priority concept names and gaps', () => {
    const cards = [makeCard({ uid: 'a', sourcePages: [1, 2], conceptIds: ['c1'] })]
    const coverage = computeCoverageData(catalog, cards)
    const text = buildGenerationGapText(catalog, coverage)

    expect(text).toContain('- COVERAGE LEDGER:')
    expect(text).toContain('Pages covered: 2/8.')
    expect(text).toContain('Concepts covered: 1/3 (1 explicit).')
    expect(text).toContain('Relations covered: 0/2.')
    expect(text).toContain('Prioritize uncovered pages: 3, 4, 5, 6, 7, 8')
    expect(text).toContain('Missing HIGH priority concepts: Backpropagation@3')
    expect(text).toContain('Missing relations: c1|uses|c2, c2|mitigates|c3')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('falls back to remaining concepts once all high-priority ones are covered', () => {
    const cards = [
      makeCard({ uid: 'a', sourcePages: [1], conceptIds: ['c1'] }),
      makeCard({ uid: 'b', sourcePages: [3], conceptIds: ['c2'] }),
    ]
    const coverage = computeCoverageData(catalog, cards)
    const text = buildGenerationGapText(catalog, coverage)

    expect(text).not.toContain('Missing HIGH priority concepts')
    expect(text).toContain('Remaining concepts: Overfitting@4')
  })

  it('lists saturated pages to deprioritize', () => {
    const cards = [
      makeCard({ uid: 'a', sourcePages: [1] }),
      makeCard({ uid: 'b', sourcePages: [1] }),
      makeCard({ uid: 'c', sourcePages: [1] }),
    ]
    const coverage = computeCoverageData(catalog, cards)
    expect(buildGenerationGapText(catalog, coverage)).toContain(
      'Over-covered pages to deprioritize: 1',
    )
  })

  it('truncates long uncovered-page lists with an ellipsis', () => {
    const bigCatalog = buildCoverageCatalog(makeConceptMap({ pageCount: 40 }))
    const coverage = computeCoverageData(bigCatalog, [])
    const text = buildGenerationGapText(bigCatalog, coverage)
    expect(text).toContain(
      'Prioritize uncovered pages: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15...',
    )
  })
})

describe('buildReflectionGapText', () => {
  const catalog = buildCoverageCatalog(makeConceptMap())

  it('renders the audit with high-priority tally and missing names', () => {
    const cards = [makeCard({ uid: 'a', sourcePages: [1, 2], conceptIds: ['c1'] })]
    const coverage = computeCoverageData(catalog, cards)
    const text = buildReflectionGapText(catalog, coverage)

    expect(text).toContain('Coverage audit:')
    expect(text).toContain('Page coverage: 2/8.')
    expect(text).toContain('High-priority concept coverage: 1/2.')
    expect(text).toContain('Missing high-priority concepts: Backpropagation')
    expect(text).toContain('Missing relations: c1|uses|c2, c2|mitigates|c3')
    expect(text.endsWith('\n')).toBe(false)
  })

  it('omits gap lines when coverage is complete', () => {
    const cards = [
      makeCard({ uid: 'a', sourcePages: [1, 2, 5, 6, 7, 8], conceptIds: ['c1'] }),
      makeCard({
        uid: 'b',
        sourcePages: [3, 4],
        conceptIds: ['c2', 'c3'],
        relationKeys: ['c1|uses|c2', 'c2|mitigates|c3'],
      }),
    ]
    const coverage = computeCoverageData(catalog, cards)
    const text = buildReflectionGapText(catalog, coverage)

    expect(text).not.toContain('Uncovered pages')
    expect(text).not.toContain('Missing high-priority concepts')
    expect(text).not.toContain('Missing relations')
  })
})
