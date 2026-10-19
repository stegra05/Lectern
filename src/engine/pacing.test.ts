import { describe, expect, it } from 'vitest'

import { DYNAMIC_MAX_NOTES_PER_BATCH, DYNAMIC_MIN_NOTES_PER_BATCH } from './config'
import {
  allocateBudgets,
  computeSizingPlan,
  conceptTarget,
  deckBounds,
  detectContentMode,
} from './pacing'
import type { ConceptMap, PdfInfo } from './types'

const pdf = (pageCount: number, textChars: number, imageCount = 0): PdfInfo => ({
  pageCount,
  textChars,
  imageCount,
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
    expect(plan.totalCardCap).toBe(155) // round(60000/400 + 10*0.5)
  })

  it('takes the concept budgets once the map exists, within the guardrails', () => {
    // 40 slides → 24 expected → budgets may land between 12 and 48.
    expect(computeSizingPlan(pdf(40, 20000), { budgetSum: 30 }).totalCardCap).toBe(30)
    expect(computeSizingPlan(pdf(40, 20000), { budgetSum: 5 }).totalCardCap).toBe(12)
    expect(computeSizingPlan(pdf(40, 20000), { budgetSum: 500 }).totalCardCap).toBe(48)
  })

  it('scales the deck and its guardrails with the density', () => {
    expect(computeSizingPlan(pdf(40, 20000), { density: 'overview' }).totalCardCap).toBe(12)
    expect(computeSizingPlan(pdf(40, 20000), { density: 'thorough' }).totalCardCap).toBe(36)
    expect(deckBounds(pdf(40, 20000), 'thorough')).toEqual({ min: 18, max: 72 })
  })

  it('lets an extend run go as low as what the deck lacks', () => {
    expect(computeSizingPlan(pdf(40, 20000), { budgetSum: 4, extending: true }).totalCardCap).toBe(
      4,
    )
    expect(computeSizingPlan(pdf(40, 20000), { budgetSum: 0, extending: true }).totalCardCap).toBe(
      1,
    )
  })

  it('honors forceMode over the density heuristic', () => {
    const plan = computeSizingPlan(pdf(10, 30000), { forceMode: 'slides' })
    expect(plan.contentMode).toBe('slides')
    expect(plan.totalCardCap).toBe(6) // round(10 * 0.6), not the script formula
  })

  describe('batch size', () => {
    it('derives the batch from the cap', () => {
      // script cap 100 -> round(100 * 0.15) = 15
      expect(computeSizingPlan(pdf(20, 40000)).batchSize).toBe(15)
    })

    it('clamps up to the minimum for small decks', () => {
      // cap 24 -> target 4 -> clamped to DYNAMIC_MIN
      expect(computeSizingPlan(pdf(40, 20000)).batchSize).toBe(DYNAMIC_MIN_NOTES_PER_BATCH)
    })

    it('clamps down to the maximum for huge decks', () => {
      // cap 300 -> target 45 -> clamped to DYNAMIC_MAX
      expect(computeSizingPlan(pdf(100, 300000)).batchSize).toBe(DYNAMIC_MAX_NOTES_PER_BATCH)
    })
  })
})

describe('conceptTarget', () => {
  it('follows the slides that earn a card', () => {
    // 72 slides → about 43 → 26 to 40 concepts.
    expect(conceptTarget({ pageCount: 72, textChars: 29_000, imageCount: 0 })).toEqual({
      min: 26,
      max: 40,
    })
  })

  it('gives a short dense script concepts by its text, not by its page count', () => {
    // 3 pages, 4975 chars → about 17 → 10 to 17 concepts.
    expect(conceptTarget({ pageCount: 3, textChars: 4_975, imageCount: 0 })).toEqual({
      min: 10,
      max: 17,
    })
  })

  it('stays within the floor and ceiling', () => {
    expect(conceptTarget({ pageCount: 400, textChars: 100_000, imageCount: 0 }).max).toBe(40)
    expect(conceptTarget({ pageCount: 1, textChars: 100, imageCount: 0 }).min).toBe(6)
  })
})

describe('allocateBudgets', () => {
  const map = {
    concepts: [
      { id: 'a', importance: 'high', cardBudget: 3 },
      { id: 'b', importance: 'medium', cardBudget: 1 },
      { id: 'c', importance: 'low', cardBudget: 2 },
    ],
  } as unknown as ConceptMap

  it('keeps the map’s budgets at standard depth', () => {
    expect([...allocateBudgets(map, 'standard').values()]).toEqual([3, 1, 2])
  })

  it('drops low-importance concepts and halves the rest for an overview', () => {
    expect([...allocateBudgets(map, 'overview').values()]).toEqual([2, 1, 0])
  })

  it('goes half again deeper when thorough', () => {
    expect([...allocateBudgets(map, 'thorough').values()]).toEqual([5, 2, 3])
  })
})
