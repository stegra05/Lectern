import { useEffect, useRef } from 'react'
import { useLectern } from '../state/store'

/**
 * The illuminated filmstrip — Lectern's signature element. Every page of the
 * lecture as a real thumbnail, dim until the coverage ledger marks it covered,
 * then lit in lamp amber. Clicking a thumbnail opens the slide peek panel to
 * check cards against the source; filtering by page lives inside that panel.
 */
export function Filmstrip({ streaming }: { streaming: boolean }) {
  const pdfInfo = useLectern((s) => s.pdfInfo)
  const pageThumbs = useLectern((s) => s.pageThumbs)
  const coverage = useLectern((s) => s.coverage)
  const pageFilter = useLectern((s) => s.pageFilter)
  const slidePeek = useLectern((s) => s.slidePeek)
  const peekSlide = useLectern((s) => s.peekSlide)
  const litBefore = useRef<Set<number>>(new Set())
  const stripRef = useRef<HTMLDivElement>(null)
  const scrolledTo = useRef<Set<number>>(new Set())

  useEffect(() => {
    if (!coverage) litBefore.current = new Set()
  }, [coverage === null])

  // While generating, keep the newest lit page in view so the flare is seen.
  useEffect(() => {
    if (!coverage) {
      scrolledTo.current = new Set()
      return
    }
    if (!streaming) return
    const fresh = coverage.coveredPages.filter((p) => !scrolledTo.current.has(p))
    if (fresh.length === 0) return
    for (const p of fresh) scrolledTo.current.add(p)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    stripRef.current?.querySelector(`[data-page="${fresh[fresh.length - 1]}"]`)?.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      inline: 'nearest',
      block: 'nearest',
    })
  }, [coverage, streaming])

  if (!pdfInfo) return null
  const covered = new Set(coverage?.coveredPages ?? [])
  const counts = coverage?.cardsPerPage ?? {}

  return (
    <div className="border-desk-edge/60 shrink-0 border-b">
      <div ref={stripRef} className="flex gap-2 overflow-x-auto px-4 py-3">
        {Array.from({ length: pdfInfo.pageCount }, (_, i) => i + 1).map((page) => {
          const isCovered = covered.has(page)
          const isNew = isCovered && !litBefore.current.has(page)
          if (isNew) litBefore.current.add(page)
          const isFiltered = pageFilter === page
          const isPeeked = slidePeek === page
          const count = counts[page] ?? 0
          const thumb = pageThumbs[page]

          // The flare glow sits on the wrapper so the tile's overflow clip
          // can't swallow it.
          const wrapperClass = `relative rounded-sm ${isNew ? 'lamp-flare' : ''}`
          const tile = (
            <div
              className={`relative h-[54px] w-[72px] shrink-0 overflow-hidden rounded-sm transition-[opacity,filter] duration-500 ${
                isCovered
                  ? 'opacity-100 ring-lamp/70 ring-1'
                  : 'ring-paper/10 opacity-35 grayscale ring-1 group-hover:opacity-60'
              } ${isFiltered || isPeeked ? 'ring-lamp ring-2' : ''}`}
            >
              {thumb ? (
                <img src={thumb} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="bg-paper/10 h-full w-full" />
              )}
              {count > 0 && (
                <span className="bg-desk/85 font-data text-lamp absolute right-0.5 bottom-0.5 rounded-sm px-1 text-2xs">
                  {count}
                </span>
              )}
            </div>
          )

          return (
            <div key={page} data-page={page} className="flex shrink-0 flex-col items-center gap-1">
              <button
                onClick={() => peekSlide(isPeeked ? null : page)}
                className={`group ${wrapperClass}`}
                aria-label={`View slide ${page}${count > 0 ? ` (${count} cards)` : ''}`}
                aria-pressed={isPeeked}
              >
                {tile}
              </button>
              <span
                className={`font-data text-2xs ${isCovered ? 'text-lamp' : 'text-chalk-dim/60'}`}
              >
                {page}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
