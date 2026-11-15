/** Small facts about lectures that every screen shares. */

/** The CSS colour a lecture owns. From lecture 13 on the twelve colours repeat. */
export function lectureColour(number: number): string {
  return `var(--lec-${((number - 1) % 12) + 1})`
}

/** `2` as `02`, the way the map and the cards show a lecture number. */
export function two(number: number): string {
  return String(number).padStart(2, '0')
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

/** An amount in euros as the student reads it: "0,40 €". */
export function euros(amount: number): string {
  return eur.format(amount)
}
