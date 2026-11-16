/** Step 7, the part code does: find cards whose question is word for word one that exists. Pure. */

import { wordingKey } from './cards/words.ts'

export interface Wording {
  id: string
  /** The question in plain text. */
  text: string
}

export interface Clashes {
  /** New cards whose question is word for word one that already exists: [new, existing]. */
  same: [string, string][]
}

/**
 * Compares questions by their words in order, because a reversed question has another answer.
 * Compares every new card with the cards before it: all existing ones, and the new ones
 * that come earlier. An existing card is never the one that clashes.
 */
export function findClashes(existing: Wording[], fresh: Wording[]): Clashes {
  const same: Clashes['same'] = []
  const before = new Map<string, string>()
  for (const card of existing) before.set(wordingKey(card.text), card.id)
  for (const card of fresh) {
    const twin = before.get(wordingKey(card.text))
    if (twin) same.push([card.id, twin])
    else before.set(wordingKey(card.text), card.id)
  }
  return { same }
}
