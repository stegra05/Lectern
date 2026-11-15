/**
 * Typed answers. Code decides per note, never the model: only roles whose answer is one short
 * term, and only when comparing typed text can replace the answer without losing anything.
 */

import { words } from './words.ts'
import type { Role } from './roles.ts'

const TYPED_ROLES: readonly Role[] = ['reverse', 'case', 'cloze', 'cloze-list']

/** At most 3 words and 30 characters, with no maths, code, markup or line break. */
export function typeable(text: string): boolean {
  const t = text.trim()
  return t !== '' && words(t) <= 3 && t.length <= 30 && !/[\r\n<>`$]|\\\(|\\\[/.test(t)
}

/**
 * The Typed field. `expected` is the term of a Q&A card, or every deletion of a cloze note.
 * Q&A: the term in the casing the concept map stores, because Anki compares case-sensitively.
 * Cloze: `on` when every deletion can be typed. Empty: the student answers in their head.
 */
export function typedField(role: Role, expected: string[], conceptName: string): string {
  if (!TYPED_ROLES.includes(role) || expected.length === 0 || !expected.every(typeable)) return ''
  if (role === 'cloze' || role === 'cloze-list') return 'on'
  const term = expected[0]!.trim()
  return term.toLowerCase() === conceptName.trim().toLowerCase() ? conceptName.trim() : term
}
