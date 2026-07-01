import { describe, expect, it } from 'vitest'

import {
  DYNAMIC_MAX_NOTES_PER_BATCH,
  DYNAMIC_MIN_NOTES_PER_BATCH,
} from './config'
import { buildPacingHint, computeSizingPlan, detectContentMode } from './pacing'
import type { CoverageData, PdfInfo, SizingPlan } from './types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const pdf = (pageCount: number, textChars: number, imageCount = 0): PdfInfo => ({
  pageCount,
  textChars,
  imageCount,
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

const sizing = (totalCardCap: number): SizingPlan => ({
  contentMode: 'slides',
  totalCardCap,
  batchSize: 10,
})

// ---------------------------------------------------------------------------
// detectContentMode
// ---------------------------------------------------------------------------

describe('detectContentMode', () => {
  it('detects sparse slide decks', () => {
    expect(detectContentMode(pdf(40, 20000))).toBe('slides') // 500 chars/page
  })

  it('detects dense scripts', () => {
    expect(detectContentMode(pdf(10, 30000))).toBe('script') // 3000 chars/page
  })

  it('treats exactly the density threshold as script', () => {
    expect(detectContentMode(pdf(10, 15000))).toBe('script') // 1500 chars/page
  })

  it('treats a zero-page document as slides', () => {
    expect(detectContentMode(pdf(0, 5000))).toBe('slides')
  })
})

// ---------------------------------------------------------------------------
// computeSizingPlan
// ---------------------------------------------------------------------------

describe('computeSizingPlan', () => {
  it('sizes slide decks from the page count', () => {
    const plan = computeSizingPlan(pdf(40, 20000))
    expect(plan.contentMode).toBe('slides')
    expect(plan.totalCardCap).toBe(24) // round(40 * 0.6)
  })

  it('enforces the minimum deck size for tiny slide decks', () => {
    const plan = computeSizingPlan(pdf(4, 400))
    expect(plan.totalCardCap).toBe(3) // max(MIN_TOTAL_CARDS, round(4 * 0.6) = 2)
  })

  it('sizes scripts from text volume plus weighted images', () => {
    const plan = computeSizingPlan(pdf(20, 60000, 10)) // 3000 chars/page -> script
    expect(plan.contentMode).toBe('script')
    expect(plan.totalCardCap).toBe(65) // round(60000/1000 + 10*0.5)
  })

  it('honors the user target override', () => {
    const plan = computeSizingPlan(pdf(40, 20000), { userTargetCards: 50 })
    expect(plan.totalCardCap).toBe(50)
    expect(computeSizingPlan(pdf(40, 20000), { userTargetCards: 0 }).totalCardCap).toBe(1)
  })

  it('honors forceMode over the density heuristic', () => {
    const plan = computeSizingPlan(pdf(10, 30000), { forceMode: 'slides' })
    expect(plan.contentMode).toBe('slides')
    expect(plan.totalCardCap).toBe(6) // round(10 * 0.6), not the script formula
  })

  describe('hybrid batch size', () => {
    it('lets the page guardrail lift a small target-derived batch', () => {
      // cap 24 -> target round(24*0.15)=4; pageCenter 20 -> guardrail [14..26];
      // hybrid 14, inside [10..25].
      expect(computeSizingPlan(pdf(40, 20000)).batchSize).toBe(14)
    })

    it('keeps a target batch that already sits inside the guardrail', () => {
      // script cap 65 -> target 10; pageCenter 10 -> guardrail [8..13] -> 10.
      expect(computeSizingPlan(pdf(20, 60000, 10)).batchSize).toBe(10)
    })

    it('clamps up to the dynamic minimum for tiny documents', () => {
      // cap 3 -> target 0; pageCenter 2 -> guardrail [8..8] (floor 8) -> 8;
      // final clamp lifts to DYNAMIC_MIN.
      expect(computeSizingPlan(pdf(4, 400)).batchSize).toBe(DYNAMIC_MIN_NOTES_PER_BATCH)
    })

    it('clamps down to the dynamic maximum for huge documents', () => {
      // cap 300 -> target 45; pageCenter 50 -> guardrail [35..65] -> 45;
      // final clamp caps at DYNAMIC_MAX.
      expect(computeSizingPlan(pdf(100, 300000)).batchSize).toBe(DYNAMIC_MAX_NOTES_PER_BATCH)
    })
  })
})

// ---------------------------------------------------------------------------
// buildPacingHint
// ---------------------------------------------------------------------------

describe('buildPacingHint', () => {
  it('stays silent before any page is covered', () => {
    expect(buildPacingHint(makeCoverage(), sizing(12), 6)).toBe('')
  })

  it('stays silent during warm-up (fewer than 5 cards)', () => {
    const coverage = makeCoverage({ coveredPages: [1, 2] })
    expect(buildPacingHint(coverage, sizing(12), 4)).toBe('')
  })

  it('reports progress, untouched pages, and density vs target', () => {
    const coverage = makeCoverage({ pageCount: 10, coveredPages: [1, 2, 3, 4] })
    const hint = buildPacingHint(coverage, sizing(12), 6)

    expect(hint).toContain('- CURRENT PROGRESS: 4 covered slides out of 10.')
    expect(hint).toContain('- UNTOUCHED SLIDES: 6.')
    expect(hint).toContain('- GENERATION DENSITY: 6 cards for 4 covered slides (~1.5 per covered slide).')
    expect(hint).toContain('- TARGET GOAL: ~1.2 cards per slide while spreading coverage across the deck.')
  })

  it('never reports negative untouched pages', () => {
    const coverage = makeCoverage({ pageCount: 3, coveredPages: [1, 2, 3, 4, 5] })
    const hint = buildPacingHint(coverage, sizing(12), 8)
    expect(hint).toContain('- UNTOUCHED SLIDES: 0.')
  })
})
