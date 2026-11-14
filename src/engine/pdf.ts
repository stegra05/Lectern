/**
 * PDF handling via pdf.js — metadata for deck sizing plus page thumbnails
 * for the coverage and provenance UI. The PDF itself goes to the model natively;
 * nothing here feeds the model.
 */

import './streamPolyfill'
import './webkitPolyfills'
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
  // Kept, not just counted: the quality gate checks a card's source excerpt
  // against the page it claims to come from, which is the difference between
  // provenance the model asserts and provenance the app can verify.
  const pageTexts: string[] = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    try {
      const text = await page.getTextContent()
      const parts: string[] = []
      for (const item of text.items) {
        if ('str' in item) {
          textChars += item.str.length
          parts.push(item.str)
        }
      }
      pageTexts.push(parts.join(' '))
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
  return { pageCount, textChars, imageCount, pageTexts }
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

export interface PageRender {
  cancel: () => void
  /** Resolves with the page's size in PDF points, for its aspect ratio and
   *  the text layer's `--total-scale-factor` (shown width / page width).
   *  Rejects once cancelled. */
  promise: Promise<{ width: number; height: number }>
}

/**
 * Render a page once, at a fixed pixel width, and lay its text out as
 * selectable spans in `textLayer`. Both then scale with CSS alone: the canvas
 * by its displayed width, the text layer by `--total-scale-factor`, which
 * pdf.js reads for every span position and font size. Resizing the panel
 * never renders the page again.
 */
export function renderPageWithTextLayer(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  textLayer: HTMLElement,
  pixelWidth: number,
): PageRender {
  let cancelled = false
  let renderTask: { cancel: () => void } | null = null
  let layer: { cancel: () => void } | null = null

  const promise = (async () => {
    const page = await doc.getPage(pageNumber)
    try {
      const base = page.getViewport({ scale: 1 })
      // Fetched before anything is drawn: a render cancelled while this is
      // pending must stop here, not go on to fill the shared text layer.
      const textContent = await page.getTextContent()
      if (cancelled) throw new Error('page render cancelled')

      const viewport = page.getViewport({ scale: pixelWidth / base.width })
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas 2d context unavailable')
      const task = page.render({ canvas, canvasContext: ctx, viewport })
      renderTask = task

      textLayer.replaceChildren()
      const text = new pdfjs.TextLayer({
        textContentSource: textContent,
        container: textLayer,
        viewport: base,
      })
      layer = text
      await Promise.all([task.promise, text.render()])
      return { width: base.width, height: base.height }
    } finally {
      page.cleanup()
    }
  })()

  const cancel = () => {
    cancelled = true
    renderTask?.cancel()
    layer?.cancel()
  }
  return { cancel, promise }
}
