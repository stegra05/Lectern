import { describe, expect, it } from 'vitest'
import { assemble, type Placement } from '../src/cards/assemble.ts'
import { excerpt } from '../src/cards/card.ts'
import { cardId } from '../src/cards/id.ts'
import type { Draft } from '../src/cards/roles.ts'
import { conceptId, slideRange, slug, words } from '../src/cards/words.ts'

const QA_FIELDS = [
  'Front',
  'Back',
  'Role',
  'Slots',
  'Code',
  'Typed',
  'Lecture',
  'Topic',
  'Source',
  'Asked',
  'Part',
  'Extra',
  'Excerpt',
  'Slide',
  'Diagram',
  'Key',
]
const CLOZE_FIELDS = [
  'Text',
  'Role',
  'Typed',
  'Lecture',
  'Topic',
  'Source',
  'Asked',
  'Part',
  'Extra',
  'Excerpt',
  'Slide',
  'Diagram',
  'Key',
]

const place: Placement = {
  id: '02-bird-in-hand-reverse-1',
  lecture: { number: 2, title: 'Effectuation' },
  concept: { id: 'bird-in-hand', name: 'bird in hand' },
  slideLines: ['Bird in hand', 'Start from who you are, what you know and whom you know'],
}
const draft = (over: Partial<Draft>): Draft => ({
  concept: 'bird in hand',
  role: 'reverse',
  slide: 21,
  front: 'Which effectual principle says to start from who you are?',
  answers: ['Bird in hand'],
  labels: [],
  extra: '',
  code: '',
  ...over,
})
const fields = (over: Partial<Draft>) => assemble(draft(over), place).fields

describe('assemble', () => {
  it('writes every Q&A field of the contract, in its order', () => {
    const card = assemble(draft({}), place)
    expect(Object.keys(card.fields)).toEqual(QA_FIELDS)
    expect(card).toMatchObject({
      id: place.id,
      note: 'qa',
      concept: 'bird-in-hand',
      slide: 21,
    })
    expect(card.fields).toMatchObject({
      Front: 'Which effectual principle says to start from who you are?',
      Back: '<mark>Bird in hand</mark>',
      Role: 'reverse',
      Lecture: '02',
      Topic: 'Effectuation',
      Source: 'Lecture 2, slide 21',
      Asked: '',
      Part: '',
      Slide: '<img src="l02-s21.png">',
      Key: 'bird in hand',
    })
  })

  it('writes every cloze field of the contract, in its order', () => {
    const card = assemble(
      draft({ role: 'cloze', front: 'Start from {{c1::who you are}}.', answers: [] }),
      place,
    )
    expect(Object.keys(card.fields)).toEqual(CLOZE_FIELDS)
    expect(card.note).toBe('cloze')
    expect(card.fields.Text).toBe('Start from {{c1::who you are}}.')
  })

  it('fills the slots of a contrast from its labels', () => {
    const f = fields({
      role: 'contrast',
      labels: ['Causation', 'Effectuation'],
      answers: ['expected return', 'affordable loss'],
    })
    expect(f.Slots).toBe('<span>Causation</span><span>Effectuation</span>')
    expect(f.Back).toBe(
      '<ul><li><mark>expected return</mark></li><li><mark>affordable loss</mark></li></ul>',
    )
  })

  it('fills the slots of a chain: the given steps, then one empty slot per gap', () => {
    const f = fields({
      role: 'chain',
      labels: ['Segments', 'Value propositions'],
      answers: ['Channels', 'Relationships'],
    })
    expect(f.Slots).toBe(
      '<span>Segments</span><span>Value propositions</span><span></span><span></span>',
    )
    expect(f.Back).toBe(
      '<ul><li><mark>Channels</mark></li><li><mark>Relationships</mark></li></ul>',
    )
  })

  it('numbers the deletions of a cloze list itself', () => {
    const f = fields({
      role: 'cloze-list',
      front: 'The five Cs:',
      answers: ['character', 'capacity', 'capital'],
    })
    expect(f.Text).toBe(
      'The five Cs:<ul><li>{{c1::character}}</li><li>{{c2::capacity}}</li><li>{{c3::capital}}</li></ul>',
    )
  })

  it('marks the key term and escapes what the model wrote', () => {
    const f = fields({
      role: 'definition',
      answers: ['An outcome with ==p < 1== & H<sub>2</sub>O.'],
    })
    expect(f.Back).toBe('An outcome with <mark>p &lt; 1</mark> &amp; H<sub>2</sub>O.')
  })

  it('escapes the lecture title and the concept name like every other field', () => {
    const f = assemble(draft({}), {
      ...place,
      lecture: { number: 2, title: 'T & <U>' },
      concept: { id: 'x', name: 'a < b & c' },
    }).fields
    expect(f.Topic).toBe('T &amp; &lt;U&gt;')
    expect(f.Key).toBe('a &lt; b &amp; c')
  })

  it('sets a formula as display maths followed by its condition', () => {
    const f = fields({
      role: 'formula',
      answers: ['|<u,v>| \\le \\|u\\|\\|v\\|', 'Equality when u and v are ==linearly dependent==.'],
    })
    expect(f.Back).toBe(
      '\\[ |&lt;u,v&gt;| \\le \\|u\\|\\|v\\| \\] Equality when u and v are <mark>linearly dependent</mark>.',
    )
  })

  it('puts the listing of a code card into Code, escaped, with its labels as slots', () => {
    const f = fields({
      role: 'code',
      front: 'What does this return?',
      labels: ['Returns', 'Time'],
      answers: ['the index or -1', 'O(log n)'],
      code: 'if xs[mid] < target:\n    lo = mid + 1\n',
    })
    expect(f.Code).toBe('if xs[mid] &lt; target:\n    lo = mid + 1')
    expect(f.Slots).toBe('<span>Returns</span><span>Time</span>')
    expect(f.Back).toBe('<ul><li>the index or -1</li><li>O(log n)</li></ul>')
  })

  it('shows the slide image on a diagram card and leaves Typed empty', () => {
    const f = fields({
      role: 'diagram',
      front: 'Draw the lean loop.',
      answers: ['It ==repeats==.'],
    })
    expect(f.Diagram).toBe('<img src="l02-s21.png">')
    expect(f.Typed).toBe('')
    expect(fields({}).Diagram).toBe('')
  })

  it('writes a "why" answer as one sentence, and as two bullets when it has two steps', () => {
    const why = { role: 'why', front: 'Software: why does copyright protect it only weakly?' }
    expect(fields({ ...why, answers: ['It protects ==the code, not the idea==.'] }).Back).toBe(
      'It protects <mark>the code, not the idea</mark>.',
    )
    expect(
      fields({ ...why, answers: ['It protects ==the code==.', 'So the idea can be rebuilt.'] })
        .Back,
    ).toBe(
      '<ul><li>It protects <mark>the code</mark>.</li><li>So the idea can be rebuilt.</li></ul>',
    )
  })

  it('quotes the slide line that matches the answer, at most 30 words', () => {
    expect(fields({}).Excerpt).toBe(
      'Bird in hand Start from who you are, what you know and whom you know',
    )
    const long = Array.from({ length: 50 }, (_, i) => `w${i}`).join(' ')
    expect(words(excerpt(['Title', `${long} target`], 'target'))).toBe(30)
    expect(
      excerpt(['Agenda', 'Risk is calculable for insurers and banks alike'], 'calculable risk'),
    ).toBe('Risk is calculable for insurers and banks alike')
  })
})

describe('card ids', () => {
  it('are built from lecture, concept, role and a counter', () => {
    expect(cardId(2, 'bird-in-hand', 'reverse', 1)).toBe('02-bird-in-hand-reverse-1')
    expect(cardId(2, 'bird-in-hand', 'reverse', 2)).not.toBe(
      cardId(2, 'bird-in-hand', 'reverse', 1),
    )
    expect(cardId(3, 'bird-in-hand', 'reverse', 1)).not.toBe(
      cardId(2, 'bird-in-hand', 'reverse', 1),
    )
  })

  it('survive rewording: the same placement gives the same id for any wording', () => {
    const before = assemble(draft({}), place)
    const after = assemble(
      draft({ front: 'Start with your means: which principle?', extra: 'Sarasvathy.' }),
      place,
    )
    expect(after.fields.Front).not.toBe(before.fields.Front)
    expect(after.id).toBe(before.id)
  })
})

describe('text helpers', () => {
  it('slug', () => {
    expect(slug('Bird in hand')).toBe('bird-in-hand')
    expect(slug('  Bellman-Ford (1958) ')).toBe('bellman-ford-1958')
    expect(slug('Café crème')).toBe('cafe-creme')
    expect(slug('Риск Неопределённость')).toBe('риск-неопределённость')
    expect(slug('α-Fehler')).toBe('α-fehler')
  })

  it('conceptId keeps symbols apart, and the same name the same id', () => {
    const ids = ['C', 'C++', 'C#', 'p < 0.05', 'p > 0.05', 'α-Fehler', 'β-Fehler', 'Σ'].map(
      conceptId,
    )
    expect(new Set(ids).size).toBe(ids.length)
    expect(conceptId('  c++ ')).toBe(conceptId('C++'))
    expect(conceptId('Bird in hand')).toBe('bird-in-hand')
    expect(conceptId('++')).toMatch(/^[0-9a-f]{6}$/)
    for (const id of ids) expect(id).not.toMatch(/\s/)
  })

  it('words counts prose with a bare < or > and skips tags', () => {
    expect(words('Why is x < 5 and y > 3 here')).toBe(10)
    expect(words('Why is <sub>x</sub> ==small==')).toBe(4)
  })

  it('slideRange', () => {
    expect(slideRange([4])).toBe('slide 4')
    expect(slideRange([3, 1, 2, 7])).toBe('slides 1 to 3 and 7')
    expect(slideRange([1, 3, 5, 6])).toBe('slides 1, 3 and 5 to 6')
  })
})
