import { describe, expect, it, vi } from 'vitest'
import { buildCoverageCatalog, computeCoverageData } from './coverage'
import { evaluateCard } from './quality'
import type { Card, ConceptMap } from './types'
import { useLectern } from '../state/store'

// The store is written for the browser: it imports pdf.js (which needs canvas
// APIs to load) and touches `window` at module level and for its timers.
vi.mock('./pdf', () => ({}))
vi.hoisted(() => {
  ;(globalThis as Record<string, unknown>).window ??= globalThis
})

const makeConceptMap = (): ConceptMap => ({
  objectives: ['Learn ML'],
  concepts: [
    {
      id: 'c1',
      name: 'Loss Function',
      importance: 'high',
      difficulty: 'foundational',
      pageReferences: [1],
    },
    {
      id: 'c2',
      name: 'Gradient Descent',
      importance: 'high',
      difficulty: 'intermediate',
      pageReferences: [2],
    },
  ],
  relations: [{ source: 'c1', type: 'optimized_by', target: 'c2', pageReferences: [2] }],
  language: 'en',
  slideSetName: 'Optimization',
  pageCount: 5,
  estimatedTextChars: 2000,
  documentType: 'slides',
})

describe('manual card authoring', () => {
  it('evaluates a manual basic card without requiring provenance', () => {
    const card: Card = {
      uid: 'manual-1',
      modelName: 'Basic',
      fields: {
        Front: 'What is gradient descent?',
        Back: 'An iterative optimization algorithm for finding a local minimum of a differentiable function.',
      },
      sourcePages: [2],
      conceptIds: [],
      relationKeys: [],
      qualityScore: 100,
      qualityIssues: [],
      manual: true,
    }

    const verdict = evaluateCard(card, {
      pageCount: 5,
      provenanceOptional: true,
    })

    expect(verdict.pass).toBe(true)
    expect(verdict.score).toBe(100)
    expect(verdict.issues).not.toContain('missing_concept_ids')
  })

  it('evaluates a manual cloze card with valid deletion', () => {
    const card: Card = {
      uid: 'manual-2',
      modelName: 'Cloze',
      fields: {
        Text: 'The {{c1::learning rate}} controls step size during gradient descent.',
        'Back Extra': 'A rate too large may cause divergence.',
      },
      sourcePages: [2],
      conceptIds: ['c2'],
      relationKeys: [],
      qualityScore: 100,
      qualityIssues: [],
      manual: true,
    }

    const verdict = evaluateCard(card, {
      pageCount: 5,
      provenanceOptional: true,
    })

    expect(verdict.pass).toBe(true)
    expect(verdict.score).toBe(100)
    expect(verdict.issues).toEqual([])
  })

  it('updates coverage metrics when a manual card links to a concept', () => {
    const conceptMap = makeConceptMap()
    const catalog = buildCoverageCatalog(conceptMap)

    // Initial coverage with zero cards
    const initialCoverage = computeCoverageData(catalog, [])
    expect(initialCoverage.coveredConceptIds).toEqual([])
    expect(initialCoverage.conceptCoveragePercent).toBe(0)

    // Add manual card claiming c1
    const manualCard: Card = {
      uid: 'manual-card-1',
      modelName: 'Basic',
      fields: {
        Front: 'What does a loss function quantify?',
        Back: 'The difference between predicted and actual outcomes.',
      },
      sourcePages: [1],
      conceptIds: ['c1'],
      relationKeys: [],
      qualityScore: 100,
      qualityIssues: [],
      manual: true,
    }

    const updatedCoverage = computeCoverageData(catalog, [manualCard])
    expect(updatedCoverage.coveredConceptIds).toContain('c1')
    expect(updatedCoverage.coveredPages).toContain(1)
    expect(updatedCoverage.cardsPerPage[1]).toBe(1)
    expect(updatedCoverage.effectiveConceptCoveragePercent).toBeGreaterThan(0)
  })

  it('slots a manual card in after the last card from its slide, keeping the rest in order', () => {
    const generated = (uid: string, sourcePages: number[]): Card => ({
      uid,
      modelName: 'Basic',
      fields: { Front: `Q ${uid}`, Back: `A ${uid}` },
      sourcePages,
      conceptIds: [],
      relationKeys: [],
      qualityScore: 100,
      qualityIssues: [],
    })
    // Generated cards arrive out of slide order; adding one must not re-sort them.
    useLectern.setState({
      cards: [generated('p2', [2]), generated('p5', [5]), generated('p3', [3])],
    })

    const uid = useLectern.getState().addCard({
      modelName: 'Basic',
      fields: { Front: 'What is on slide 4?', Back: 'The manual answer.' },
      sourcePages: [4],
    })

    const { cards, selectedUid } = useLectern.getState()
    expect(cards.map((c) => c.uid)).toEqual(['p2', 'p5', 'p3', uid])
    expect(cards.at(-1)?.manual).toBe(true)
    expect(selectedUid).toBe(uid)

    const early = useLectern.getState().addCard({
      modelName: 'Basic',
      fields: { Front: 'What is on slide 1?', Back: 'The first answer.' },
      sourcePages: [1],
    })
    expect(useLectern.getState().cards[0].uid).toBe(early)
  })

  it("opens the slides without the previous lecture's deck", () => {
    useLectern.setState({
      cards: [
        {
          uid: 'old',
          modelName: 'Basic',
          fields: { Front: 'Q', Back: 'A' },
          sourcePages: [1],
          conceptIds: [],
          relationKeys: [],
          qualityScore: 100,
          qualityIssues: [],
        },
      ],
      conceptMap: makeConceptMap(),
      logs: [{ level: 'info', message: 'from the last run', at: 0 }],
      selectedUid: 'old',
      pageFilter: 1,
    })

    useLectern.getState().openPdfViewer()

    const s = useLectern.getState()
    expect(s.view).toBe('session')
    expect(s.cards).toEqual([])
    expect(s.conceptMap).toBeNull()
    expect(s.logs).toEqual([])
    expect(s.selectedUid).toBeNull()
    expect(s.pageFilter).toBeNull()
    expect(s.slidePeek).toBe(1)
  })
})
