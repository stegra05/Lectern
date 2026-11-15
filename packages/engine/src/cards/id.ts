import { two } from './words.ts'
import type { Role } from './roles.ts'

/**
 * The identity of a card: its lecture, its concept, its role and a counter within those.
 * The wording is not part of it, so a reworded card keeps its id, its file and later its
 * Anki note. Assigned once when the card is first drafted and then stored in the card file.
 */
export function cardId(lecture: number, conceptId: string, role: Role, n: number): string {
  return `${two(lecture)}-${conceptId}-${role}-${n}`
}
