import { describe, expect, it } from 'vitest'
import { toCard } from '../src/cards/card.ts'
import { cardFields } from '../src/cards/fields.ts'
import { checkSlots, fromDraft, tidy, toDraft, type Slots } from '../src/cards/slots.ts'

/** The slots of a gap sentence as the model writes it. */
const written = (text: string): Slots =>
  fromDraft({ ...place, role: 'cloze', front: text, answers: [], labels: [], extra: '', code: '' })
/** What the validator reads of slots a student hands back. */
const drafted = (slots: Slots) => toDraft(tidy(slots), place)
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
    const slots = written(text)
    expect(slots.front).toBe('Anchoring bias makes the bias of a first number stick')
    expect(checkSlots(slots)).toEqual([])
    expect(drafted(slots).front).toBe(text)
  })

  it('keep their places when the student only changes another part', () => {
    const text = '{{c1::the}} sky is blue and the grass is {{c2::green}} and the sea too'
    const slots = written(text)
    expect(drafted({ ...slots, hidden: ['the', 'green'] }).front).toBe(text)
  })

  it('never match inside another word', () => {
    const slots = gap('Another theory: the sky is blue', ['the'])
    expect(checkSlots(slots)).toEqual([])
    expect(drafted(slots).front).toBe('Another theory: {{c1::the}} sky is blue')
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
    expect(drafted(longer).front).toBe('Say the sky is blue and {{c1::the sea}} is too')
  })

  it('count a repeat only behind the part before it', () => {
    const sentence = 'Risk is not risk until the risk is known'
    expect(checkSlots(gap(sentence, ['risk'])).map((p) => p.field)).toEqual(['hidden'])
    const behind = gap(sentence, ['until', 'risk'])
    expect(checkSlots(behind)).toEqual([])
    expect(drafted(behind).front).toBe('Risk is not risk {{c1::until}} the {{c2::risk}} is known')
  })
})

describe('a key term', () => {
  const placement = {
    id: 'c',
    lecture: { number: 1, title: 'Risk' },
    concept: { id: 'x', name: 'x' },
    slide: 1,
    slideLines: [],
  }
  const definition = (text: string, key = ''): Slots => ({
    role: 'definition',
    front: 'What does the operator do in code?',
    answers: [{ text, key }],
    labels: [],
    hidden: [],
    at: [],
    extra: '',
    code: '',
  })

  it('with $ is marked without changing the answer', () => {
    const card = toCard(tidy(definition('It costs $$5 total', '$$5')), placement)
    expect(cardFields(card).Back).toBe('It costs <mark>$$5</mark> total')
    expect(card.slots.answers[0]).toEqual({ text: 'It costs $$5 total', key: '$$5' })
    expect(drafted(definition("a $& b $' c", '$&')).answers[0]).toBe("a ==$&== b $' c")
  })

  it('stays apart from a == in the answer, which nothing reads as a mark', () => {
    const slots = definition('a == b holds when both are equal', 'both')
    expect(checkSlots(slots)).toEqual([])
    expect(drafted(slots).answers[0]).toBe('a  b holds when ==both== are equal')
    const card = toCard(tidy(slots), placement)
    expect(card.slots).toEqual(slots)
    expect(cardFields(card).Back).toBe('a == b holds when <mark>both</mark> are equal')
  })
})
