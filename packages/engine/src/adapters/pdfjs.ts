import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { UnreadablePdf } from '../errors.ts'
import type { PdfPort } from '../ports.ts'

/** Width of a rendered slide in pixels: enough to read a formula, small enough to send. */
const WIDTH = 1024

const unreadable = (error: unknown) =>
  new UnreadablePdf((error as Error).name === 'PasswordException' ? 'password' : 'damaged')

/** Opens a PDF. One that pdf.js cannot open, for a password or for damage, is `UnreadablePdf`. */
async function open(data: Uint8Array) {
  // pdf.js takes ownership of the buffer, so it gets a copy.
  const task = getDocument({ data: data.slice(), verbosity: 0 })
  try {
    return { task, doc: await task.promise }
  } catch (error) {
    await task.destroy()
    throw unreadable(error)
  }
}

/** Reads slides with pdf.js: the text of each slide, and a picture of a slide on request. */
export const pdfjsReader: PdfPort = {
  async readSlides(data) {
    const { task, doc } = await open(data)
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
    } catch (error) {
      // A file that opens can still hold a page that does not.
      throw unreadable(error)
    } finally {
      await task.destroy()
    }
  },

  async renderSlides(data, slides) {
    const { task, doc } = await open(data)
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
