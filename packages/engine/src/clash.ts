/**
 * Step 7, the part code does: find cards that look alike across the whole course. Pure.
 * Whether a pair really tests the same thing is a closed question for the decision model.
 */

import { wordingKey } from './cards/words.ts'

/** Two questions sharing this share of their words are worth a second look. */
const ALIKE = 0.6

export interface Wording {
  id: string
  /** The question in plain text. */
  text: string
}

export interface Clashes {
  /** New cards whose question is word for word one that already exists: [new, existing]. */
  same: [string, string][]
  /** New cards that look like another card: [new, other]. */
  alike: [string, string][]
}

/**
 * Compares every new card with the cards before it: all existing ones, and the new ones
 * that come earlier. An existing card is never the one that clashes.
 */
export function findClashes(existing: Wording[], fresh: Wording[]): Clashes {
  const same: Clashes['same'] = []
  const alike: Clashes['alike'] = []
  const before = existing.map((card) => ({ id: card.id, tokens: tokens(card.text) }))
  for (const card of fresh) {
    const mine = tokens(card.text)
    const twin = before.find(
      (other) => other.tokens.size === mine.size && overlap(mine, other.tokens) === 1,
    )
    if (twin) {
      same.push([card.id, twin.id])
      continue
    }
    const look = before.find((other) => overlap(mine, other.tokens) >= ALIKE)
    if (look) alike.push([card.id, look.id])
    before.push({ id: card.id, tokens: mine })
  }
  return { same, alike }
}

/** How much two names or questions share, from 0 to 1. */
export function similarity(a: string, b: string): number {
  return overlap(tokens(a), tokens(b))
}

function tokens(text: string): Set<string> {
  return new Set(wordingKey(text).split(' ').filter(Boolean))
}

/** Shared words over all words of both. */
function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0
  for (const token of a) if (b.has(token)) shared++
  const all = a.size + b.size - shared
  return all === 0 ? 0 : shared / all
}
