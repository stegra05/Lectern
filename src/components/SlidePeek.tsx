import { useCallback, useEffect, useRef, useState } from 'react'
import { countCardsPerPage } from '../engine/coverage'
import { renderPageWithTextLayer } from '../engine/pdf'
import { count } from '../engine/plural'
import { getCurrentPdfDoc, useLectern } from '../state/store'

/** Width the page is rendered at, in canvas pixels: sharp on a 2x display up
 *  to a ~550px panel. CSS scales it to the panel from there. */
const SLIDE_RENDER_WIDTH = 1100

/** True when the event originates in a place that owns its own keystrokes. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  )
}

/**
 * The slide peek — a docked panel showing the full page a card came from, so
 * cards can be checked against the source without leaving the review. Opened
 * from filmstrip thumbnails and the page references on each card.
 */
export function SlidePeek({ interactive }: { interactive: boolean }) {
  const page = useLectern((s) => s.slidePeek)
  const pdfInfo = useLectern((s) => s.pdfInfo)
  const peekSlide = useLectern((s) => s.peekSlide)
  const pageThumbs = useLectern((s) => s.pageThumbs)
  const coverage = useLectern((s) => s.coverage)
  const cards = useLectern((s) => s.cards)
  const pageFilter = useLectern((s) => s.pageFilter)
  const setPageFilter = useLectern((s) => s.setPageFilter)
  const composerOpen = useLectern((s) => s.cardComposer !== null)
  const openCardComposer = useLectern((s) => s.openCardComposer)
  const selectedText = useLectern((s) => s.selectedSlideText)
  const setSelectedText = useLectern((s) => s.setSelectedSlideText)
  const insertIntoComposerAnswer = useLectern((s) => s.insertIntoComposerAnswer)
  const slideRef = useRef<HTMLDivElement>(null)
  // Where the floating action sits, above the selection, in slide coordinates.
  const [pillAt, setPillAt] = useState<{ x: number; y: number } | null>(null)
  // The quote the selected card rests on, when it cites this page. It used to
  // sit behind a "Source excerpt" toggle on every card; here it is read next
  // to the slide it claims to come from.
  const excerpt = useLectern((s) => {
    const card = s.cards.find((c) => c.uid === s.selectedUid)
    return card?.sourceExcerpt && page !== null && card.sourcePages.includes(page)
      ? card.sourceExcerpt
      : null
  })

  const pageCount = pdfInfo?.pageCount ?? 0

  // ← → step through slides, Esc closes — unless focus is in a field.
  useEffect(() => {
    if (page === null) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft' && page > 1) {
        e.preventDefault()
        peekSlide(page - 1)
      } else if (e.key === 'ArrowRight' && page < pageCount) {
        e.preventDefault()
        peekSlide(page + 1)
      } else if (e.key === 'Escape') {
        peekSlide(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [page, pageCount, peekSlide])

  // A selection on the slide's text layer becomes the next card's question,
  // or the open composer's answer. Anything selected elsewhere is not slide text.
  const onSelectionChange = useCallback(() => {
    const sel = window.getSelection()
    const slide = slideRef.current
    const text = sel?.toString().trim() ?? ''
    if (
      !sel ||
      !slide ||
      !text ||
      !slide.contains(sel.anchorNode) ||
      !slide.contains(sel.focusNode)
    ) {
      setSelectedText('')
      setPillAt(null)
      return
    }
    setSelectedText(text)
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    const frame = slide.getBoundingClientRect()
    setPillAt({
      x: Math.max(10, rect.left - frame.left + rect.width / 2),
      y: Math.max(10, rect.top - frame.top - 36),
    })
  }, [setSelectedText])

  useEffect(() => {
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [onSelectionChange])

  if (page === null || !pdfInfo) return null

  const image = pageThumbs[page]
  // Without a generation run there is no coverage ledger to count from.
  const cardsHere = (coverage?.cardsPerPage ?? countCardsPerPage(cards))[page] ?? 0
  const filteredHere = pageFilter === page

  const consumeSelection = () => {
    window.getSelection()?.removeAllRanges()
    setSelectedText('')
    setPillAt(null)
  }
  const newCard = () => {
    openCardComposer({
      sourcePage: page,
      front: selectedText || undefined,
      excerpt: selectedText || undefined,
    })
    consumeSelection()
  }
  const onPill = () => {
    if (composerOpen) {
      insertIntoComposerAnswer(selectedText)
      consumeSelection()
    } else {
      newCard()
    }
  }

  return (
    <aside
      aria-label={`Slide ${page} of ${pageCount}`}
      className="border-desk-edge/60 rise-in flex w-[min(36vw,480px)] shrink-0 flex-col border-l"
    >
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span className="eyebrow">
          Slide {page} / {pageCount}
        </span>
        <span className="font-data text-chalk-dim text-2xs">
          · {cardsHere > 0 ? count(cardsHere, 'card') : 'no cards yet'}
        </span>
        <div className="flex-1" />
        <button
          onClick={newCard}
          className="btn-secondary px-2 py-0.5 text-xs text-lamp border-lamp/40 hover:border-lamp"
          title="Create a new flashcard linked to this slide (n)"
        >
          + Card
        </button>
        {/* aria-disabled rather than disabled: clicking to the first slide
            used to disable the button under the pointer, which blurs it and
            drops the tab position back to the window chrome. */}
        <button
          onClick={() => page > 1 && peekSlide(page - 1)}
          aria-disabled={page <= 1}
          className={`btn-ghost px-2 py-1 ${page <= 1 ? 'pointer-events-none opacity-45' : ''}`}
          aria-label="Previous slide (←)"
          title="Previous slide (←)"
        >
          ←
        </button>
        <button
          onClick={() => page < pageCount && peekSlide(page + 1)}
          aria-disabled={page >= pageCount}
          className={`btn-ghost px-2 py-1 ${page >= pageCount ? 'pointer-events-none opacity-45' : ''}`}
          aria-label="Next slide (→)"
          title="Next slide (→)"
        >
          →
        </button>
        <button
          onClick={() => peekSlide(null)}
          className="btn-ghost px-2 py-1"
          aria-label="Close slide peek (esc)"
          title="Close (esc)"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div ref={slideRef} className="relative">
          <div className="bg-paper shadow-card overflow-hidden rounded-md">
            <SlideCanvas page={page} fallback={image} />
          </div>
          {selectedText && pillAt && (
            <button
              // mousedown, not click: a click would clear the selection first.
              onMouseDown={(e) => {
                e.preventDefault()
                onPill()
              }}
              style={{ left: pillAt.x, top: pillAt.y }}
              className="btn bg-lamp text-ink shadow-hero fade-in absolute z-30 -translate-x-1/2 rounded px-2.5 py-1 text-xs font-medium hover:bg-lamp-deep"
            >
              {composerOpen ? '+ Insert as answer' : '+ Create card from selection'}
            </button>
          )}
        </div>

        {excerpt && (
          <figure className="mt-3">
            <figcaption className="eyebrow">The card quotes</figcaption>
            <blockquote className="log-quote border-lamp-deep mt-1 border-l-2 pl-2">
              {excerpt}
            </blockquote>
          </figure>
        )}

        {interactive && (
          <button
            onClick={() => setPageFilter(filteredHere ? null : page)}
            aria-pressed={filteredHere}
            className={`mt-3 w-full px-3 py-2 ${
              filteredHere ? 'btn-secondary border-lamp/60 text-lamp' : 'btn-secondary'
            }`}
          >
            {filteredHere ? 'Showing only this page · show all' : 'Show only cards from this page'}
          </button>
        )}
      </div>
    </aside>
  )
}

/**
 * The peeked page as a canvas with pdf.js's selectable text layer on top.
 * The page is rendered once; the text layer follows the shown width through
 * `--total-scale-factor`, so resizing never renders it again. Until the
 * render lands, the filmstrip thumbnail stands in.
 *
 * The selection is drawn here, under the text layer, as one box per line.
 */
function SlideCanvas({ page, fallback }: { page: number; fallback?: string }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ page: number; width: number; height: number } | null>(null)
  const [selection, setSelection] = useState<Box[]>([])

  useEffect(() => {
    const doc = getCurrentPdfDoc()
    const canvas = canvasRef.current
    const text = textRef.current
    if (!doc || !canvas || !text) return
    const render = renderPageWithTextLayer(doc, page, canvas, text, SLIDE_RENDER_WIDTH)
    // A render overtaken by the next page (or by StrictMode's second mount)
    // must not report: its layer is empty or about to be replaced.
    let current = true
    render.promise.then((dims) => current && setSize({ page, ...dims })).catch(() => {}) // thumbnail stays
    return () => {
      current = false
      render.cancel()
    }
  }, [page])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !size) return
    const fit = () =>
      frame.style.setProperty('--total-scale-factor', String(frame.clientWidth / size.width))
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [size])

  useEffect(() => {
    const onSelectionChange = () => {
      const frame = frameRef.current
      const text = textRef.current
      const sel = window.getSelection()
      if (
        !frame ||
        !text ||
        !sel ||
        sel.isCollapsed ||
        !text.contains(sel.anchorNode) ||
        !text.contains(sel.focusNode)
      ) {
        // Typing in the composer fires this on every key; stay put.
        setSelection((prev) => (prev.length ? [] : prev))
        return
      }
      setSelection(frameBoxes(frame, mergeLines([...sel.getRangeAt(0).getClientRects()])))
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  const ready = size?.page === page
  return (
    <div
      ref={frameRef}
      className="relative"
      style={ready ? { aspectRatio: `${size.width} / ${size.height}` } : undefined}
    >
      {!ready &&
        (fallback ? (
          <img src={fallback} alt="" className="w-full" draggable={false} />
        ) : (
          <div className="bg-paper/10 aspect-[4/3] w-full animate-pulse" />
        ))}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Slide ${page}`}
        className={`absolute inset-0 h-full w-full ${ready ? '' : 'invisible'}`}
      />
      {/* Solid boxes in one translucent layer: where two lines' boxes overlap,
          the colour stays even instead of doubling. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-40">
        {selection.map((box, i) => (
          <div
            key={i}
            className="bg-lamp absolute"
            style={{
              left: `${box.left}%`,
              top: `${box.top}%`,
              width: `${box.width}%`,
              height: `${box.height}%`,
            }}
          />
        ))}
      </div>
      <div ref={textRef} className={`textLayer ${ready ? '' : 'invisible'}`} />
    </div>
  )
}

/** A rectangle in percent of the slide frame, so it scales with the panel. */
interface Box {
  left: number
  top: number
  width: number
  height: number
}

function frameBoxes(frame: HTMLElement, rects: DOMRect[]): Box[] {
  const f = frame.getBoundingClientRect()
  return rects.map((r) => ({
    left: ((r.left - f.left) / f.width) * 100,
    top: ((r.top - f.top) / f.height) * 100,
    width: (r.width / f.width) * 100,
    height: (r.height / f.height) * 100,
  }))
}

/**
 * Rects that share a line (overlap by half their height) become one, so the
 * gaps pdf.js leaves between a line's spans are covered with the words.
 */
function mergeLines(rects: DOMRect[]): DOMRect[] {
  const lines: DOMRect[] = []
  for (const r of rects.filter((r) => r.width > 0.5 && r.height > 0.5)) {
    const line = lines.find(
      (l) =>
        Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top) > Math.min(l.height, r.height) / 2,
    )
    if (!line) {
      lines.push(DOMRect.fromRect(r))
      continue
    }
    const left = Math.min(line.left, r.left)
    const top = Math.min(line.top, r.top)
    line.width = Math.max(line.right, r.right) - left
    line.height = Math.max(line.bottom, r.bottom) - top
    line.x = left
    line.y = top
  }
  return lines
}
