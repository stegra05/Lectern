/** "1 card", "3 cards": a number with its noun agreeing, never "card(s)". */
export const count = (n: number, noun: string, pluralNoun = `${noun}s`): string =>
  `${n} ${n === 1 ? noun : pluralNoun}`
