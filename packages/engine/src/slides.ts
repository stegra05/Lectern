/**
 * The text of a lecture's slides as the engine works with it: what the PDF says, without the
 * lines every slide repeats.
 */

import type { PdfPort } from './ports.ts'

/** A line counts as repeated when at least this share of the slides carries it. */
const REPEATED_SHARE = 0.5
/** A deck shorter than this repeats nothing worth removing. */
const MIN_SLIDES = 3

/**
 * Page numbers and dates change from slide to slide, so a line is compared without digits.
 * A line of digits only has an empty shape.
 */
function shape(line: string): string {
  return line.replace(/\d+/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Removes the footer and header lines of a deck: lecturer, course name, page number, date.
 * They teach nothing, and they hide which slides are figures: on the Entrepreneurship decks a
 * footer of about 100 characters made 93 slides that are a title and a picture look like text
 * (6 of 356 slides went to the model as pictures; without the footer, 99 do).
 */
export function withoutFurniture(slides: string[][]): string[][] {
  if (slides.length < MIN_SLIDES) return slides
  const count = new Map<string, number>()
  for (const lines of slides) {
    for (const s of new Set(lines.map(shape))) count.set(s, (count.get(s) ?? 0) + 1)
  }
  const least = Math.max(MIN_SLIDES, slides.length * REPEATED_SHARE)
  const repeated = (line: string) => (count.get(shape(line)) ?? 0) >= least
  return slides.map((lines) =>
    lines.filter((line, i) => {
      // A bare number is a page number only on the first or last line. In a table it is a cell.
      if (shape(line) === '') return !(repeated(line) && (i === 0 || i === lines.length - 1))
      return !repeated(line)
    }),
  )
}

/** The slides of a PDF in slide order, each as its lines of text. */
export async function slideText(pdf: PdfPort, data: Uint8Array): Promise<string[][]> {
  return withoutFurniture(await pdf.readSlides(data))
}
