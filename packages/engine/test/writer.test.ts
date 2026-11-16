import { describe, expect, it } from 'vitest'
import type { AskModel } from '../src/ask.ts'
import type { ModelRequest } from '../src/ports.ts'
import { CONCEPT } from '../src/presets.ts'
import { createWriter, type CardJob } from '../src/writer.ts'

const picture = (slide: number) => ({ slide, png: `png-of-${slide}` })
const job = (slide: number, text: string, pictured: boolean): CardJob => ({
  context: 'Lecture 01 Risk\nSlides:\n[1] Title',
  images: pictured ? [picture(slide)] : [],
  concept: { id: 'risk', name: 'Risk', slides: [3, 5], facts: [] },
  fact: { text, slide, kind: 'definition' },
  role: 'definition',
})

describe('the card writer', () => {
  it('writes up to three cards of a concept in one call, with only their own slides as pictures', async () => {
    const requests: ModelRequest[] = []
    const ask = ((request: ModelRequest) => {
      requests.push({ ...request, schema: {} })
      return Promise.resolve({
        cards: [1, 2, 3].map((n) => ({
          cardType: 'definition',
          question: `Question ${n}?`,
          answer: `Answer ${n}.`,
          extra: '',
        })),
      })
    }) as unknown as AskModel
    const slots = await createWriter(ask, CONCEPT).fill([
      job(3, 'Risk can be measured.', true),
      job(3, 'Risk has known odds.', true),
      job(4, 'Risk is insurable.', false),
    ])
    expect(slots.map((s) => s.front)).toEqual(['Question 1?', 'Question 2?', 'Question 3?'])
    expect(requests).toHaveLength(1)
    const [request] = requests
    // The lecture as cached text, then each picture of the cards' slides once.
    expect(request!.images).toEqual([])
    expect(request!.shown).toEqual([picture(3)])
    expect(request!.prompt.match(/^Card \d$/gm)).toEqual(['Card 1', 'Card 2', 'Card 3'])
  })

  it('asks again on its own for a card the reply left out', async () => {
    const requests: ModelRequest[] = []
    const ask = ((request: ModelRequest) => {
      requests.push({ ...request, schema: {} })
      const n = requests.length
      return Promise.resolve({
        cards: [{ cardType: 'definition', question: `Q${n}?`, answer: `A${n}.`, extra: '' }],
      })
    }) as unknown as AskModel
    const slots = await createWriter(ask, CONCEPT).fill([
      job(3, 'Risk can be measured.', true),
      job(5, 'Risk is insurable.', true),
    ])
    expect(slots.map((s) => s.front)).toEqual(['Q1?', 'Q2?'])
    expect(requests[1]!.prompt).toContain('Risk is insurable.')
    expect(requests[1]!.shown).toEqual([picture(5)])
  })
})
