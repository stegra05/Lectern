/**
 * Finding a card's quote in the text of its slide, to mark what the card
 * rests on. The match is exact wording only: a slide never lights up for a
 * few words it happens to share with the quote.
 *
 * Whitespace is ignored on both sides, because pdf.js splits a slide into
 * spans that drop or add spaces at will (a word can arrive as "Gradi" +
 * "ent"), and the model's quote reflows line breaks. Case, typographic quotes
 * and dashes, ligatures and words hyphenated across a line break are folded
 * the same way.
 */

export interface TextRange {
  /** Index into the slide text, inclusive. */
  start: number
  /** Index into the slide text, exclusive. */
  end: number
}

/** The shortest quote worth marking; below it, matches are coincidence. */
const MIN_QUOTE_CHARS = 6
/** A fragment of a longer quote needs this many words of its own. */
const MIN_FRAGMENT_WORDS = 2
const MIN_FRAGMENT_CHARS = 10

interface Folded {
  text: string
  /** For each folded character, the index of the source character it came from. */
  origin: number[]
}

function fold(source: string): Folded {
  let text = ''
  const origin: number[] = []
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (/\s/.test(ch) || ch === '­') continue
    // "learn-" at the end of a line, "ing" on the next.
    if (ch === '-' && /^[ \t]*[\r\n]/.test(source.slice(i + 1, i + 4))) continue
    const folded = ch
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[‘’ʼ′]/g, "'")
      .replace(/[“”„″]/g, '"')
      .replace(/[‐‑‒–—―−]/g, '-')
    for (const f of folded) {
      text += f
      origin.push(i)
    }
  }
  return { text, origin }
}

/**
 * Where `quote` appears in `slideText`: the whole quote when it is there,
 * otherwise each of its lines or sentences that is. A quote stitched from
 * several selections, or a model quote that joined two bullet points with
 * "…", still marks the parts that are on the slide.
 */
export function findQuoteRanges(slideText: string, quote: string): TextRange[] {
  const slide = fold(slideText)
  const locate = (needle: string, minChars: number): TextRange | null => {
    const folded = fold(needle).text
    if (folded.length < minChars) return null
    const at = slide.text.indexOf(folded)
    if (at === -1) return null
    return { start: slide.origin[at], end: slide.origin[at + folded.length - 1] + 1 }
  }

  const whole = locate(quote, MIN_QUOTE_CHARS)
  if (whole) return [whole]

  const ranges = quote
    .split(/\r?\n|\.{3}|…|(?<=[.!?;:])\s+/)
    .filter((part) => part.trim().split(/\s+/).length >= MIN_FRAGMENT_WORDS)
    .map((part) => locate(part, MIN_FRAGMENT_CHARS))
    .filter((range): range is TextRange => range !== null)
    .sort((a, b) => a.start - b.start)

  const merged: TextRange[] = []
  for (const range of ranges) {
    const last = merged.at(-1)
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}
