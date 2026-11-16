import { describe, expect, it } from 'vitest'
import { subdeckCount } from './subdecks.ts'

describe('subdeckCount', () => {
  it('skips a lecture without cards', () => {
    expect(subdeckCount([{ sent: 0 }, { sent: 5 }])).toBe(1)
  })

  it('counts every lecture with cards in Anki', () => {
    expect(subdeckCount([{ sent: 2 }, { sent: 3 }])).toBe(2)
  })
})
