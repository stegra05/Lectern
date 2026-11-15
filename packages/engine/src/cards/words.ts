/** Text helpers shared by every limit. Pure. */

/** One cloze deletion: `{{c1::text}}`. Group 1 is the number, group 2 the hidden text. */
export const CLOZE = /\{\{c(\d+)::(.*?)\}\}/g

/** Words a reader has to process: tags, cloze wrappers and key term marks are not words. */
export function words(text: string): number {
  const plain = text
    .replace(CLOZE, '$2')
    .replace(/<[^>]*>|==/g, '')
    .trim()
  return plain === '' ? 0 : plain.split(/\s+/).length
}

/** A file and id safe handle for a name: `Bird in hand` becomes `bird-in-hand`. */
export function slug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Lowercase letters and digits only, for comparing two wordings of the same question. */
export function wordingKey(text: string): string {
  return text
    .replace(CLOZE, '$2')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Words of four letters or more, lowercased: the terms that can be looked up on a slide. */
export function contentWords(text: string): string[] {
  return (
    text
      .replace(CLOZE, '$2')
      .toLowerCase()
      .match(/\p{L}{4,}/gu) ?? []
  )
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** `02` for lecture 2. */
export function two(n: number): string {
  return String(n).padStart(2, '0')
}

/** `slides 1 to 3 and 7` for [1, 2, 3, 7]. */
export function slideRange(slides: number[]): string {
  const sorted = [...new Set(slides)].sort((a, b) => a - b)
  const runs: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i]! + 1) i++
    const end = sorted[i]!
    runs.push(start === end ? `${start}` : `${start} to ${end}`)
  }
  const list = runs.length > 1 ? `${runs.slice(0, -1).join(', ')} and ${runs.at(-1)}` : runs[0]
  return `${sorted.length === 1 ? 'slide' : 'slides'} ${list}`
}

/** Field HTML back to plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\/?(?:mark|sub|sup)>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
