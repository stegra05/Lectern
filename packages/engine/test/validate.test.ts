import { describe, expect, it } from 'vitest'
import { ROLE_SPECS, type Diagram, type Draft } from '../src/cards/roles.ts'
import {
  copiedRun,
  groundedByRule,
  isYesNo,
  leansOnSlides,
  saysNothing,
  tooLong,
  validateDiagram,
  validateDraft,
  type Source,
} from '../src/cards/validate.ts'

const slides: Record<number, string> = {
  14: 'Risk (Knight 1921)\nAn outcome whose probability can be calculated or known',
  20: 'Effectual principles\nBird in hand\nAffordable loss\nCrazy quilt\nLemonade\nPilot in the plane',
  25: 'Causation: expected return\nEffectuation: affordable loss',
}
const source: Source = {
  slides: [14, 20, 25, 30],
  slideText: (n) => slides[n],
  seenAsImage: (n) => n === 30,
}

const draft = (over: Partial<Draft>): Draft => ({
  concept: 'risk',
  role: 'definition',
  slide: 14,
  front: 'Knight (1921): what is risk?',
  answers: ['An outcome whose ==probability can be calculated or known==.'],
  labels: [],
  extra: '',
  code: '',
  diagram: null,
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
      'why in one sentence',
      {
        role: 'why',
        front: 'Why can risk be insured?',
        answers: ['Its ==probability== can be calculated.'],
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
      'slide 99 is not a slide of this concept; use one of: 14, 20, 25, 30',
    ])
  })
})

describe('code cards', () => {
  const listing = 'def find(xs, target):\n    lo, hi = 0, len(xs) - 1\n    return -1'
  const code = (over: Partial<Draft> = {}) =>
    problems({
      role: 'code',
      slide: 40,
      front: 'What does this function return, and in what time?',
      labels: ['Returns', 'Time'],
      answers: ['the index of target or -1', 'O(log n)'],
      code: listing,
      ...over,
    })
  const withCode: Source = {
    slides: [40, 41],
    slideText: (n) =>
      n === 40
        ? 'Binary search\ndef find(xs, target):\nlo, hi = 0, len(xs) - 1\nreturn -1'
        : undefined,
    seenAsImage: (n) => n === 41,
  }
  const check = (over: Partial<Draft> = {}) =>
    validateDraft(
      draft({
        role: 'code',
        slide: 40,
        front: 'What does this return?',
        labels: ['Returns'],
        answers: ['the index or -1'],
        code: listing,
        ...over,
      }),
      withCode,
    )

  it('pass with a listing copied from the slide, indentation aside', () => {
    expect(check()).toEqual([])
  })

  it('need the listing, and only they may have one', () => {
    expect(check({ code: '' })).toEqual(['a code card needs the listing in the code slot'])
    expect(problems({ code: 'x = 1' })).toEqual([
      'only the role code takes a listing; leave code empty',
    ])
  })

  it('reject a listing that is not on the slide', () => {
    expect(check({ code: 'while True:\n    pass' })).toEqual([
      'copy the listing from slide 40 line by line; a line is not on the slide',
    ])
    expect(check({ slide: 41, code: 'while True:\n    pass' })).toEqual([])
  })

  it('limit the listing to 16 lines of 60 characters', () => {
    const lines = (n: number) => Array.from({ length: n }, () => 'return -1').join('\n')
    expect(check({ code: lines(16) })).toEqual([])
    expect(check({ code: lines(17) })).toEqual(['the listing has 17 lines; the limit is 16'])
    expect(check({ slide: 41, code: 'x'.repeat(61) })).toEqual([
      'a line of the listing has more than 60 characters',
    ])
  })

  it('need one label per answer', () => {
    expect(code()).toContain('slide 40 is not a slide of this concept; use one of: 14, 20, 25, 30')
    expect(check({ labels: ['Returns', 'Time'] })).toEqual([
      'give one label per answer: 2 labels, 1 answers',
    ])
  })
})

describe('diagram cards', () => {
  const matrix: Diagram = {
    type: 'matrix',
    columns: ['Weak appropriability', 'Tight appropriability'],
    rows: ['Assets free', 'Assets held'],
    cells: ['Imitators win', 'Innovator wins', 'Asset holders win', 'Innovator wins'],
    key: [2],
  }
  const diagram = (over: Partial<Draft> = {}) =>
    problems({
      role: 'diagram',
      front: 'Draw the Teece matrix.',
      answers: ['It shows who captures the ==probability== of profit.'],
      diagram: matrix,
      ...over,
    })

  it('pass with a matrix, a sequence or a cycle', () => {
    expect(diagram()).toEqual([])
    expect(
      validateDiagram({
        type: 'cycle',
        columns: [],
        rows: [],
        cells: ['Build', 'Measure', 'Learn'],
        key: [1],
      }),
    ).toEqual([])
    expect(
      validateDiagram({
        type: 'sequence',
        columns: [],
        rows: [],
        cells: ['Seed', 'Series A'],
        key: [0, 1],
      }),
    ).toEqual([])
  })

  it('need the drawing, and only they may have one', () => {
    expect(diagram({ diagram: null })).toEqual(['a diagram card needs the diagram slot'])
    expect(problems({ diagram: matrix })).toEqual([
      'only the role diagram takes a diagram; leave the slot null',
    ])
  })

  it('reject a type outside the closed set', () => {
    expect(validateDiagram({ ...matrix, type: 'mindmap' as 'matrix' })).toEqual([
      'diagram type "mindmap" does not exist; use one of: matrix, sequence, cycle',
    ])
  })

  it('check that the cells fill the matrix', () => {
    expect(validateDiagram({ ...matrix, cells: matrix.cells.slice(0, 3) })).toEqual(
      [
        'a matrix of 2 rows and 2 columns takes 4 cells, got 3',
        'key lists the cells that answer the question: at least one index into cells, each once',
      ].slice(0, 1),
    )
    expect(validateDiagram({ ...matrix, rows: [] })).toEqual([
      'a matrix takes 1 to 4 column labels and 1 to 4 row labels',
    ])
  })

  it('limit a sequence to 8 steps without axis labels', () => {
    const steps = (n: number) => Array.from({ length: n }, (_, i) => `step ${i}`)
    expect(
      validateDiagram({ type: 'sequence', columns: [], rows: [], cells: steps(9), key: [0] }),
    ).toEqual(['a sequence takes 2 to 8 steps, got 9'])
    expect(
      validateDiagram({ type: 'cycle', columns: ['x'], rows: [], cells: steps(3), key: [0] }),
    ).toEqual(['a cycle has no column or row labels'])
  })

  it('keep labels short and the key inside the cells', () => {
    expect(
      validateDiagram({ ...matrix, cells: ['one two three four five', 'b', 'c', 'd'] }),
    ).toEqual(['a label of the diagram has more than 4 words'])
    const message =
      'key lists the cells that answer the question: at least one index into cells, each once'
    expect(validateDiagram({ ...matrix, key: [] })).toEqual([message])
    expect(validateDiagram({ ...matrix, key: [4] })).toEqual([message])
    expect(validateDiagram({ ...matrix, key: [1, 1] })).toEqual([message])
  })
})

describe('the free slide check', () => {
  const text = slides[14]!
  it('passes a card when at least half of its answer terms are on the slide', () => {
    expect(groundedByRule(draft({}), text)).toBe(true)
    expect(
      groundedByRule(draft({ answers: ['A ==probability== that insurers price.'] }), text),
    ).toBe(false)
    expect(groundedByRule(draft({ answers: ['A ==venture== without customers.'] }), text)).toBe(
      false,
    )
  })

  it('reads the hidden items of a cloze, and never settles a formula', () => {
    expect(
      groundedByRule(
        draft({
          role: 'cloze',
          front: 'Risk has a {{c1::probability}} that is known.',
          answers: [],
        }),
        text,
      ),
    ).toBe(true)
    expect(
      groundedByRule(
        draft({ role: 'formula', answers: ['p = 1', 'When the outcome is known.'] }),
        text,
      ),
    ).toBe(false)
  })
})

describe('too long', () => {
  it('is a card whose question or answer breaks a length limit', () => {
    expect(tooLong(draft({}))).toBe(false)
    expect(tooLong(draft({ front: `What ${words(20)}` }))).toBe(true)
    expect(tooLong(draft({ answers: [words(26)] }))).toBe(true)
    expect(tooLong(draft({ role: 'cloze-list', answers: ['a', 'b', 'c', 'd', 'e', 'f'] }))).toBe(
      true,
    )
    expect(
      tooLong(draft({ role: 'cloze', front: `Risk is {{c1::known}} ${words(45)}.`, answers: [] })),
    ).toBe(true)
  })

  it('is not a card with another kind of problem', () => {
    expect(tooLong(draft({ front: 'Is risk known?' }))).toBe(false)
    expect(tooLong(draft({ role: 'reverse', answers: ['one two three four five six'] }))).toBe(
      false,
    )
  })
})

describe('the copy check', () => {
  const slide = 'An outcome whose probability can be calculated or known by the decision maker'
  it('counts the longest run of slide words in a sentence', () => {
    expect(
      copiedRun(
        draft({
          answers: ['An outcome whose ==probability can be calculated== or known by anyone.'],
        }),
        slide,
      ),
    ).toBe(10)
    expect(
      copiedRun(draft({ answers: ['A result with a ==probability== one can work out.'] }), slide),
    ).toBe(1)
  })

  it('leaves terms and list items alone: they are meant to match the slide', () => {
    const items = [
      'an outcome whose probability can be calculated or known by the decision maker',
      'x',
    ]
    expect(copiedRun(draft({ role: 'name-two', answers: items }), slide)).toBe(0)
    expect(
      copiedRun(
        draft({
          role: 'cloze',
          front:
            'An outcome whose {{c1::probability}} can be calculated or known by the decision maker.',
          answers: [],
        }),
        slide,
      ),
    ).toBe(13)
  })
})

describe('a card that keeps every limit and says nothing', () => {
  const nothing = (over: Partial<Draft>) => saysNothing(draft(over))

  it('is not a matter of the limits: the shared validator lets it through', () => {
    const marked = {
      front: 'What is venture capital?',
      answers: ['==Venture capital== is a professionally managed pool of equity capital.'],
    }
    expect(problems(marked)).toEqual([])
    expect(nothing(marked)).toHaveLength(1)
  })

  it('rejects a term the question already contains', () => {
    const giveaway = {
      role: 'case',
      front: 'Kickstarter: for whom might it be a new financing source?',
      answers: ['Kickstarter'],
    }
    expect(nothing(giveaway)).toEqual([
      'the question already contains its answer "Kickstarter"; ask without naming it',
    ])
    // A word of the term in the question is fine; the whole term is not.
    const fine = {
      role: 'reverse',
      front: 'Which growth strategy sells new products to current customers?',
      answers: ['product development strategy'],
    }
    expect(nothing(fine)).toEqual([])
  })

  it('rejects a sentence that only turns the question around', () => {
    const circular = {
      front: 'What role does education play in an entrepreneur’s upbringing?',
      answers: ['==Education== is important in the upbringing of an entrepreneur.'],
    }
    expect(nothing(circular)).toEqual([
      'the answer only repeats the question; say what the slide adds',
    ])
    // One new word is an answer when it is the marked one. Numbers count as content.
    expect(
      nothing({
        front: 'What can clustering lead to?',
        answers: ['Clustering can lead to ==inequality==.'],
      }),
    ).toEqual([])
    expect(
      nothing({
        role: 'why',
        front: 'Why do most ventures fail within five years?',
        answers: ['50 to 80 percent fail.'],
      }),
    ).toEqual([])
  })

  it('rejects a mark on the term the question names', () => {
    const marked = {
      front: 'What is venture capital?',
      answers: ['==Venture capital== is a professionally managed pool of equity capital.'],
    }
    expect(nothing(marked)).toEqual([
      '"Venture capital" is marked but the question already names it; mark the words that answer the question',
    ])
    expect(
      nothing({
        front: 'What is venture capital?',
        answers: ['A ==professionally managed pool== of equity capital.'],
      }),
    ).toEqual([])
    // A mark of short words has no stems and is compared as a phrase.
    expect(
      nothing({
        front: 'Bird in hand: what does a founder start from?',
        answers: ['From ==who you are==, what you know and whom you know.'],
      }),
    ).toEqual([])
  })

  it('rejects a contrast whose side says nothing', () => {
    const contrast = { role: 'contrast', slide: 25, front: 'How do the furniture choices differ?' }
    expect(
      nothing({
        ...contrast,
        labels: ['Buying', 'Building'],
        answers: ['Buying furniture', 'Building it'],
      }),
    ).toEqual([
      'the value of "Buying" only repeats its label; say what holds for that side',
      'the value of "Building" only repeats its label; say what holds for that side',
    ])
    expect(
      nothing({
        ...contrast,
        front: 'Conceptual combination: how do outcomes differ when it is overdone?',
        labels: ['Overdone', 'Not overdone'],
        answers: ['some results are not useful', 'Not stated'],
      }),
    ).toEqual(['the side "Not overdone" has no value; a contrast needs what holds for each side'])
    expect(
      nothing({
        ...contrast,
        front: 'Which growth dimensions are not correlated?',
        labels: ['Revenue growth', 'Profit growth'],
        answers: ['not necessarily correlated', 'Not necessarily correlated'],
      }),
    ).toEqual(['both sides have the same value; a contrast needs two different values'])
    // A value may answer in the words of the question, as long as it is not its own label.
    expect(
      nothing({
        ...contrast,
        front: 'Debt versus equity financing: how do collateral requirements differ?',
        labels: ['Debt financing', 'Equity financing'],
        answers: ['requires collateral', 'requires no collateral'],
      }),
    ).toEqual([])
  })
})

describe('a question that leans on the slides', () => {
  const leans = (front: string, role = 'definition') => leansOnSlides(draft({ front, role }))

  it.each([
    'What does slide 16 invite students to do?',
    'What does the lecture prioritize first when generating ideas?',
    'Last session: what aspect of entrepreneurial intentions was covered?',
    'Today’s topics:',
    'What does the wrap-up say about basic growth strategies?',
    'Welche Begriffe nennt die Folie zur Relationenalgebra?',
  ])('sends back: %s', (front) => {
    expect(leans(front)).toEqual([
      'the question refers to the slides or the session; ask about the subject itself, so that the card stands without the slides',
    ])
  })

  it.each([
    'Knight (1921): what is risk?',
    'Which brainstorming session rule defers judgement?',
    'HIGGS case: what was the start-up trying to find?',
  ])('lets through: %s', (front) => {
    expect(leans(front)).toEqual([])
  })

  it('exempts a drawing, whose back shows the slide', () => {
    expect(leans('Draw the framework shown on the slide.', 'diagram')).toEqual([])
  })
})
