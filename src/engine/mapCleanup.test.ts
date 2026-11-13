import { describe, expect, it } from 'vitest'

import {
  applyFacetCorrection,
  checkConceptMap,
  facetTotal,
  hasFlags,
  mergeExactRepeats,
} from './mapCleanup'
import type { Concept, ConceptMap, Importance } from './types'

const concept = (
  id: string,
  facets: string[],
  pages: number[] = [1],
  importance: Importance = 'medium',
): Concept => ({
  id,
  name: `Concept ${id}`,
  importance,
  difficulty: 'intermediate',
  pageReferences: pages,
  facets,
})

const mapOf = (...concepts: Concept[]): ConceptMap => ({
  objectives: [],
  concepts,
  relations: [],
  language: 'en',
  slideSetName: 'Test',
  pageCount: 10,
  estimatedTextChars: 1000,
  documentType: 'slides',
})

const facetsOf = (map: ConceptMap) => map.concepts.map((c) => c.facets)

/** Roomy enough that no test trips the size flag by accident. */
const TARGET = { max: 20 }

describe('mergeExactRepeats', () => {
  it('drops a label repeated within a concept, whatever its case and punctuation', () => {
    const { conceptMap, merged } = mergeExactRepeats(
      mapOf(concept('a', ['Freezing parameters', 'freezing <b>parameters</b>.', 'Fine-tuning'])),
    )
    expect(facetsOf(conceptMap)).toEqual([['Freezing parameters', 'Fine-tuning']])
    expect(merged).toBe(1)
  })

  it('keeps a fact two concepts share on one page with the more important one', () => {
    const { conceptMap, merged } = mergeExactRepeats(
      mapOf(
        concept('a', ['Bits per sample', 'Prediction targets'], [3], 'medium'),
        concept('b', ['Bits per sample', 'Cake layers'], [3, 4], 'high'),
      ),
    )
    expect(facetsOf(conceptMap)).toEqual([
      ['Prediction targets'],
      ['Bits per sample', 'Cake layers'],
    ])
    expect(merged).toBe(1)
  })

  it('keeps it with the earlier concept on a tie', () => {
    const { conceptMap } = mergeExactRepeats(
      mapOf(
        concept('a', ['Bits per sample', 'Prediction targets'], [3]),
        concept('b', ['Bits per sample', 'Cake layers'], [3]),
      ),
    )
    expect(facetsOf(conceptMap)).toEqual([
      ['Bits per sample', 'Prediction targets'],
      ['Cake layers'],
    ])
  })

  it('leaves a shared label alone when the concepts share no page', () => {
    const map = mapOf(
      concept('a', ['Bits per sample', 'Prediction targets'], [3]),
      concept('b', ['Bits per sample', 'Cake layers'], [9]),
    )
    expect(mergeExactRepeats(map)).toEqual({ conceptMap: map, merged: 0 })
  })

  it('reads a one-word label as its concept’s own, not as a shared fact', () => {
    const map = mapOf(
      concept('a', ['Definition', 'Formula'], [3]),
      concept('b', ['Definition', 'Example'], [3]),
    )
    expect(mergeExactRepeats(map).merged).toBe(0)
    expect(checkConceptMap(map, TARGET).overlaps).toEqual([])
  })

  it('never leaves a concept without facets', () => {
    const map = mapOf(
      concept('a', ['Bits per sample', 'Prediction targets'], [3], 'high'),
      concept('b', ['Bits per sample'], [3], 'low'),
    )
    expect(mergeExactRepeats(map).merged).toBe(0)
    // It is still one fact in two slots, so the model is asked about it.
    expect(checkConceptMap(map, TARGET).overlaps).toHaveLength(1)
  })

  it('leaves the map it was given untouched', () => {
    const map = mapOf(concept('a', ['Same fact', 'Same fact']))
    mergeExactRepeats(map)
    expect(map.concepts[0].facets).toEqual(['Same fact', 'Same fact'])
  })
})

describe('checkConceptMap', () => {
  it('flags labels that name one fact in other words, across concepts', () => {
    const flags = checkConceptMap(
      mapOf(
        concept('a', ['Freezing pretrained parameters', 'Domain shift']),
        concept('b', ['Freezing parameters', 'Parameter count']),
      ),
      TARGET,
    )
    expect(flags.overlaps).toEqual([
      [
        { conceptId: 'a', label: 'Freezing pretrained parameters' },
        { conceptId: 'b', label: 'Freezing parameters' },
      ],
    ])
    expect(hasFlags(flags)).toBe(true)
  })

  it('flags an inflected repeat within a concept', () => {
    const flags = checkConceptMap(mapOf(concept('a', ['Definition', 'Definitions'])), TARGET)
    expect(flags.overlaps).toHaveLength(1)
  })

  it('keeps related but distinct facts apart', () => {
    const flags = checkConceptMap(
      mapOf(
        concept('a', ['HPV 16/18 high-risk types', 'HPV low-risk types', 'E6/E7 inactivate p53']),
      ),
      TARGET,
    )
    expect(flags.overlaps).toEqual([])
    expect(hasFlags(flags)).toBe(false)
  })

  it('flags a facet total above twice the concept target', () => {
    const map = mapOf(
      concept(
        'a',
        ['one fact', 'two fact', 'three fact', 'four fact'].map((f) => `${f} alpha`),
      ),
      concept('b', []),
    )
    // Four facets plus one for the concept without any.
    expect(facetTotal(map)).toBe(5)
    expect(checkConceptMap(map, { max: 2 })).toMatchObject({ facetTotal: 5, facetLimit: 4 })
    expect(hasFlags(checkConceptMap(map, { max: 2 }))).toBe(true)
    expect(hasFlags(checkConceptMap(map, { max: 3 }))).toBe(false)
  })
})

describe('applyFacetCorrection', () => {
  const map = mapOf(
    concept('a', ['Freezing pretrained parameters', 'Domain shift']),
    concept('b', ['Freezing parameters', 'Parameter count']),
  )
  const correction = (entries: Record<string, string[]>) => new Map(Object.entries(entries))

  it('takes the corrected facets and nothing else', () => {
    const fixed = applyFacetCorrection(
      map,
      correction({ a: ['Freezing pretrained parameters', 'Domain shift'], b: ['Parameter count'] }),
      TARGET,
    )
    expect(fixed && facetsOf(fixed)).toEqual([
      ['Freezing pretrained parameters', 'Domain shift'],
      ['Parameter count'],
    ])
    expect(fixed?.concepts.map((c) => c.name)).toEqual(['Concept a', 'Concept b'])
  })

  it('merges exact repeats the correction still holds', () => {
    const fixed = applyFacetCorrection(
      map,
      correction({ a: ['Domain shift', 'domain shift'], b: ['Parameter count'] }),
      TARGET,
    )
    expect(fixed && facetsOf(fixed)).toEqual([['Domain shift'], ['Parameter count']])
  })

  it('refuses a correction that drops or invents a concept', () => {
    expect(applyFacetCorrection(map, correction({ a: ['Domain shift'] }), TARGET)).toBeNull()
    expect(
      applyFacetCorrection(
        map,
        correction({ a: ['Domain shift'], b: ['Parameter count'], c: ['New idea'] }),
        TARGET,
      ),
    ).toBeNull()
  })

  it('refuses a correction that empties a concept', () => {
    expect(applyFacetCorrection(map, correction({ a: ['Domain shift'], b: [] }), TARGET)).toBeNull()
  })

  it('refuses a correction that grows the map', () => {
    expect(
      applyFacetCorrection(
        map,
        correction({
          a: ['Domain shift', 'Source domain', 'Target domain'],
          b: ['Parameter count', 'Learning rate'],
        }),
        TARGET,
      ),
    ).toBeNull()
  })

  it('refuses a correction that fares worse on the same check', () => {
    // One overlap before; the correction swaps it for two.
    const worse = correction({
      a: ['Gradient clipping norm', 'Gradient clipping value'],
      b: ['Gradient clipping', 'Parameter count'],
    })
    expect(applyFacetCorrection(map, worse, TARGET)).toBeNull()
  })
})
