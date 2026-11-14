import { describe, expect, it } from 'vitest'
import { ROLE_SPECS, type Draft } from '../src/cards/roles.ts'
import { isYesNo, validateDraft, type Source } from '../src/cards/validate.ts'

const slides: Record<number, string> = {
  14: 'Risk (Knight 1921)\nAn outcome whose probability can be calculated or known',
  20: 'Effectual principles\nBird in hand\nAffordable loss\nCrazy quilt\nLemonade\nPilot in the plane',
  25: 'Causation: expected return\nEffectuation: affordable loss',
}
const source: Source = { slides: [14, 20, 25], slideText: (n) => slides[n] }

const draft = (over: Partial<Draft>): Draft => ({
  concept: 'risk',
  role: 'definition',
  slide: 14,
  front: 'Knight (1921): what is risk?',
  answers: ['An outcome whose ==probability can be calculated or known==.'],
  labels: [],
  extra: '',
  ...over,
})
const problems = (over: Partial<Draft>) => validateDraft(draft(over), source)
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

describe('a draft that follows the rules', () => {
  it.each<[string, Partial<Draft>]>([
    ['definition', {}],
    [
      'reverse',
      { role: 'reverse', front: 'Which outcome has a known probability?', answers: ['risk'] },
    ],
    [
      'contrast',
      {
        role: 'contrast',
        slide: 25,
        front: 'Causation versus effectuation: how does each handle risk?',
        labels: ['Causation', 'Effectuation'],
        answers: ['expected return', 'affordable loss'],
      },
    ],
    [
      'chain',
      {
        role: 'chain',
        slide: 20,
        front: 'Effectual principles: which two follow bird in hand?',
        labels: ['Bird in hand'],
        answers: ['Affordable loss', 'Crazy quilt'],
      },
    ],
    [
      'name-two',
      {
        role: 'name-two',
        slide: 20,
        front: 'Name two effectual principles.',
        answers: ['Lemonade', 'Crazy quilt'],
      },
    ],
    [
      'why',
      {
        role: 'why',
        front: 'Why can risk be insured?',
        answers: ['Its ==probability== can be calculated.', 'So a premium can be priced.'],
      },
    ],
    [
      'case',
      {
        role: 'case',
        front: 'Opening a hairdresser shop: which kind of outcome?',
        answers: ['risk'],
      },
    ],
    [
      'formula',
      {
        role: 'formula',
        front: 'State the expected value of X.',
        answers: ['E[X] = \\sum_i p_i x_i', 'For a discrete X.'],
      },
    ],
    [
      'cloze',
      {
        role: 'cloze',
        front: 'Risk is an outcome whose {{c1::probability}} can be {{c2::calculated}}.',
        answers: [],
      },
    ],
    [
      'cloze-list',
      {
        role: 'cloze-list',
        slide: 20,
        front: "Sarasvathy's effectual principles:",
        answers: [
          'bird in hand',
          'affordable loss',
          'crazy quilt',
          'lemonade',
          'pilot in the plane',
        ],
      },
    ],
  ])('passes as %s', (_, over) => {
    expect(problems(over)).toEqual([])
  })
})

describe('hard limits', () => {
  it('allows a front of 20 words and rejects 21', () => {
    expect(problems({ front: `What ${words(19)}` })).toEqual([])
    expect(problems({ front: `What ${words(20)}` })).toEqual([
      'front has 21 words; the limit is 20',
    ])
  })

  it('allows an answer of 25 words and rejects 26', () => {
    expect(problems({ answers: [`==probability== ${words(24)}`] })).toEqual([])
    expect(problems({ answers: [`==probability== ${words(25)}`] })).toEqual([
      'the answer has 26 words; the limit is 25',
    ])
  })

  it('counts the words of all bullets together', () => {
    const over = { role: 'why', answers: [`probability ${words(13)}`, words(13)] }
    expect(problems(over)).toEqual(['the answer has 27 words; the limit is 25'])
  })

  it('rejects more than 2 bullets', () => {
    const over = {
      role: 'name-two',
      slide: 20,
      answers: ['Lemonade', 'Crazy quilt', 'Bird in hand'],
    }
    expect(problems(over)).toEqual([
      'this role takes exactly 2 answers, got 3',
      'the answer has 3 bullets; the limit is 2',
    ])
    const chain = {
      role: 'chain',
      slide: 20,
      labels: ['Bird in hand'],
      answers: ['Lemonade', 'Crazy quilt', 'Pilot'],
    }
    expect(problems(chain)).toContain('the answer has 3 bullets; the limit is 2')
  })

  it('rejects an extra of more than 40 words', () => {
    expect(problems({ extra: words(40) })).toEqual([])
    expect(problems({ extra: words(41) })).toEqual(['extra has 41 words; the limit is 40'])
  })

  it('does not count marks, tags or cloze wrappers as words', () => {
    expect(problems({ front: `What is H<sub>2</sub>O ${words(17)}` })).toEqual([])
  })
})

describe('yes/no questions', () => {
  it.each([
    'Is risk calculable?',
    'Does Knight define risk?',
    'Can risk be insured?',
    '"Are" risks known?',
    'Ist Risiko berechenbar?',
  ])('rejects %s', (front) => {
    expect(isYesNo(front)).toBe(true)
    expect(problems({ front })).toContain('front is a yes/no question; ask what, which, why or how')
  })

  it.each([
    'What is risk?',
    'Which outcome is calculable?',
    'Why is risk insurable?',
    'Was ist Risiko?',
    'Knight: what is risk?',
  ])('allows %s', (front) => expect(isYesNo(front)).toBe(false))
})

describe('roles', () => {
  it('rejects a role outside the closed set', () => {
    expect(problems({ role: 'essay' })[0]).toMatch(
      /^role "essay" does not exist; use one of: definition, reverse/,
    )
  })

  it('rejects roles that are in the field contract but not built yet', () => {
    expect(problems({ role: 'diagram' })).toHaveLength(1)
    expect(problems({ role: 'code' })).toHaveLength(1)
  })

  it('rejects an answer that does not have the shape the role promises', () => {
    const contrast = { role: 'contrast', slide: 25, labels: ['Causation', 'Effectuation'] }
    expect(problems({ ...contrast, answers: ['expected return versus affordable loss'] })).toEqual([
      'this role takes exactly 2 answers, got 1',
    ])
    expect(
      problems({ ...contrast, labels: [], answers: ['expected return', 'affordable loss'] }),
    ).toEqual(['this role takes exactly 2 labels, got 0'])
    expect(problems({ labels: ['Risk'] })).toEqual(['this role takes none labels, got 1'])
  })

  it('requires the key term mark in a definition', () => {
    expect(problems({ answers: ['An outcome whose probability can be calculated.'] })).toEqual([
      'wrap the key term of the answer as ==term==',
    ])
    expect(problems({ answers: ['An ==outcome== whose ==probability== is known.'] })).toEqual([
      'mark at most one key term per answer, as ==term==',
    ])
  })

  it('keeps a term answer to one term', () => {
    const over = { role: 'reverse', answers: ['the risk that an outcome is calculable'] }
    expect(problems(over)).toEqual(['the answer must be one term of at most 5 words'])
  })

  it('limits slot labels to 4 words and a card to 6 slots', () => {
    const contrast = {
      role: 'contrast',
      slide: 25,
      answers: ['expected return', 'affordable loss'],
    }
    expect(
      problems({ ...contrast, labels: ['Causation as taught in class', 'Effectuation'] }),
    ).toEqual(['a label has more than 4 words'])
    const chain = { role: 'chain', slide: 20, labels: ['A', 'B', 'C', 'D'], answers: ['Lemonade'] }
    expect(problems(chain)).toEqual([])
    expect(problems({ ...chain, labels: ['A', 'B', 'C', 'D', 'E'] })).toEqual([
      'this role takes 1 to 4 labels, got 5',
    ])
    // The role table itself keeps every card within the 6 slots of the field contract.
    for (const [role, spec] of Object.entries(ROLE_SPECS)) {
      expect(spec.labels[1] + (role === 'chain' ? spec.answers[1] : 0)).toBeLessThanOrEqual(6)
      if (spec.back === 'list') expect(spec.answers[1]).toBeLessThanOrEqual(2)
    }
  })

  it('rejects markup written by the model', () => {
    expect(problems({ front: 'What is <b>risk</b>?' })).toEqual([
      'no HTML tags except <sub> and <sup>',
    ])
    expect(problems({ answers: ['An outcome with **known** ==probability==.'] })).toEqual([
      'no Markdown; mark the key term as ==term==',
    ])
    expect(problems({ answers: ['An outcome\nwith known ==probability==.'] })).toEqual([
      'no line breaks; one slot holds one line',
    ])
    expect(problems({ extra: 'With $p_i$ known.' })).toEqual([
      'write inline maths as \\( \\), not with $',
    ])
    expect(problems({ front: 'What is {{c1::risk}}?' })).toEqual([
      'cloze deletions belong to the roles cloze and cloze-list',
    ])
  })
})

describe('cloze rules', () => {
  const cloze = (front: string) => problems({ role: 'cloze', front, answers: [] })

  it('needs a deletion', () => {
    expect(cloze('Risk is an outcome whose probability can be calculated.')).toEqual([
      'a cloze needs at least one deletion written as {{c1::item}}',
    ])
  })

  it('allows 5 deletions and rejects 6', () => {
    const text = (n: number) =>
      `The probability list is ${Array.from({ length: n }, (_, i) => `{{c${i + 1}::probability ${i}}}`).join(', ')}.`
    expect(cloze(text(5))).toEqual([])
    expect(cloze(text(6))).toEqual(['the cloze has 6 deletions; the limit is 5'])
  })

  it('hides one item per deletion: each number once, counted from 1', () => {
    const message = 'number the deletions c1, c2, c3 in order and use each number once'
    expect(cloze('Risk has a {{c1::probability}} that is {{c1::calculated}}.')).toEqual([message])
    expect(cloze('Risk has a {{c2::probability}} that is known.')).toEqual([message])
  })

  it('allows a deletion of 8 words and rejects 9', () => {
    expect(cloze(`Risk is an outcome whose {{c1::probability ${words(7)}}}.`)).toEqual([])
    expect(cloze(`Risk is an outcome whose {{c1::probability ${words(8)}}}.`)).toHaveLength(1)
  })

  it('rejects hints, empty and unclosed deletions', () => {
    expect(cloze('Risk has a {{c1::probability::a number}} that is known.')).toEqual([
      'no hints inside a deletion; write {{c1::item}}',
    ])
    expect(cloze('Risk has a {{c1::}} that is known.')).toContain('a deletion is empty')
    expect(cloze('Risk has a {{c1::probability}} and a {{c2::value that is known.')).toContain(
      'a deletion is not closed properly; write {{c1::item}}',
    )
  })

  it('needs a sentence around the deletions', () => {
    expect(cloze('{{c1::probability}} known')).toEqual([
      'the sentence around the deletions is too short to be a cue',
    ])
  })

  it('checks the items of a cloze list', () => {
    const list = { role: 'cloze-list', slide: 20, front: 'The effectual principles:' }
    expect(problems({ ...list, answers: ['bird in hand'] })).toEqual([
      'this role takes 2 to 5 answers, got 1',
    ])
    expect(problems({ ...list, answers: ['{{c1::bird in hand}}', 'lemonade'] })).toEqual([
      'write the list items as plain text; code adds the deletions',
    ])
    expect(problems({ ...list, answers: ['lemonade', `bird in hand ${words(6)}`] })).toHaveLength(1)
  })
})

describe('provenance', () => {
  it('rejects a slide that does not belong to the concept', () => {
    expect(problems({ slide: 99 })).toEqual([
      'slide 99 is not a slide of this concept; use one of: 14, 20, 25',
    ])
  })

  it('rejects an answer with no term on the cited slide', () => {
    expect(problems({ answers: ['A ==venture== without customers.'] })).toEqual([
      'no term of the answer appears on slide 14; answer from the slide text',
    ])
  })
})
