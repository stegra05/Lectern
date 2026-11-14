/**
 * Code plans the cards. The model never decides how many cards exist or what shape they
 * take: the goal says which concepts and how many facts, the kind of a fact and the preset
 * say which card type. Pure.
 */

import { GOAL_PRESETS, RECURRING_CARDS, type Goal, type Role } from './cards/roles.ts'
import type { Concept, Fact, Topic } from './course.ts'
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
  outsideCore: Concept[]
}

export function plan(topics: Topic[], goal: Goal, preset: Preset): Plan {
  const depth = GOAL_PRESETS[goal]
  const slots: Slot[] = []
  const outsideCore: Concept[] = []
  for (const concept of topics.flatMap((topic) => topic.concepts)) {
    if (depth.coverage === 'core' && !concept.core) {
      outsideCore.push(concept)
      continue
    }
    // A concept an earlier lecture introduced already has its cards there: it gets one more.
    const facts =
      concept.since !== undefined
        ? concept.facts.slice(0, RECURRING_CARDS)
        : concept.facts.filter((fact, i) => i < depth.facts || depth.always.includes(fact.kind))
    const seen = new Map<string, number>()
    for (const fact of facts) {
      const roles = preset.plan[fact.kind]
      const turn = seen.get(fact.kind) ?? 0
      seen.set(fact.kind, turn + 1)
      slots.push({ concept, fact, role: roles[turn % roles.length]! })
    }
  }
  return { slots, outsideCore }
}
