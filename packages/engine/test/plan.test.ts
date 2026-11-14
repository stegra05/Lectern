import { describe, expect, it } from 'vitest'
import { findClashes, similarity } from '../src/clash.ts'
import { CAP_FLOOR_USD, CAP_MULTIPLE, estimate } from '../src/cost.ts'
import type { Concept, Topic } from '../src/course.ts'
import type { FactKind } from '../src/decide.ts'
import { plan } from '../src/plan.ts'
import { validateDraft } from '../src/cards/validate.ts'
import type { Role } from '../src/cards/roles.ts'
import { presetFor, PRESETS } from '../src/presets.ts'
import { slotsFromForm } from '../src/writer.ts'

const preset = presetFor('concept')
const concept = (name: string, kinds: FactKind[], extra: Partial<Concept> = {}): Concept => ({
  id: name,
  name,
  slides: [2],
  core: true,
  facts: kinds.map((kind, i) => ({ text: `${name} fact ${i + 1}`, slide: 2, kind })),
  ...extra,
})
const topics = (...concepts: Concept[]): Topic[] => [{ name: 'T', concepts }]
const shape = (result: ReturnType<typeof plan>) =>
  result.slots.map((s) => `${s.fact.text}: ${s.role}`)

describe('the plan: code decides how many cards exist and what shape they take', () => {
  const all = topics(
    concept('risk', ['definition', 'definition', 'case', 'definition', 'contrast', 'list']),
    concept('loop', ['sequence', 'formula', 'code', 'diagram'], { core: false }),
  )

  it('pass: the core concepts, one card each', () => {
    const result = plan(all, 'pass', preset)
    expect(shape(result)).toEqual(['risk fact 1: definition'])
    expect(result.outsideCore.map((c) => c.name)).toEqual(['loop'])
  })

  it('good grade: every concept, two facts each', () => {
    const result = plan(all, 'good', preset)
    expect(shape(result)).toEqual([
      'risk fact 1: definition',
      'risk fact 2: reverse',
      'loop fact 1: chain',
      'loop fact 2: formula',
    ])
    expect(result.outsideCore).toEqual([])
  })

  it('top grade: four facts each, plus every case and contrast', () => {
    expect(shape(plan(all, 'top', preset))).toEqual([
      'risk fact 1: definition',
      'risk fact 2: reverse',
      'risk fact 3: case',
      'risk fact 4: definition',
      'risk fact 5: contrast',
      'loop fact 1: chain',
      'loop fact 2: formula',
      'loop fact 3: code',
      'loop fact 4: diagram',
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
    const result = plan(topics(...kinds.map((kind) => concept(kind, [kind]))), 'good', preset)
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
    expect(plan(topics(lists), 'top', preset).slots.map((s) => s.role)).toEqual([
      'name-two',
      'cloze-list',
      'cloze-list',
    ])
  })

  it('turns a cause into a "why" card', () => {
    expect(shape(plan(topics(concept('copyright', ['cause'])), 'good', preset))).toEqual([
      'copyright fact 1: why',
    ])
  })

  it('gives a concept that comes up again one more card, whatever the goal', () => {
    const again = topics(concept('risk', ['definition', 'definition', 'case'], { since: 1 }))
    expect(shape(plan(again, 'top', preset))).toEqual(['risk fact 1: definition'])
  })
})

describe('clashes', () => {
  const existing = [{ id: 'a', text: 'Knight (1921): what is risk?' }]

  it('finds a new card that asks an existing question word for word', () => {
    const fresh = [{ id: 'b', text: 'Knight (1921) - what is RISK?' }]
    expect(findClashes(existing, fresh)).toEqual({ same: [['b', 'a']], alike: [] })
  })

  it('finds new cards that look like a card before them, also among themselves', () => {
    const fresh = [
      { id: 'b', text: 'Knight (1921): what is uncertainty?' },
      { id: 'c', text: 'Which step follows build?' },
      { id: 'd', text: 'Which step follows measure?' },
    ]
    expect(findClashes(existing, fresh)).toEqual({
      same: [],
      alike: [
        ['b', 'a'],
        ['d', 'c'],
      ],
    })
  })

  it('never names an existing card as the one that clashes', () => {
    const twice = [...existing, { id: 'a2', text: 'Knight (1921): what is risk?' }]
    expect(findClashes(twice, [])).toEqual({ same: [], alike: [] })
  })

  it('compares names by the words they share', () => {
    expect(similarity('entrepreneurial risk', 'risk')).toBe(0.5)
    expect(similarity('bird in hand', 'affordable loss')).toBe(0)
  })
})

describe('the estimate', () => {
  const prices = {
    model: { input: 0.1, cachedInput: 0.01, output: 0.5 },
    decisions: { input: 0.1 },
  }
  const decks = Array.from({ length: 11 }, () => ({ chars: 12_800, slides: 32, images: 2 }))

  it('grows with the goal and stays in cents for a course on a cheap model', () => {
    const [pass, good, top] = (['pass', 'good', 'top'] as const).map((goal) =>
      estimate(decks, goal, prices),
    )
    expect(good).toMatchObject({ lectures: 11, slides: 352, cards: 561 })
    expect(pass!.cards).toBe(187)
    expect(top!.cards).toBe(671)
    expect(pass!.costUsd).toBeLessThan(good!.costUsd)
    expect(good!.costUsd).toBeLessThan(top!.costUsd)
    expect(good!.costUsd).toBeGreaterThan(0.05)
    expect(good!.costUsd).toBeLessThan(0.5)
  })

  it('sets the cap at three times the estimate, and never under 25 cents', () => {
    const big = estimate(decks, 'top', {
      ...prices,
      model: { input: 2, cachedInput: 0.2, output: 10 },
    })
    expect(big.capUsd).toBeCloseTo(CAP_MULTIPLE * big.costUsd)
    expect(estimate(decks.slice(0, 1), 'pass', prices).capUsd).toBe(CAP_FLOOR_USD)
  })
})

describe('presets', () => {
  it.each(Object.values(PRESETS))(
    '$id: every example card fits its form and the hard limits',
    (preset) => {
      const source = { slides: [1], slideText: () => '', seenAsImage: () => true }
      for (const [role, values] of Object.entries(preset.examples)) {
        const draft = { concept: 'example', role, slide: 1, ...slotsFromForm(role as Role, values) }
        expect(validateDraft(draft, source), `${preset.id} ${role}`).toEqual([])
      }
    },
  )

  it('covers every kind of fact with a card type', () => {
    for (const preset of Object.values(PRESETS)) {
      expect(Object.values(preset.plan).every((roles) => roles.length > 0)).toBe(true)
    }
  })
})
