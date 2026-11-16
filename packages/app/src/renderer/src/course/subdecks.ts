import type { Lecture } from '../../../shared/contract.ts'

/** The subdecks Anki holds: one per lecture with cards in it. A lecture without cards gets none. */
export function subdeckCount(lectures: Pick<Lecture, 'sent'>[]): number {
  return lectures.filter((l) => l.sent > 0).length
}
