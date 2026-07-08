/**
 * PDF handling via pdf.js — metadata for deck sizing plus page thumbnails
 * for the coverage and provenance UI. The PDF itself goes to Gemini natively;
 * nothing here feeds the model.
 */

import './streamPolyfill'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfInfo } from './types'

// Custom worker entry (instead of workerSrc pointing at the stock build) so
// the ReadableStream polyfill also runs inside the worker context.
pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('./pdfWorker.ts', import.meta.url), {
  type: 'module',
})

/** Pages beyond this are skipped for image counting (sizing heuristic only). */
const IMAGE_SCAN_PAGE_LIMIT = 300

export async function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js transfers the buffer to its worker; hand it a copy so callers keep theirs.
  return pdfjs.getDocument({ data: data.slice() }).promise
}

export async function extractPdfInfo(doc: PDFDocumentProxy): Promise<PdfInfo> {
  let textChars = 0
  let imageCount = 0
  const pageCount = doc.numPages

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    try {
      const text = await page.getTextContent()
      for (const item of text.items) {
        if ('str' in item) textChars += item.str.length
      }
      if (i <= IMAGE_SCAN_PAGE_LIMIT) {
        const ops = await page.getOperatorList()
        for (const fn of ops.fnArray) {
          if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
            imageCount++
          }
        }
      }
    } finally {
      page.cleanup()
    }
  }
  return { pageCount, textChars, imageCount }
}

/** Render one page to a data-URL thumbnail (used by coverage grid & card provenance). */
export async function renderPageThumbnail(
  doc: PDFDocumentProxy,
  pageNumber: number,
  targetWidth = 320,
): Promise<string> {
  const page = await doc.getPage(pageNumber)
  try {
    const base = page.getViewport({ scale: 1 })
    const scale = targetWidth / base.width
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    return canvas.toDataURL('image/webp', 0.8)
  } finally {
    page.cleanup()
  }
}
