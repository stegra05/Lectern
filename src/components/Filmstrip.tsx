import { useEffect, useRef } from 'react'
import { useLectern } from '../state/store'

/**
 * The illuminated filmstrip — Lectern's signature element. Every page of the
 * lecture as a real thumbnail, dim until the coverage ledger marks it covered,
 * then lit in lamp amber. In review it filters the card list by page.
 */
export function Filmstrip({ interactive }: { interactive: boolean }) {
  const pdfInfo = useLectern((s) => s.pdfInfo)
  const pageThumbs = useLectern((s) => s.pageThumbs)
  const coverage = useLectern((s) => s.coverage)
  const pageFilter = useLectern((s) => s.pageFilter)
  const setPageFilter = useLectern((s) => s.setPageFilter)
  const litBefore = useRef<Set<number>>(new Set())

  useEffect(() => {
    if (!coverage) litBefore.current = new Set()
  }, [coverage === null])

  if (!pdfInfo) return null
  const covered = new Set(coverage?.coveredPages ?? [])
  const counts = coverage?.cardsPerPage ?? {}

  return (
    <div className="shrink-0 border-b border-desk-edge/60">
      <div className="flex gap-2 overflow-x-auto px-4 py-3">
        {Array.from({ length: pdfInfo.pageCount }, (_, i) => i + 1).map((page) => {
          const isCovered = covered.has(page)
          const isNew = isCovered && !litBefore.current.has(page)
          if (isNew) litBefore.current.add(page)
          const isFiltered = pageFilter === page
          const count = counts[page] ?? 0
          const thumb = pageThumbs[page]

          const tile = (
            <div
              className={`relative h-[54px] w-[72px] shrink-0 overflow-hidden rounded-[3px] transition-all duration-500 ${
                isCovered ? 'opacity-100 ring-1 ring-lamp/70' : 'opacity-35 grayscale ring-1 ring-paper/10'
              } ${isNew ? 'lamp-flare' : ''} ${isFiltered ? 'ring-2 ring-lamp' : ''}`}
            >
              {thumb ? (
                <img src={thumb} alt={`Page ${page}`} className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full bg-paper/10" />
              )}
              {count > 0 && (
                <span className="absolute right-0.5 bottom-0.5 rounded-sm bg-desk/85 px-1 font-data text-[10px] text-lamp">
                  {count}
                </span>
              )}
            </div>
          )

          return (
            <div key={page} className="flex shrink-0 flex-col items-center gap-1">
              {interactive ? (
                <button
                  onClick={() => setPageFilter(isFiltered ? null : page)}
                  className="rounded-[3px]"
                  aria-label={`Filter cards from page ${page}`}
                  aria-pressed={isFiltered}
                >
                  {tile}
                </button>
              ) : (
                tile
              )}
              <span className={`font-data text-[10px] ${isCovered ? 'text-lamp' : 'text-chalk-dim/60'}`}>
                {page}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
