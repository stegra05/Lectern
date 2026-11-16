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

const QUESTION_WORD = /^(?:what|which|who|whom|whose|how|why|when|where)$/
const FRAME_WORD =
  /^(?:a|an|the|is|are|was|were|be|do|does|did|it|its|this|that|of|to|in|on|or|and|for|with)$/

/**
 * A question for comparing wordings: its question words as a set, and its other words in
 * order once the frame words go. A rewording moves the frame ("What is X?", "X: what is it?")
 * and keeps the order of the terms; a reversal ("price affect demand", "demand affect price")
 * changes it, and has another answer.
 */
const key = (text: string) => {
  const found = wordingKey(text).split(' ').filter(Boolean)
  const asked = [...new Set(found.filter((w) => QUESTION_WORD.test(w)))].sort()
  const terms = found.filter((w) => !QUESTION_WORD.test(w) && !FRAME_WORD.test(w))
  return `${asked.join(' ')}|${terms.join(' ')}`
}

/**
 * Compares every new card with the cards before it: all existing ones, and the new ones
 * that come earlier. An existing card is never the one that clashes.
 */
export function findClashes(existing: Wording[], fresh: Wording[]): Clashes {
  const same: Clashes['same'] = []
  const before = new Map<string, string>()
  for (const card of existing) before.set(key(card.text), card.id)
  for (const card of fresh) {
    const twin = before.get(key(card.text))
    if (twin) same.push([card.id, twin])
    else before.set(key(card.text), card.id)
  }
  return { same }
}
