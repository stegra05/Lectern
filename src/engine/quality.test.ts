import { describe, expect, it } from 'vitest'

import { GROUNDING_GATE_MIN_QUALITY } from './config'
import {
  cardKey,
  evaluateGroundingGate,
  normalizeCardPayload,
  scoreCard,
} from './quality'
import type { Card, CoverageCatalog } from './types'

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

const makeCatalog = (highPriorityIds: string[]): CoverageCatalog => ({
  conceptIds: new Set(highPriorityIds),
  highPriorityIds: new Set(highPriorityIds),
  relationKeys: new Set<string>(),
  conceptsByPage: new Map(),
  pagesByConcept: new Map(),
  conceptNames: new Map(),
  pageCount: 10,
})

describe('scoreCard', () => {
  it('scores a fully grounded card with every bonus (98) and no issues', () => {
    // 30 base + 12 prompt + 10 answer + 12 pages + 12 concepts + 6 relations
    // + 7 rationale + 6 excerpt + 3 slide number = 98
    const { score, issues } = scoreCard(groundedCard())
    expect(score).toBe(98)
    expect(issues).toEqual([])
  })

  it('adds the high-priority bonus from the catalog and clamps at 100', () => {
    const catalog = makeCatalog(['c-photosynthesis'])
    const { score } = scoreCard(groundedCard(), catalog)
    expect(score).toBe(100) // 98 + 5, clamped

    const other = makeCatalog(['c-unrelated'])
    expect(scoreCard(groundedCard(), other).score).toBe(98)
  })

  it('floors a bare card at 0 with all missing-* issues, sorted', () => {
    // 30 - 20 - 15 - 10 - 8 - 4 - 4 = -31 → clamped to 0
    const { score, issues } = scoreCard(makeCard())
    expect(score).toBe(0)
    expect(issues).toEqual([
      'missing_answer_text',
      'missing_concept_ids',
      'missing_prompt_text',
      'missing_rationale',
      'missing_source_excerpt',
      'missing_source_pages',
    ])
  })

  it('penalizes an over-long front (-8, long_front)', () => {
    const card = groundedCard({
      fields: {
        Front: `${'why '.repeat(50)}?`, // 201 chars > 180 threshold
        Back: 'Short answer.',
      },
    })
    const { score, issues } = scoreCard(card)
    expect(issues).toContain('long_front')
    expect(score).toBe(90)
  })

  it('penalizes an over-long answer (-8, long_answer)', () => {
    const card = groundedCard({
      fields: {
        Front: 'Short question?',
        Back: 'a'.repeat(421),
      },
    })
    const { score, issues } = scoreCard(card)
    expect(issues).toContain('long_answer')
    expect(score).toBe(90)
  })

  it('penalizes broad grounding across more than 3 pages (-3)', () => {
    const { score, issues } = scoreCard(groundedCard({ sourcePages: [1, 2, 3, 4] }))
    expect(issues).toContain('broad_grounding')
    expect(score).toBe(95)
  })

  it('falls back to the slide number when sourcePages is empty', () => {
    const card = makeCard({
      fields: { Front: 'Q?', Back: 'A.' },
      sourcePages: [],
      slideNumber: 7,
    })
    const { issues } = scoreCard(card)
    expect(issues).not.toContain('missing_source_pages')
  })

  it('treats markup-only fields as missing prompt text', () => {
    const card = makeCard({ fields: { Front: '<i>&nbsp;</i>' } })
    expect(scoreCard(card).issues).toContain('missing_prompt_text')
  })

  it('uses the Text field as prompt and answer for cloze cards', () => {
    const card = makeCard({
      modelName: 'Cloze',
      fields: { Text: 'The powerhouse is the {{c1::mitochondrion}}.' },
    })
    const { issues } = scoreCard(card)
    expect(issues).not.toContain('missing_prompt_text')
    expect(issues).not.toContain('missing_answer_text')
  })
})

describe('evaluateGroundingGate', () => {
  it('passes a fully grounded card', () => {
    const verdict = evaluateGroundingGate(groundedCard())
    expect(verdict).toEqual({ pass: true, score: 98, failures: [] })
    expect(verdict.score).toBeGreaterThanOrEqual(GROUNDING_GATE_MIN_QUALITY)
  })

  it('fails with ordered slugs when excerpt and rationale are missing', () => {
    // 30 + 12 + 10 + 12 + 12 - 4 - 4 = 68 → above threshold, still gated
    const card = makeCard({
      fields: { Front: 'Q?', Back: 'A.' },
      sourcePages: [1],
      conceptIds: ['c-1'],
    })
    const verdict = evaluateGroundingGate(card)
    expect(verdict.pass).toBe(false)
    expect(verdict.score).toBe(68)
    expect(verdict.failures).toEqual(['missing_source_excerpt', 'missing_rationale'])
  })

  it('fails a bare card on all grounding slugs plus the quality threshold', () => {
    const verdict = evaluateGroundingGate(makeCard())
    expect(verdict.pass).toBe(false)
    expect(verdict.score).toBe(0)
    expect(verdict.failures).toEqual([
      'missing_source_excerpt',
      'missing_rationale',
      'missing_source_pages',
      'below_quality_threshold',
    ])
  })

  it('fails on below_quality_threshold alone when grounding is present', () => {
    // Grounded but no prompt/answer: 30 - 20 - 15 + 12 + 12 + 7 + 6 = 32 < 60
    const card = makeCard({
      fields: {},
      sourcePages: [2],
      conceptIds: ['c-1'],
      rationale: 'Why this matters.',
      sourceExcerpt: 'From the slide.',
    })
    const verdict = evaluateGroundingGate(card)
    expect(verdict.pass).toBe(false)
    expect(verdict.failures).toEqual(['below_quality_threshold'])
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
    expect(
      normalizeCardPayload({ modelName: 'BASIC', fields: { Front: 'Q' } })
        ?.modelName,
    ).toBe('Basic')
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
