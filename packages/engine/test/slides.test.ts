import { describe, expect, it } from 'vitest'
import { withoutFurniture } from '../src/slides.ts'

const footer = (page: number) =>
  `Alexy | Entrepreneurship in a Digital Age | Session 7 ${page}21/12/26`

describe('the lines every slide repeats', () => {
  it('drops a footer whose page number changes from slide to slide', () => {
    const deck = [
      ['Growth phases (Greiner, 1972)', footer(9)],
      ['Why growth is ambiguous', 'Revenue and profit need not move together', footer(10)],
      ['Wrap-up', footer(11)],
    ]
    expect(withoutFurniture(deck)).toEqual([
      ['Growth phases (Greiner, 1972)'],
      ['Why growth is ambiguous', 'Revenue and profit need not move together'],
      ['Wrap-up'],
    ])
  })

  it('keeps a line that only some slides share', () => {
    const deck = [
      ['Question to you', 'What is risk?'],
      ['Risk', 'An outcome with a known probability'],
      ['Question to you', 'What is uncertainty?'],
      ['Uncertainty', 'An outcome nobody can calculate'],
      ['Summary'],
    ]
    expect(withoutFurniture(deck)).toEqual(deck)
  })

  it('drops a bare page number', () => {
    const deck = [
      ['Risk', '1'],
      ['Uncertainty', '2'],
      ['Summary', '3'],
    ]
    expect(withoutFurniture(deck)).toEqual([['Risk'], ['Uncertainty'], ['Summary']])
  })

  it('leaves a deck of two slides alone', () => {
    const deck = [
      ['Risk', 'TUM'],
      ['Uncertainty', 'TUM'],
    ]
    expect(withoutFurniture(deck)).toEqual(deck)
  })
})
