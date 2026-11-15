/**
 * Code plans the cards. The model never decides how many cards exist or what shape they
 * take: the goal says how many a lecture gets, the worth of a fact says which facts, the kind
 * of a fact and the preset say which card type. Pure.
 */

import { GOAL_PRESETS, RECURRING_CARDS, type Goal, type Role } from './cards/roles.ts'
import type { Concept, Fact, Topic } from './course.ts'
import { WORTH_UNKNOWN } from './decide.ts'
import type { Preset } from './presets.ts'

/** One card to be written: this fact of this concept, as this card type. */
export interface Slot {
  concept: Concept
  fact: Fact
  role: Role
}

export interface Plan {
  slots: Slot[]
  /** Concepts the goal leaves without cards. */
  beyondGoal: Concept[]
}

/** How many cards a lecture of this many slides gets at most. */
export function budget(goal: Goal, slides: number): number {
  return Math.ceil(GOAL_PRESETS[goal].cardsPerSlide * slides)
}

const worth = (fact: Fact) => fact.worth ?? WORTH_UNKNOWN

export function plan(topics: Topic[], slides: number, goal: Goal, preset: Preset): Plan {
  const concepts = topics.flatMap((topic) => topic.concepts)
  // A concept an earlier lecture introduced already has its cards there: only its best facts
  // stand for a card here.
  const candidates = concepts.flatMap((concept) => {
    const facts =
      concept.since !== undefined
        ? [...concept.facts].sort((a, b) => worth(b) - worth(a)).slice(0, RECURRING_CARDS)
        : concept.facts
    return facts.map((fact) => ({ concept, fact }))
  })
  // The facts worth most, as many as the goal allows. Equal worth keeps the order of the map.
  const chosen = new Set(
    candidates
      .map((candidate, order) => ({ ...candidate, order }))
      .sort((a, b) => worth(b.fact) - worth(a.fact) || a.order - b.order)
      .slice(0, budget(goal, slides))
      .map(({ fact }) => fact),
  )

  const slots: Slot[] = []
  const beyondGoal: Concept[] = []
  for (const concept of concepts) {
    const facts = concept.facts.filter((fact) => chosen.has(fact))
    if (facts.length === 0) beyondGoal.push(concept)
    const seen = new Map<string, number>()
    for (const fact of facts) {
      const roles = preset.plan[fact.kind]
      const turn = seen.get(fact.kind) ?? 0
      seen.set(fact.kind, turn + 1)
      // A list of exactly two is asked as "name two", not recited item by item.
      const role =
        fact.kind === 'list' && fact.items === 2 ? 'name-two' : roles[turn % roles.length]!
      slots.push({ concept, fact, role })
    }
  }
  return { slots, beyondGoal }
}
