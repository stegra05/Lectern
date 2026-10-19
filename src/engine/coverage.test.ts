import { describe, expect, it } from 'vitest'

import {
  budgetShortfall,
  buildCoverageCatalog,
  buildFacetCatalogText,
  buildGenerationGapText,
  buildReflectionGapText,
  computeCoverageData,
  conceptsWithUntestedFacets,
  isCoverageSufficient,
  repeatsTestedFacets,
} from './coverage'
import type { Card, ConceptMap, CoverageData } from './types'
import { facetIdOf } from './types'

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
      facets: [],
    },
    {
      id: 'c2',
      name: 'Backpropagation',
      importance: 'high',
      difficulty: 'intermediate',
      pageReferences: [3],
      facets: [],
    },
    {
      id: 'c3',
      name: 'Overfitting',
      importance: 'medium',
      difficulty: 'intermediate',
      pageReferences: [4],
      facets: [],
    },
    // Blank id — must be skipped entirely.
    {
      id: '   ',
      name: 'Ghost',
      importance: 'low',
      difficulty: 'foundational',
      pageReferences: [5],
      facets: [],
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
  facetIds: [],
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
  cardsByConcept: {},
  underBudget: [],
  cardsByFacet: {},
  untestedFacets: [],
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
    // Page overlap alone does not discharge a high-importance concept: a card
    // that happens to cite page 3 is not evidence that it teaches c2.
    expect(coverage.missingHighPriority).toEqual(['c2'])
  })

  it('lets an inherited card discharge a high-importance concept by page', () => {
    // A card read back out of Anki has no concept ids to give — a re-run
    // builds a fresh map — so its pages have to speak for it.
    const cards = [
      makeCard({ uid: 'a', sourcePages: [1], conceptIds: ['c1'] }),
      makeCard({ uid: 'b', sourcePages: [3], fromAnki: true }),
    ]
    const coverage = computeCoverageData(catalog, cards)

    expect(coverage.coveredConceptIds).toEqual(['c1'])
    expect(coverage.inferredConceptIds).toEqual(['c2'])
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
// Facets
// ---------------------------------------------------------------------------

/** c1 has three facets, c2 one, c3 two; budgets follow (standard depth). */
const facetedMap = (): ConceptMap => {
  const facets: Record<string, string[]> = {
    c1: ['layers of units', 'weights, biases', 'universal approximation'],
    c2: ['chain rule backwards'],
    c3: ['train vs test gap', 'regularization fixes'],
  }
  const base = makeConceptMap()
  return {
    ...base,
    concepts: base.concepts.map((c) => ({
      ...c,
      facets: facets[c.id] ?? [],
      cardBudget: Math.max(1, (facets[c.id] ?? []).length),
    })),
  }
}

describe('facet ids', () => {
  const catalog = buildCoverageCatalog(facetedMap())

  it("numbers a concept's facets from 1", () => {
    expect(facetIdOf('c-a', 0)).toBe('c-a#1')
    expect(facetIdOf('c-a', 1)).toBe('c-a#2')
  })

  it('indexes every facet by id, and none for a concept without an id', () => {
    expect([...catalog.facets.keys()]).toEqual(['c1#1', 'c1#2', 'c1#3', 'c2#1', 'c3#1', 'c3#2'])
    expect(catalog.facets.get('c3#2')).toEqual({ conceptId: 'c3', label: 'regularization fixes' })
  })

  it('renders the catalog the model tags its cards from', () => {
    expect(buildFacetCatalogText(catalog)).toBe(
      'c1 Neural Network: #1 layers of units; #2 weights, biases; #3 universal approximation\n' +
        'c2 Backpropagation: #1 chain rule backwards\n' +
        'c3 Overfitting: #1 train vs test gap; #2 regularization fixes',
    )
  })
})

describe('the facet ledger', () => {
  const catalog = buildCoverageCatalog(facetedMap())

  it('counts the cards that declare each facet, once per card', () => {
    const coverage = computeCoverageData(catalog, [
      makeCard({ uid: 'a', conceptIds: ['c1'], facetIds: ['c1#1', 'c1#1'] }),
      makeCard({ uid: 'b', conceptIds: ['c1', 'c3'], facetIds: ['c1#1', 'c3#2', 'c9#1'] }),
    ])
    expect(coverage.cardsByFacet).toEqual({ 'c1#1': 2, 'c3#2': 1 })
  })

  it('lists the untested facets of short concepts, no-card concepts first', () => {
    const coverage = computeCoverageData(catalog, [
      makeCard({ uid: 'a', conceptIds: ['c1'], facetIds: ['c1#2'] }),
    ])
    // c2 and c3 have no card yet (high importance first), then c1.
    expect(coverage.underBudget).toEqual(['c2', 'c3', 'c1'])
    expect(coverage.untestedFacets).toEqual(['c2#1', 'c3#1', 'c3#2', 'c1#1', 'c1#3'])
  })

  it("drops a concept's facets once it meets its budget", () => {
    const coverage = computeCoverageData(catalog, [
      makeCard({ uid: 'a', conceptIds: ['c3'], facetIds: ['c3#1'] }),
      makeCard({ uid: 'b', conceptIds: ['c3'] }),
    ])
    expect(coverage.untestedFacets).not.toContain('c3#2')
  })

  it('never attributes an inherited card to a facet', () => {
    // Page 3 carries only c2, whose single card it is: c2 is satisfied and
    // shows no facets. Page 4 gives c3 one of two cards, but which facet the
    // card tests is unknown, so both stay listed.
    const coverage = computeCoverageData(catalog, [
      makeCard({ uid: 'x', sourcePages: [3], fromAnki: true, facetIds: ['c2#1'] }),
      makeCard({ uid: 'y', sourcePages: [4], fromAnki: true }),
    ])
    expect(coverage.cardsByFacet).toEqual({})
    expect(coverage.cardsByConcept).toMatchObject({ c2: 1, c3: 1 })
    expect(coverage.untestedFacets).not.toContain('c2#1')
    expect(coverage.untestedFacets).toEqual(expect.arrayContaining(['c3#1', 'c3#2']))
  })
})

describe('repeatsTestedFacets', () => {
  const deck = [
    makeCard({ uid: 'a', facetIds: ['c1#1'] }),
    makeCard({ uid: 'b', facetIds: ['c1#2'] }),
  ]

  it('rejects a card whose every facet already has its card', () => {
    expect(repeatsTestedFacets(['c1#1'], deck, 1)).toBe(true)
    expect(repeatsTestedFacets(['c1#1', 'c1#2'], deck, 1)).toBe(true)
  })

  it('lets a card through when one of its facets is still open', () => {
    expect(repeatsTestedFacets(['c1#1', 'c1#3'], deck, 1)).toBe(false)
  })

  it('allows a second card per facet at thorough depth, not a third', () => {
    expect(repeatsTestedFacets(['c1#1'], deck, 2)).toBe(false)
    const twice = [...deck, makeCard({ uid: 'c', facetIds: ['c1#1'] })]
    expect(repeatsTestedFacets(['c1#1'], twice, 2)).toBe(true)
  })

  it('does not count the card being replaced against itself', () => {
    const others = deck.filter((card) => card.uid !== 'a')
    expect(repeatsTestedFacets(['c1#1'], others, 1)).toBe(false)
  })

  it('never rejects a card that names no facet', () => {
    expect(repeatsTestedFacets([], deck, 1)).toBe(false)
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
    expect(text).toContain('Concepts a card names: 1/3.')
    expect(text).toContain('Relations covered: 0/2.')
    expect(text).toContain('Prioritize uncovered pages: 3, 4, 5, 6, 7, 8')
    expect(text).toContain('Missing HIGH priority concepts: Backpropagation@3')
    expect(text).toContain('Missing relations: c1|uses|c2, c2|mitigates|c3')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('lists the concepts without a card once high-priority ones are covered', () => {
    const cards = [
      makeCard({ uid: 'a', sourcePages: [1], conceptIds: ['c1'] }),
      makeCard({ uid: 'b', sourcePages: [3], conceptIds: ['c2'] }),
    ]
    const coverage = computeCoverageData(catalog, cards)
    const text = buildGenerationGapText(catalog, coverage)

    expect(text).not.toContain('Missing HIGH priority concepts')
    expect(text).toContain('Concepts with no card yet (cover these first): Overfitting@4')
  })

  it('counts cards per concept and puts concepts without a card first', () => {
    const budgeted = buildCoverageCatalog(
      makeConceptMap(),
      undefined,
      new Map([
        ['c1', 3],
        ['c2', 1],
        ['c3', 2],
      ]),
    )
    const coverage = computeCoverageData(budgeted, [
      makeCard({ uid: 'a', sourcePages: [1], conceptIds: ['c1'] }),
      makeCard({ uid: 'b', sourcePages: [3], conceptIds: ['c2'] }),
    ])
    expect(coverage.cardsByConcept).toEqual({ c1: 1, c2: 1 })
    // c3 has none, c1 has one of three: breadth before depth.
    expect(coverage.underBudget).toEqual(['c3', 'c1'])
    expect(budgetShortfall(budgeted, coverage)).toBe(4)
  })

  it('opens depth slots past the facets only once every facet has its card', () => {
    const map = makeConceptMap()
    map.concepts[0].facets = ['what a network computes']
    // Thorough: one facet, two cards.
    const thorough = buildCoverageCatalog(
      map,
      undefined,
      new Map([
        ['c1', 2],
        ['c2', 1],
        ['c3', 1],
      ]),
    )
    const c1 = makeCard({ uid: 'a', sourcePages: [1], conceptIds: ['c1'], facetIds: ['c1#1'] })
    const c2 = makeCard({ uid: 'b', sourcePages: [3], conceptIds: ['c2'] })
    const c3 = makeCard({ uid: 'c', sourcePages: [4], conceptIds: ['c3'] })

    const breadth = computeCoverageData(thorough, [c1, c2])
    expect(conceptsWithUntestedFacets(thorough, breadth)).toEqual(['c3'])
    expect(buildGenerationGapText(thorough, breadth)).not.toContain('Room for depth')

    const full = computeCoverageData(thorough, [c1, c2, c3])
    expect(conceptsWithUntestedFacets(thorough, full)).toEqual([])
    const text = buildGenerationGapText(thorough, full)
    expect(text).not.toContain('facets still untested')
    expect(text).toContain('Room for depth')
    expect(text).toContain('Neural Network@1,2 (1/2 cards)')
  })

  it('credits a card read back from Anki to the concepts on its pages', () => {
    const coverage = computeCoverageData(catalog, [
      makeCard({ uid: 'x', sourcePages: [1], conceptIds: [], fromAnki: true }),
    ])
    expect(coverage.cardsByConcept.c1).toBe(1)
  })

  it('names the untested facets by id and label, no-card concepts first', () => {
    const faceted = buildCoverageCatalog(facetedMap())
    const coverage = computeCoverageData(faceted, [
      makeCard({ uid: 'a', sourcePages: [1], conceptIds: ['c1'], facetIds: ['c1#2'] }),
    ])
    const text = buildGenerationGapText(faceted, coverage)

    expect(text).toContain(
      'Concepts with no card yet (cover these first): Backpropagation@3 (0/1 cards), Overfitting@4 (0/2 cards)',
    )
    expect(text).toContain(
      'Facets no card tests yet (one card each, tagged with its facet id): ' +
        'c2#1 chain rule backwards; c3#1 train vs test gap; c3#2 regularization fixes; ' +
        'c1#1 layers of units; c1#3 universal approximation',
    )
    expect(text).not.toContain('weights, biases')
  })

  it('names a concept whose budget outruns its facets once each facet has a card', () => {
    // Thorough depth: c2's one facet earns it two cards.
    const thorough = buildCoverageCatalog(
      facetedMap(),
      undefined,
      new Map([
        ['c1', 0],
        ['c2', 2],
        ['c3', 0],
      ]),
    )
    const coverage = computeCoverageData(thorough, [
      makeCard({ uid: 'a', sourcePages: [3], conceptIds: ['c2'], facetIds: ['c2#1'] }),
    ])
    const text = buildGenerationGapText(thorough, coverage)
    expect(text).not.toContain('Facets no card tests yet')
    expect(text).toContain('Room for depth')
    expect(text).toContain('Backpropagation@3 (1/2 cards)')
  })

  it('keeps a long facet list bounded', () => {
    const many = makeConceptMap({
      concepts: Array.from({ length: 6 }, (_, i) => ({
        id: `k${i}`,
        name: `Concept ${i}`,
        importance: 'medium' as const,
        difficulty: 'foundational' as const,
        pageReferences: [1],
        facets: ['one', 'two', 'three'],
        cardBudget: 3,
      })),
    })
    const catalog = buildCoverageCatalog(many)
    const text = buildGenerationGapText(catalog, computeCoverageData(catalog, []))
    expect(text).toContain('k3#3 three...')
    expect(text).not.toContain('k4#1')
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

  it('names untested facets as add_cards targets', () => {
    const faceted = buildCoverageCatalog(facetedMap())
    const coverage = computeCoverageData(faceted, [
      makeCard({ uid: 'a', sourcePages: [1], conceptIds: ['c1'], facetIds: ['c1#1'] }),
    ])
    const text = buildReflectionGapText(faceted, coverage)
    expect(text).toContain('Concepts with no card: Backpropagation@3 (0/1 cards)')
    expect(text).toContain(
      'Facets no card tests yet (add_cards targets): c2#1 chain rule backwards; c3#1 train vs test gap',
    )
    expect(text).not.toContain('c1#1')
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
