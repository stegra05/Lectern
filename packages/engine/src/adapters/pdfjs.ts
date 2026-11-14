import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PdfPort } from '../ports.ts'

/** Width of a rendered slide in pixels: enough to read a formula, small enough to send. */
const WIDTH = 1024

/** Reads slides with pdf.js: the text of each slide, and a picture of a slide on request. */
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

  async renderSlides(data, slides) {
    const task = getDocument({ data: data.slice(), verbosity: 0 })
    const doc = await task.promise
    try {
      const images = []
      for (const slide of slides) {
        const page = await doc.getPage(slide)
        const viewport = page.getViewport({ scale: WIDTH / page.getViewport({ scale: 1 }).width })
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        // pdf.js is typed for the browser canvas; the Node canvas has the same drawing surface.
        await page.render({
          canvas: canvas as never,
          canvasContext: canvas.getContext('2d') as never,
          viewport,
        }).promise
        images.push({ slide, png: canvas.toBuffer('image/png').toString('base64') })
        page.cleanup()
      }
      return images
    } finally {
      await task.destroy()
    }
  },
}
