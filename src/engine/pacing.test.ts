import { describe, expect, it } from 'vitest'

import { DYNAMIC_MAX_NOTES_PER_BATCH, DYNAMIC_MIN_NOTES_PER_BATCH } from './config'
import { computeSizingPlan, detectContentMode } from './pacing'
import type { PdfInfo } from './types'

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

  describe('batch size', () => {
    it('derives the batch from the cap', () => {
      // script cap 100 -> round(100 * 0.15) = 15
      expect(computeSizingPlan(pdf(20, 100000)).batchSize).toBe(15)
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
