import { describe, expect, it } from 'vitest'
import { miniStops } from './Courses.tsx'

describe('miniStops', () => {
  it('shows every lecture of a course that fits in three rows', () => {
    expect(miniStops(1)).toEqual({ perRow: 1, shown: 1, rest: 0 })
    expect(miniStops(5)).toEqual({ perRow: 5, shown: 5, rest: 0 })
    expect(miniStops(12)).toEqual({ perRow: 4, shown: 12, rest: 0 })
    expect(miniStops(24)).toEqual({ perRow: 8, shown: 24, rest: 0 })
  })

  it('ends a longer course in one stop that counts the rest', () => {
    expect(miniStops(30)).toEqual({ perRow: 8, shown: 23, rest: 7 })
    expect(miniStops(60)).toEqual({ perRow: 8, shown: 23, rest: 37 })
  })
})
