/**
 * Feedback-builder tests: the payloads sent back to the model after each tool
 * call must never silently truncate lists and must make every drop (rejects,
 * duplicates, unknown metadata) visible and actionable.
 */

import { describe, expect, it } from 'vitest'

import { buildFollowUpFeedback, buildReviewFeedback, buildSubmitFeedback } from './prompts'

const rejects = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ front: `Card ${i}`, reasons: ['missing_rationale'] }))

describe('feedback builders', () => {
  it('announces truncation instead of silently capping the rejected list', () => {
    const text = buildSubmitFeedback({
      acceptedCount: 0,
      rejected: rejects(13),
      duplicateFronts: [],
      unknownMetadataDropped: 0,
      cardsRemaining: 5,
      gapText: 'gaps',
      finishAllowed: false,
    })
    expect(text).toContain('Card 9')
    expect(text).not.toContain('Card 10')
    expect(text).toContain('…and 3 more rejected card(s) not listed.')
  })

  it('lists duplicate fronts so the model can avoid resubmitting them', () => {
    const text = buildSubmitFeedback({
      acceptedCount: 1,
      rejected: [],
      duplicateFronts: ['What is A?'],
      unknownMetadataDropped: 0,
      cardsRemaining: 5,
      gapText: 'gaps',
      finishAllowed: false,
    })
    expect(text).toContain('Duplicates dropped: 1')
    expect(text).toContain('What is A?')
    expect(text).toContain('do not resubmit')
  })

  it('reports dropped concept metadata during review like generation does', () => {
    const text = buildReviewFeedback({
      applied: ['updated c1'],
      rejected: [],
      unknownMetadataDropped: 2,
      gapText: 'gaps',
    })
    expect(text).toContain('2 concept_id/relation_key value(s)')
  })

  it('keeps the follow-up duplicate counter consistent with the listed fronts', () => {
    const text = buildFollowUpFeedback({
      acceptedCount: 0,
      rejected: [],
      duplicateFronts: ['A', 'B'],
      cardsRemaining: 10,
    })
    expect(text).toContain('Duplicates dropped: 2')
  })
})
