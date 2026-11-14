import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PdfPort } from '../ports.ts'

/** Reads the text of each slide with pdf.js. Pictures and scanned slides come back empty. */
export const pdfjsReader: PdfPort = {
  async readSlides(data) {
    // pdf.js takes ownership of the buffer, so it gets a copy.
    const task = getDocument({ data: data.slice(), verbosity: 0 })
    const doc = await task.promise
    try {
      const slides: string[][] = []
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n)
        const content = await page.getTextContent()
        const lines: string[] = []
        let line = ''
        for (const item of content.items) {
          if (!('str' in item)) continue
          line += item.str
          if (item.hasEOL) {
            lines.push(line)
            line = ''
          }
        }
        lines.push(line)
        slides.push(lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== ''))
        page.cleanup()
      }
      return slides
    } finally {
      await task.destroy()
    }
  },
}
