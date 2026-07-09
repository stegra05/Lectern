import { describe, expect, it } from 'vitest'

import { cardKey, evaluateCard, normalizeCardPayload } from './quality'
import type { Card } from './types'

const makeCard = (overrides: Partial<Card> = {}): Card => ({
  uid: 'test-uid',
  modelName: 'Basic',
  fields: {},
  sourcePages: [],
  conceptIds: [],
  relationKeys: [],
  qualityScore: 0,
  qualityIssues: [],
  ...overrides,
})

const groundedCard = (overrides: Partial<Card> = {}): Card =>
  makeCard({
    fields: {
      Front: 'What is photosynthesis?',
      Back: 'The conversion of light energy into chemical energy.',
    },
    sourcePages: [3],
    conceptIds: ['c-photosynthesis'],
    relationKeys: ['c-photosynthesis|enables|c-glucose'],
    rationale: 'Core definition of the lecture.',
    sourceExcerpt: 'Photosynthesis converts light energy into glucose.',
    slideNumber: 3,
    ...overrides,
  })

describe('evaluateCard', () => {
  it('passes a fully grounded card at score 100 with no issues', () => {
    const verdict = evaluateCard(groundedCard())
    expect(verdict).toEqual({ pass: true, score: 100, failures: [], issues: [] })
  })

  it('rejects a bare card with every hard failure, issues sorted', () => {
    const verdict = evaluateCard(makeCard())
    expect(verdict.pass).toBe(false)
    expect(verdict.score).toBe(0)
    expect(verdict.failures).toEqual([
      'missing_prompt_text',
      'missing_answer_text',
      'missing_source_pages',
      'missing_rationale',
      'missing_source_excerpt',
    ])
    expect(verdict.issues).toEqual([
      'missing_answer_text',
      'missing_concept_ids',
      'missing_prompt_text',
      'missing_rationale',
      'missing_source_excerpt',
      'missing_source_pages',
    ])
  })

  it('rejects a card without answer text', () => {
    const verdict = evaluateCard(groundedCard({ fields: { Front: 'Q?' } }))
    expect(verdict.pass).toBe(false)
    expect(verdict.failures).toEqual(['missing_answer_text'])
  })

  it('rejects when rationale or source excerpt are missing', () => {
    const verdict = evaluateCard(groundedCard({ rationale: undefined, sourceExcerpt: '  ' }))
    expect(verdict.pass).toBe(false)
    expect(verdict.failures).toEqual(['missing_rationale', 'missing_source_excerpt'])
  })

  it('rejects a Cloze card without a cloze deletion', () => {
    const verdict = evaluateCard(
      groundedCard({ modelName: 'Cloze', fields: { Text: 'No deletion here.' } }),
    )
    expect(verdict.pass).toBe(false)
    expect(verdict.failures).toEqual(['cloze_without_deletion'])
  })

  it('accepts a Cloze card with a deletion', () => {
    const verdict = evaluateCard(
      groundedCard({
        modelName: 'Cloze',
        fields: { Text: 'The powerhouse is the {{c1::mitochondrion}}.' },
      }),
    )
    expect(verdict.pass).toBe(true)
  })

  it('rejects a Basic card containing cloze markup', () => {
    const verdict = evaluateCard(
      groundedCard({ fields: { Front: 'What is {{c1::X}}?', Back: 'X.' } }),
    )
    expect(verdict.pass).toBe(false)
    expect(verdict.failures).toEqual(['cloze_markup_in_basic'])
  })

  it('flags soft issues without rejecting: long front/answer, broad grounding, no concepts', () => {
    const verdict = evaluateCard(
      groundedCard({
        fields: { Front: `${'why '.repeat(50)}?`, Back: 'a'.repeat(421) },
        sourcePages: [1, 2, 3, 4],
        conceptIds: [],
      }),
    )
    expect(verdict.pass).toBe(true)
    expect(verdict.failures).toEqual([])
    expect(verdict.issues).toEqual([
      'broad_grounding',
      'long_answer',
      'long_front',
      'missing_concept_ids',
    ])
    expect(verdict.score).toBe(60) // 100 - 4 soft issues × 10
  })

  it('falls back to the slide number when sourcePages is empty', () => {
    const verdict = evaluateCard(groundedCard({ sourcePages: [], slideNumber: 7 }))
    expect(verdict.failures).not.toContain('missing_source_pages')
  })

  it('treats markup-only fields as missing prompt text', () => {
    const verdict = evaluateCard(makeCard({ fields: { Front: '<i>&nbsp;</i>' } }))
    expect(verdict.failures).toContain('missing_prompt_text')
  })

  it('accepts a declared outside-source card without pages or excerpt, flagged', () => {
    const verdict = evaluateCard(
      makeCard({
        fields: { Front: 'What is X?', Back: 'X is Y.' },
        rationale: 'The user asked for it.',
        outsideSource: true,
      }),
    )
    expect(verdict.pass).toBe(true)
    expect(verdict.issues).toEqual(['outside_source'])
    expect(verdict.score).toBe(90)
  })

  it('still rejects the same ungrounded card without the outside-source declaration', () => {
    const verdict = evaluateCard(
      makeCard({
        fields: { Front: 'What is X?', Back: 'X is Y.' },
        rationale: 'The user asked for it.',
      }),
    )
    expect(verdict.pass).toBe(false)
    expect(verdict.failures).toEqual(['missing_source_pages', 'missing_source_excerpt'])
  })
})

describe('normalizeCardPayload', () => {
  it('accepts fields as a [{name, value}] list and coerces metadata', () => {
    const result = normalizeCardPayload({
      model_name: 'basic',
      fields: [
        { name: ' Front ', value: 'What is X?' },
        { name: 'Back', value: 42 },
        { name: 'Skipped', value: null },
        { name: '', value: 'no name' },
      ],
      slide_number: '12',
      source_pages: ['3', 3, 4.0, 0, -1, 'junk'],
      concept_ids: 'c1, c2, ,c3',
      relation_keys: ['a|b|c'],
      slide_topic: ' Enzymes ',
      rationale: 'Key concept.',
      source_excerpt: 'From page 3.',
    })
    expect(result).not.toBeNull()
    expect(result?.modelName).toBe('Basic')
    expect(result?.fields).toEqual({ Front: 'What is X?', Back: '42' })
    expect(result?.slideNumber).toBe(12)
    expect(result?.sourcePages).toEqual([3, 4])
    expect(result?.conceptIds).toEqual(['c1', 'c2', 'c3'])
    expect(result?.relationKeys).toEqual(['a|b|c'])
    expect(result?.slideTopic).toBe('Enzymes')
    expect(result?.rationale).toBe('Key concept.')
    expect(result?.sourceExcerpt).toBe('From page 3.')
  })

  it('accepts fields as a record, dropping null values', () => {
    const result = normalizeCardPayload({
      model_name: 'Basic',
      fields: { Front: 'Q?', Back: null, Extra: 7 },
    })
    expect(result?.fields).toEqual({ Front: 'Q?', Extra: '7' })
  })

  it('accepts the {front, back} shorthand for basic cards', () => {
    const result = normalizeCardPayload({
      model_name: 'Basic',
      front: ' What is Y? ',
      back: 'Z.',
    })
    expect(result?.modelName).toBe('Basic')
    expect(result?.fields).toEqual({ Front: 'What is Y?', Back: 'Z.' })
  })

  it('accepts the {text} shorthand for cloze cards', () => {
    const result = normalizeCardPayload({
      model_name: 'cloze',
      text: '{{c1::Mitochondria}} produce ATP.',
    })
    expect(result?.modelName).toBe('Cloze')
    expect(result?.fields).toEqual({ Text: '{{c1::Mitochondria}} produce ATP.' })
  })

  it('detects cloze via substring match on the model name', () => {
    expect(
      normalizeCardPayload({
        model_name: 'My CLOZE (custom)',
        fields: { Text: '{{c1::x}}' },
      })?.modelName,
    ).toBe('Cloze')
    expect(normalizeCardPayload({ modelName: 'BASIC', fields: { Front: 'Q' } })?.modelName).toBe(
      'Basic',
    )
  })

  it('rejects out-of-range slide numbers', () => {
    expect(
      normalizeCardPayload({
        model_name: 'Basic',
        fields: { Front: 'Q' },
        slide_number: 250000,
      })?.slideNumber,
    ).toBeUndefined()
    expect(
      normalizeCardPayload({
        model_name: 'Basic',
        fields: { Front: 'Q' },
        slide_number: '123456',
      })?.slideNumber,
    ).toBeUndefined()
  })

  it('returns null for unusable input', () => {
    expect(normalizeCardPayload(null)).toBeNull()
    expect(normalizeCardPayload('nonsense')).toBeNull()
    expect(normalizeCardPayload(['not', 'a', 'card'])).toBeNull()
    expect(normalizeCardPayload({ model_name: 'Basic' })).toBeNull()
    expect(normalizeCardPayload({ model_name: 'Basic', front: '  ' })).toBeNull()
    expect(normalizeCardPayload({ model_name: 'cloze', front: 'ignored' })).toBeNull()
  })
})

describe('cardKey', () => {
  it('is stable across case, whitespace and punctuation', () => {
    const a = cardKey({ modelName: 'Basic', fields: { Front: '  What   IS  X? ' } })
    const b = cardKey({ modelName: 'Basic', fields: { Front: 'what is x' } })
    expect(a).toBe('what is x')
    expect(a).toBe(b)
  })

  it('reduces cloze wrappers to their answers (hints dropped)', () => {
    const key = cardKey({
      modelName: 'Cloze',
      fields: { Text: 'The answer is {{c1::Mitochondria::organelle}}.' },
    })
    expect(key).toBe('the answer is mitochondria')
  })

  it('prefers the Text field over Front', () => {
    const key = cardKey({
      modelName: 'Cloze',
      fields: { Text: 'Cloze basis', Front: 'Front basis' },
    })
    expect(key).toBe('cloze basis')
  })

  it('strips HTML markup and entities', () => {
    const key = cardKey({
      modelName: 'Basic',
      fields: { Front: '<b>Foo</b>&amp; Bar!!' },
    })
    expect(key).toBe('foo bar')
  })

  it('returns an empty key when there is no usable prompt', () => {
    expect(cardKey({ modelName: 'Basic', fields: {} })).toBe('')
    expect(cardKey({ modelName: 'Basic', fields: { Back: 'only back' } })).toBe('')
  })
})
