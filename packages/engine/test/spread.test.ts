import { describe, expect, it } from 'vitest'
import { believable, spread } from '../eval/spread.ts'

describe('the spread over repeated runs', () => {
  it('gives the mean, the sample standard deviation and the range', () => {
    const s = spread([246, 264, 255])
    expect(s.mean).toBe(255)
    expect(s.sd).toBe(9)
    expect([s.min, s.max]).toEqual([246, 264])
  })

  it('refuses a single run', () => {
    expect(() => spread([250])).toThrow('at least two runs')
  })

  it('shrinks the believable difference as runs per variant grow', () => {
    expect(believable(9, 1)).toBeCloseTo(25.5, 1)
    expect(believable(9, 2)).toBe(18)
    expect(believable(9, 3)).toBeLessThan(believable(9, 2))
  })
})
