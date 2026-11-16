import { describe, expect, it } from 'vitest'
import { findClashes } from '../src/clash.ts'
import { CAP_FLOOR_USD, CAP_MULTIPLE, estimate, shownEuros } from '../src/cost.ts'
import type { Concept, Topic } from '../src/course.ts'
import type { FactKind } from '../src/decide.ts'
import { budget, plan } from '../src/plan.ts'
import { validateDraft } from '../src/cards/validate.ts'
import type { Role } from '../src/cards/roles.ts'
import { CONCEPT } from '../src/presets.ts'
import { slotsFromForm } from '../src/writer.ts'

const preset = CONCEPT
const concept = (name: string, kinds: FactKind[], extra: Partial<Concept> = {}): Concept => ({
  id: name,
  name,
  slides: [2],
  facts: kinds.map((kind, i) => ({ text: `${name} fact ${i + 1}`, slide: 2, kind })),
  ...extra,
})
const topics = (...concepts: Concept[]): Topic[] => [{ name: 'T', concepts }]
const shape = (result: ReturnType<typeof plan>[number]) =>
  result.slots.map((s) => `${s.fact.text}: ${s.role}`)
/** Sets the worth of the facts of a concept, in their order. */
const worth = (c: Concept, ...values: number[]): Concept => {
  values.forEach((value, i) => (c.facts[i]!.worth = value))
  return c
}

describe('the plan: code decides how many cards exist and what shape they take', () => {
  const all = () =>
    topics(
      worth(concept('risk', ['definition', 'definition', 'case', 'contrast']), 3, 1.2, 2.4, 2.9),
      worth(concept('loop', ['sequence', 'formula']), 2.6, 0.4),
    )

  it('gives a lecture as many cards as its goal allows per slide, rounded up', () => {
    expect([budget('pass', 4), budget('good', 4), budget('top', 4)]).toEqual([2, 4, 8])
    expect(budget('top', 356)).toBe(641)
  })

  it('pass: the facts worth most, and says which concepts it left without a card', () => {
    const result = plan([{ topics: all(), slides: 4 }], 'pass', preset)[0]!
    expect(shape(result)).toEqual(['risk fact 1: definition', 'risk fact 4: contrast'])
    expect(result.beyondGoal.map((c) => c.name)).toEqual(['loop'])
  })

  it('good grade: more of them, still in the order of the map', () => {
    const result = plan([{ topics: all(), slides: 4 }], 'good', preset)[0]!
    expect(shape(result)).toEqual([
      'risk fact 1: definition',
      'risk fact 3: case',
      'risk fact 4: contrast',
      'loop fact 1: chain',
    ])
    expect(result.beyondGoal).toEqual([])
  })

  it('top grade: every fact when the lecture has fewer than the goal allows', () => {
    expect(plan([{ topics: all(), slides: 4 }], 'top', preset)[0]!.slots).toHaveLength(6)
  })

  it('shares the cards out over all lectures of a build, not lecture by lecture', () => {
    const thin = topics(worth(concept('a', ['definition', 'definition']), 1, 1))
    const dense = topics(worth(concept('b', ['definition', 'definition', 'definition']), 3, 3, 3))
    // Four slides each at "pass" allow four cards in all: three go to the dense lecture.
    const [first, second] = plan(
      [
        { topics: thin, slides: 4 },
        { topics: dense, slides: 4 },
      ],
      'pass',
      preset,
    )
    expect(first!.slots).toHaveLength(1)
    expect(second!.slots).toHaveLength(3)
  })

  it('keeps the order of the map among facts of equal worth, and counts no verdict as examinable', () => {
    const even = topics(
      concept('a', ['definition', 'definition']),
      worth(concept('b', ['definition']), 1),
      worth(concept('c', ['definition']), 2.5),
    )
    expect(shape(plan([{ topics: even, slides: 4 }], 'pass', preset)[0]!)).toEqual([
      'a fact 1: definition',
      'c fact 1: definition',
    ])
  })

  it('takes the card type from the kind of fact, in turn within a concept', () => {
    const kinds: FactKind[] = [
      'definition',
      'contrast',
      'list',
      'sequence',
      'formula',
      'code',
      'case',
      'diagram',
    ]
    const result = plan(
      [{ topics: topics(...kinds.map((kind) => concept(kind, [kind]))), slides: 8 }],
      'good',
      preset,
    )[0]!
    expect(result.slots.map((s) => s.role)).toEqual([
      'definition',
      'contrast',
      'cloze-list',
      'chain',
      'formula',
      'code',
      'case',
      'diagram',
    ])
  })

  it('asks a list of exactly two as "name two", and recites longer lists', () => {
    const lists = concept('exit', ['list', 'list', 'list'])
    lists.facts[0]!.items = 2
    lists.facts[1]!.items = 5
    expect(
      plan([{ topics: topics(lists), slides: 4 }], 'top', preset)[0]!.slots.map((s) => s.role),
    ).toEqual(['name-two', 'cloze-list', 'cloze-list'])
  })

  it('turns a cause into a "why" card', () => {
    expect(
      shape(
        plan([{ topics: topics(concept('copyright', ['cause'])), slides: 4 }], 'good', preset)[0]!,
      ),
    ).toEqual(['copyright fact 1: why'])
  })

  it('gives a concept that comes up again one more card, for its fact worth most', () => {
    const again = topics(
      worth(concept('risk', ['definition', 'definition', 'case'], { since: 1 }), 1, 3, 2),
    )
    expect(shape(plan([{ topics: again, slides: 4 }], 'top', preset)[0]!)).toEqual([
      'risk fact 2: definition',
    ])
  })

  it('gives a concept that comes up again its card even when the goal has no room left', () => {
    const again = concept('risk', ['definition'], { since: 1 })
    const others = [worth(concept('a', ['case', 'case', 'case', 'case']), 3, 3, 3, 3)]
    const result = plan([{ topics: topics(again, ...others), slides: 4 }], 'pass', preset)[0]!
    expect(shape(result)).toContain('risk fact 1: definition')
    expect(result.beyondGoal.map((c) => c.name)).toEqual([])
  })

  it('keeps every exam answer of a concept that comes up again, before facts worth more', () => {
    const exam = (papers: number) => ({ papers, question: 'Q?', fromSlides: true })
    const again = concept('risk', ['definition', 'definition', 'case'], { since: 1 })
    again.facts[0]!.exam = exam(2)
    again.facts[1]!.exam = exam(5)
    again.facts[2]!.worth = 3
    const rich = worth(concept('a', ['case', 'case']), 3, 3)
    const result = plan([{ topics: topics(rich, again), slides: 2 }], 'good', preset)[0]!
    expect(shape(result)).toEqual([
      'a fact 1: case',
      'risk fact 1: definition',
      'risk fact 2: definition',
    ])
  })
})

describe('clashes', () => {
  const existing = [{ id: 'a', text: 'Knight (1921): what is risk?' }]

  it('finds a new card that asks an existing question word for word', () => {
    const fresh = [{ id: 'b', text: 'Knight (1921) - what is RISK?' }]
    expect(findClashes(existing, fresh)).toEqual({ same: [['b', 'a']] })
  })

  it('never names an existing card as the one that clashes', () => {
    const twice = [...existing, { id: 'a2', text: 'Knight (1921): what is risk?' }]
    expect(findClashes(twice, [])).toEqual({ same: [] })
  })
})

describe('the estimate', () => {
  const prices = {
    model: { input: 0.1, cachedInput: 0.01, output: 0.5, fast: 2 },
    decisions: { input: 0.1 },
  }
  const decks = Array.from({ length: 11 }, () => ({ chars: 12_800, slides: 32, images: 2 }))

  it('grows with the goal and stays in cents for a course on a cheap model', () => {
    const [pass, good, top] = (['pass', 'good', 'top'] as const).map((goal) =>
      estimate(decks, goal, prices),
    )
    expect(good).toMatchObject({ lectures: 11, slides: 352, cards: 352 })
    expect(pass!.cards).toBe(176)
    expect(top!.cards).toBe(638)
    expect(pass!.costUsd).toBeLessThan(good!.costUsd)
    expect(good!.costUsd).toBeLessThan(top!.costUsd)
    expect(good!.costUsd).toBeGreaterThan(0.05)
    expect(good!.costUsd).toBeLessThan(0.5)
  })

  it('sets the cap at three times the estimate, and never under 25 cents', () => {
    const big = estimate(decks, 'top', {
      ...prices,
      model: { input: 2, cachedInput: 0.2, output: 10, fast: 2 },
    })
    expect(big.capUsd).toBeCloseTo(CAP_MULTIPLE * big.costUsd)
    expect(estimate(decks.slice(0, 1), 'pass', prices).capUsd).toBe(CAP_FLOOR_USD)
  })
})

describe('the estimate as the student sees it', () => {
  it('is in euros and rounded up to a step that grows with the amount', () => {
    // 0.9 euros per dollar. One lecture, a course, a long course, an expensive model.
    expect(shownEuros(0)).toBe(0)
    expect(shownEuros(0.02)).toBe(0.05)
    expect(shownEuros(0.19)).toBe(0.2)
    expect(shownEuros(0.25)).toBe(0.25)
    expect(shownEuros(0.6)).toBe(0.6)
    expect(shownEuros(0.7)).toBe(0.7)
    expect(shownEuros(0.75)).toBe(0.7)
    expect(shownEuros(1.3)).toBe(1.5)
    expect(shownEuros(4)).toBe(4)
  })

  it('travels with every estimate', () => {
    const decks = [{ chars: 12_800, slides: 32, images: 2 }]
    const prices = {
      model: { input: 0.1, cachedInput: 0.01, output: 0.5, fast: 2 },
      decisions: { input: 0.1 },
    }
    const one = estimate(decks, 'top', prices)
    expect(one.costEur).toBe(shownEuros(one.costUsd))
    expect(one.costEur).toBe(0.05)
  })
})

describe('the preset', () => {
  it('has every example card fit its form and the hard limits', () => {
    const source = { slides: [1], slideText: () => '', seenAsImage: () => true }
    for (const [role, values] of Object.entries(CONCEPT.examples)) {
      const draft = { concept: 'example', role, slide: 1, ...slotsFromForm(role as Role, values) }
      expect(validateDraft(draft, source), role).toEqual([])
    }
  })

  it('covers every kind of fact with a card type', () => {
    expect(Object.values(CONCEPT.plan).every((roles) => roles.length > 0)).toBe(true)
  })
})
