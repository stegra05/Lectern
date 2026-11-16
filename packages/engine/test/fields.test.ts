import { describe, expect, it } from 'vitest'
import { assemble } from '../src/cards/assemble.ts'
import { toCard } from '../src/cards/card.ts'
import { cardFields } from '../src/cards/fields.ts'
import type { Draft, Role } from '../src/cards/roles.ts'
import { fromDraft } from '../src/cards/slots.ts'

const lines = [
  'Bird in hand',
  'Start from who you are, what you know and whom you know',
  'Expected return versus affordable loss & <risk>',
]
const place = {
  id: '02-bird-in-hand-x-1',
  lecture: { number: 2, title: 'Effectuation & <co>' },
  concept: { id: 'bird-in-hand', name: 'bird in hand < means' },
  slideLines: lines,
}

/** One checked draft of every role, written as the model writes them, with marks and markup. */
const DRAFTS: (Partial<Draft> & { role: Role })[] = [
  {
    role: 'definition',
    front: 'What is risk, with \\( p < 1 \\)?',
    answers: ['An outcome whose odds ==can be calculated== & H<sub>2</sub>O.'],
    extra: 'Knight, 1921: x<sup>2</sup> & <more>.',
  },
  { role: 'reverse', answers: ['Bird in hand.'] },
  { role: 'reverse', answers: ['Bird in hand .'] },
  { role: 'reverse', answers: ['==Bird in hand=='] },
  {
    role: 'contrast',
    labels: ['Causation', 'Effectuation & co'],
    answers: ['==expected return==, the best', 'affordable loss < all'],
  },
  {
    role: 'chain',
    labels: ['Segments', 'Value propositions'],
    answers: ['Channels', '==Relationships=='],
  },
  { role: 'name-two', answers: ['==Bird== in hand', 'Affordable loss'] },
  { role: 'why', answers: ['It protects ==the code, not the idea==.'] },
  { role: 'why', answers: ['It protects ==the code==.', 'So the idea can be rebuilt.'] },
  { role: 'case', answers: ['Hairdresser shop.'] },
  {
    role: 'formula',
    answers: ['|<u,v>| \\le \\|u\\|\\|v\\|', 'Equality when u, v are ==linearly dependent==.'],
  },
  {
    role: 'code',
    front: 'What does this return?',
    labels: ['Returns', 'Time'],
    answers: ['the index or -1', 'O(log n) & <fast>'],
    code: 'if xs[mid] < target:\n    lo = mid + 1\n\n',
  },
  { role: 'diagram', front: 'Draw the lean loop.', answers: ['It ==repeats== quickly.'] },
  {
    role: 'cloze',
    front: 'Start from {{c1::who you are}} & {{c2::what you know}}, then <act>.',
    answers: [],
  },
  {
    role: 'cloze-list',
    front: 'The five Cs & co:',
    answers: ['character', '==capacity== to pay', 'capital'],
  },
]

const draft = (over: Partial<Draft>): Draft => ({
  concept: 'bird in hand',
  role: 'definition',
  slide: 3,
  front: 'Which effectual principle says to start from who you are?',
  answers: [],
  labels: [],
  extra: '',
  code: '',
  ...over,
})

const EXAMS = [undefined, { papers: 3, fromSlides: true }, { papers: 1, fromSlides: false }]

describe('cardFields', () => {
  it('covers every role', () => {
    expect(new Set(DRAFTS.map((d) => d.role)).size).toBe(12)
  })

  // The proof that storing slots changes nothing in Anki: for every role, and for a card from
  // the slides and from past exams, the fields built from the stored card are byte for byte the
  // fields `assemble` stored before.
  for (const over of DRAFTS) {
    for (const exam of EXAMS) {
      it(`gives the fields assemble gave: ${over.role} ${over.answers?.[0] ?? ''} ${exam ? `exam ${exam.fromSlides}` : ''}`, () => {
        const d = draft(over)
        const at = { ...place, ...(exam ? { exam } : {}) }
        const before = assemble(d, at).fields
        const after = cardFields(toCard(fromDraft(d), { ...at, slide: d.slide }))
        expect(JSON.stringify(after)).toBe(JSON.stringify(before))
      })
    }
  }
})
