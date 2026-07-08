import { useEffect } from 'react'
import { useLectern } from '../state/store'

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
  const slideRenders = useLectern((s) => s.slideRenders)
  const pageThumbs = useLectern((s) => s.pageThumbs)
  const coverage = useLectern((s) => s.coverage)
  const pageFilter = useLectern((s) => s.pageFilter)
  const setPageFilter = useLectern((s) => s.setPageFilter)

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

  if (page === null || !pdfInfo) return null

  const image = slideRenders[page] ?? pageThumbs[page]
  const cardsHere = coverage?.cardsPerPage[page] ?? 0
  const filteredHere = pageFilter === page

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
          · {cardsHere > 0 ? `${cardsHere} card${cardsHere === 1 ? '' : 's'}` : 'no cards yet'}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => peekSlide(page - 1)}
          disabled={page <= 1}
          className="btn-ghost px-2 py-1"
          aria-label="Previous slide (←)"
          title="Previous slide (←)"
        >
          ←
        </button>
        <button
          onClick={() => peekSlide(page + 1)}
          disabled={page >= pageCount}
          className="btn-ghost px-2 py-1"
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
        <div className="bg-paper shadow-card overflow-hidden rounded-md">
          {image ? (
            <img src={image} alt={`Slide ${page}`} className="w-full" draggable={false} />
          ) : (
            <div className="bg-paper/10 aspect-[4/3] w-full animate-pulse" />
          )}
        </div>

        {interactive && (
          <button
            onClick={() => setPageFilter(filteredHere ? null : page)}
            aria-pressed={filteredHere}
            className={`mt-3 w-full px-3 py-2 ${
              filteredHere ? 'btn-secondary border-lamp/60 text-lamp' : 'btn-secondary'
            }`}
          >
            {filteredHere ? 'Showing only this page — show all' : 'Show only cards from this page'}
          </button>
        )}
      </div>
    </aside>
  )
}
