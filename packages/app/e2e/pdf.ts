import { PDFDocument, StandardFonts } from 'pdf-lib'

/** A PDF with one page per slide and one drawn text line per entry. */
export async function makePdf(slides: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const lines of slides) {
    const page = doc.addPage([720, 405])
    lines.forEach((line, i) => page.drawText(line, { x: 40, y: 350 - i * 30, size: 18, font }))
  }
  return Buffer.from(await doc.save())
}

/** A lecture that arrives later in the semester. */
export const LATER: Record<string, string[][]> = {
  '03_Lean_startup.pdf': [
    ['Lean startup'],
    [
      'Minimum viable product',
      'A minimum viable product is the smallest version that tests one assumption',
      'It is built to learn and not to sell',
    ],
    [
      'Pivot',
      'A pivot changes one part of the plan and keeps what was learned',
      'Founders pivot when the measured numbers stay flat',
    ],
  ],
}

/** Two short lectures. Each slide after the title has a heading and the lines that state it. */
export const LECTURES: Record<string, string[][]> = {
  '01_Introduction.pdf': [
    ['What is entrepreneurship'],
    [
      'Entrepreneurship',
      'Entrepreneurship is the pursuit of opportunity beyond the resources you control',
      'Entrepreneurs act before they own what the venture needs',
    ],
    [
      'Opportunity',
      'An opportunity is a chance to create value that others have not yet taken',
      'Opportunities are found or made',
    ],
    [
      'Risk and uncertainty',
      'Risk has outcomes with known probabilities',
      'Uncertainty has outcomes with unknown probabilities',
    ],
  ],
  '02_Effectuation.pdf': [
    ['Effectuation'],
    [
      'Bird in hand',
      'Start with who you are and what you know and whom you know',
      'The means come first and the goals follow',
    ],
    [
      'Affordable loss',
      'Decide by what you can afford to lose and not by the expected return',
      'A small loss keeps the venture alive for the next try',
    ],
    [
      'Crazy quilt',
      'Partners who commit early shape the venture together',
      'Commitments reduce uncertainty without prediction',
    ],
  ],
}
