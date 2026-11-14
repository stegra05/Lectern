import { describe, expect, it } from 'vitest'
import { findQuoteRanges } from './quoteMatch'

const slide = [
  'Gradient Descent',
  'Gradient descent minimizes a loss function.',
  'The learning rate sets the step size.',
  'Too large a rate makes the loss di-',
  'verge; too small a rate learns slowly.',
].join('\n')

const marked = (text: string, quote: string) =>
  findQuoteRanges(text, quote).map(({ start, end }) => text.slice(start, end))

describe('findQuoteRanges', () => {
  it('marks the quote as one range, spaces included', () => {
    expect(marked(slide, 'minimizes a loss function')).toEqual(['minimizes a loss function'])
  })

  it('ignores case, reflowed line breaks and spacing that pdf.js invents', () => {
    expect(marked(slide, 'GRADIENT DESCENT MINIMIZES')).toEqual(['Gradient descent minimizes'])
    expect(marked('Gradi ent  descent', 'gradient descent')).toEqual(['Gradi ent  descent'])
    expect(marked(slide, 'loss function. The learning rate')).toEqual([
      'loss function.\nThe learning rate',
    ])
  })

  it('reads a word hyphenated across a line break as one word', () => {
    expect(marked(slide, 'makes the loss diverge')).toEqual(['makes the loss di-\nverge'])
  })

  it('folds typographic quotes, dashes and ligatures', () => {
    expect(marked('the “ﬁrst” step – always', '"first" step - always')).toEqual([
      '“ﬁrst” step – always',
    ])
  })

  it('does not mark words the quote merely shares with the slide', () => {
    expect(findQuoteRanges(slide, 'the step of the loss')).toEqual([])
    expect(findQuoteRanges(slide, 'rate')).toEqual([])
  })

  it('marks the parts of a stitched quote that are on the slide', () => {
    const quote =
      'Gradient descent minimizes a loss function.\nThe learning rate sets the step size.'
    expect(marked(slide, quote)).toEqual([
      'Gradient descent minimizes a loss function.\nThe learning rate sets the step size.',
    ])
    expect(
      marked(slide, 'The learning rate sets the step size … momentum smooths the path'),
    ).toEqual(['The learning rate sets the step size'])
  })

  it('skips fragments too short to mean anything', () => {
    expect(findQuoteRanges(slide, 'Unrelated sentence here. The loss')).toEqual([])
  })
})
