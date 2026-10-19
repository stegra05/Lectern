import { describe, expect, it } from 'vitest'

import { closeObjects, requireAll } from './strictSchema'

const CARD = {
  type: 'object',
  properties: {
    front: { type: 'string' },
    topic: { type: 'string' },
    kind: { type: 'string', enum: ['Basic', 'Cloze'] },
    pages: { type: 'array', items: { type: 'integer' } },
  },
  required: ['front'],
}

describe('requireAll (OpenAI strict)', () => {
  it('requires every property and turns the optional ones nullable', () => {
    expect(requireAll(CARD)).toEqual({
      type: 'object',
      properties: {
        front: { type: 'string' },
        topic: { type: ['string', 'null'] },
        kind: { type: ['string', 'null'], enum: ['Basic', 'Cloze', null] },
        pages: { type: ['array', 'null'], items: { type: 'integer' } },
      },
      required: ['front', 'topic', 'kind', 'pages'],
      additionalProperties: false,
    })
  })

  it('reaches objects nested in arrays', () => {
    const strict = requireAll({
      type: 'object',
      properties: { cards: { type: 'array', items: CARD } },
      required: ['cards'],
    })
    const items = (strict.properties as { cards: { items: Record<string, unknown> } }).cards.items
    expect(items.additionalProperties).toBe(false)
    expect(items.required).toEqual(['front', 'topic', 'kind', 'pages'])
  })
})

describe('closeObjects (Claude strict)', () => {
  it('closes objects and leaves optional properties optional', () => {
    const strict = closeObjects(CARD)
    expect(strict.additionalProperties).toBe(false)
    expect(strict.required).toEqual(['front'])
  })
})
