import { describe, expect, it } from 'vitest'
import type { CardFile } from '../src/cards/assemble.ts'
import { checkSlots, toDraft, toSlots, type Slots } from '../src/cards/slots.ts'

const card = (fields: Record<string, string>): CardFile => ({
  id: 'c',
  note: 'cloze',
  concept: 'x',
  slide: 1,
  fields: { Role: 'cloze', ...fields },
})
const gap = (front: string, hidden: string[], at: number[] = []): Slots => ({
  role: 'cloze',
  front,
  answers: [],
  labels: [],
  hidden,
  at,
  extra: '',
  code: '',
})
const place = { concept: 'x', slide: 1 }

describe('the gaps of a cloze card', () => {
  it('stay where they were when the card is edited, also behind the same text', () => {
    const text = 'Anchoring bias makes the {{c1::bias}} of a first number stick'
    const slots = toSlots(card({ Text: text }))
    expect(slots.front).toBe('Anchoring bias makes the bias of a first number stick')
    expect(checkSlots(slots)).toEqual([])
    expect(toDraft(slots, place).front).toBe(text)
  })

  it('keep their places when the student only changes another part', () => {
    const text = '{{c1::the}} sky is blue and the grass is {{c2::green}} and the sea too'
    const slots = toSlots(card({ Text: text }))
    expect(toDraft({ ...slots, hidden: ['the', 'green'] }, place).front).toBe(text)
  })

  it('never match inside another word', () => {
    const slots = gap('Another theory: the sky is blue', ['the'])
    expect(checkSlots(slots)).toEqual([])
    expect(toDraft(slots, place).front).toBe('Another theory: {{c1::the}} sky is blue')
    const inside = checkSlots(gap('Another theory', ['the']))
    expect(inside.map((p) => p.field)).toEqual(['hidden'])
    expect(inside[0]!.message).toMatch(/word for word/)
  })

  it('are refused, with the part named, when a part of an own card stands twice', () => {
    expect(checkSlots(gap('Say the sky is blue and the sea is too', ['the']))).toEqual([
      {
        field: 'hidden',
        message:
          '"the" stands more than once in the sentence. Hide a longer part, with the words next to it, so that it is clear which one.',
      },
    ])
    const longer = gap('Say the sky is blue and the sea is too', ['the sea'])
    expect(checkSlots(longer)).toEqual([])
    expect(toDraft(longer, place).front).toBe('Say the sky is blue and {{c1::the sea}} is too')
  })

  it('count a repeat only behind the part before it', () => {
    const sentence = 'Risk is not risk until the risk is known'
    expect(checkSlots(gap(sentence, ['risk'])).map((p) => p.field)).toEqual(['hidden'])
    const behind = gap(sentence, ['until', 'risk'])
    expect(checkSlots(behind)).toEqual([])
    expect(toDraft(behind, place).front).toBe(
      'Risk is not risk {{c1::until}} the {{c2::risk}} is known',
    )
  })
})
