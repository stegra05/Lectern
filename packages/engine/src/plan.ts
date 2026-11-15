/**
 * Code plans the cards. The model never decides how many cards exist or what shape they
 * take: the goal says how many the lectures of a build get, the worth of a fact says which
 * facts, answers to past exam questions before all others, the kind of a fact and the preset
 * say which card type. Pure.
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

/** How many cards lectures with this many slides get at most. */
export function budget(goal: Goal, slides: number): number {
  return Math.ceil(GOAL_PRESETS[goal].cardsPerSlide * slides)
}

const worth = (fact: Fact) => fact.worth ?? WORTH_UNKNOWN
/** How many past papers asked what the fact answers: 0 for a fact from the slides alone. */
const asked = (fact: Fact) => fact.exam?.papers ?? 0

/**
 * One plan per lecture, for all lectures of a build at once. The goal's cards are shared out
 * over the whole build and not lecture by lecture: slides are a poor measure of what one
 * lecture holds. Measured on 2026-11-15 on a full Entrepreneurship run, a budget per lecture
 * gave one lecture 173 cards for its 140 facts and cut 63 of the 107 facts of another; shared
 * out over the course, the same 584 cards covered 227 notes of the reference deck, not 211.
 */
export function plan(
  lectures: { topics: Topic[]; slides: number }[],
  goal: Goal,
  preset: Preset,
): Plan[] {
  const concepts = lectures.map((lecture) => lecture.topics.flatMap((topic) => topic.concepts))
  // A concept an earlier lecture introduced already has its cards there. Its best fact gets one
  // more card whatever the goal, outside the budget. Its other exam answers still compete.
  const recurring = new Set<Fact>()
  const candidates: Fact[] = []
  for (const concept of concepts.flat()) {
    if (concept.since === undefined) {
      candidates.push(...concept.facts)
      continue
    }
    const best = [...concept.facts]
      .sort((a, b) => asked(b) - asked(a) || worth(b) - worth(a))
      .slice(0, RECURRING_CARDS)
    for (const fact of best) recurring.add(fact)
    candidates.push(...concept.facts.filter((fact) => fact.exam && !recurring.has(fact)))
  }
  // Answers to past exam questions first, the most often asked first. Then the facts worth
  // most, as many as the goal allows. Equal worth keeps the order of the map.
  const allowed = budget(
    goal,
    lectures.reduce((sum, lecture) => sum + lecture.slides, 0),
  )
  const chosen = new Set(
    [...candidates]
      .map((fact, order) => ({ fact, order }))
      .sort(
        (a, b) =>
          asked(b.fact) - asked(a.fact) || worth(b.fact) - worth(a.fact) || a.order - b.order,
      )
      .slice(0, allowed)
      .map(({ fact }) => fact),
  )
  for (const fact of recurring) chosen.add(fact)

  return concepts.map((ofLecture) => {
    const slots: Slot[] = []
    const beyondGoal: Concept[] = []
    for (const concept of ofLecture) {
      const facts = concept.facts.filter((fact) => chosen.has(fact))
      if (facts.length === 0) beyondGoal.push(concept)
      const seen = new Map<string, number>()
      for (const fact of facts) {
        const roles = preset.plan[fact.kind]
        // An exam answer takes the first card type of its kind and leaves the turns of the
        // concept's other facts as they are.
        const turn = fact.exam ? 0 : (seen.get(fact.kind) ?? 0)
        if (!fact.exam) seen.set(fact.kind, turn + 1)
        // A list of exactly two is asked as "name two", not recited item by item.
        const role =
          fact.kind === 'list' && fact.items === 2 ? 'name-two' : roles[turn % roles.length]!
        slots.push({ concept, fact, role })
      }
    }
    return { slots, beyondGoal }
  })
}
