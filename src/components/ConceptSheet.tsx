import { useEffect } from 'react'
import type { Concept, Importance } from '../engine/types'
import { useLectern } from '../state/store'

const IMPORTANCE_ORDER: Importance[] = ['high', 'medium', 'low']
const IMPORTANCE_LABEL: Record<Importance, string> = {
  high: 'Key concepts',
  medium: 'Supporting',
  low: 'Background',
}

type ConceptState = 'covered' | 'inferred' | 'open'

/**
 * The concept map, opened from the sidebar's coverage numbers: every concept
 * Gemini extracted, grouped by importance, with its coverage state and page
 * references. Page numbers open the slide peek.
 */
export function ConceptSheet({ onClose }: { onClose: () => void }) {
  const conceptMap = useLectern((s) => s.conceptMap)
  const coverage = useLectern((s) => s.coverage)
  const peekSlide = useLectern((s) => s.peekSlide)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  if (!conceptMap) return null

  const covered = new Set(coverage?.coveredConceptIds ?? [])
  const inferred = new Set(coverage?.inferredConceptIds ?? [])
  const stateOf = (c: Concept): ConceptState =>
    covered.has(c.id) ? 'covered' : inferred.has(c.id) ? 'inferred' : 'open'

  const openPage = (page: number) => {
    peekSlide(page)
    onClose()
  }

  return (
    <div
      className="bg-desk/70 fade-in absolute inset-0 z-40 flex items-center justify-center backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="concepts-title"
    >
      <div className="bg-desk-raised shadow-sheet sheet-in flex max-h-[85%] w-[560px] flex-col rounded-lg">
        <header className="flex items-baseline gap-3 px-6 pt-5 pb-3">
          <h2 id="concepts-title" className="text-chalk text-md font-semibold">
            Extracted concepts
          </h2>
          <span className="font-data text-chalk-dim text-xs">
            {conceptMap.concepts.length} from “{conceptMap.slideSetName}”
            {coverage && ` · ${Math.round(coverage.effectiveConceptCoveragePercent)}% covered`}
          </span>
          <div className="flex-1" />
          <button onClick={onClose} className="btn-ghost px-2 py-1" aria-label="Close (esc)">
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
          {IMPORTANCE_ORDER.map((importance) => {
            const group = conceptMap.concepts.filter((c) => c.importance === importance)
            if (group.length === 0) return null
            return (
              <section key={importance} className="mt-3 first:mt-0">
                <h3 className="eyebrow mb-1.5">{IMPORTANCE_LABEL[importance]}</h3>
                <ul className="space-y-px">
                  {group.map((c) => {
                    const state = stateOf(c)
                    return (
                      <li key={c.id} className="flex items-baseline gap-2.5 py-1">
                        <span
                          title={
                            state === 'covered'
                              ? 'Covered by a card'
                              : state === 'inferred'
                                ? 'Likely covered — cards exist on its pages'
                                : 'No card yet'
                          }
                          className={`size-1.5 shrink-0 self-center rounded-full ${
                            state === 'covered'
                              ? 'bg-lamp'
                              : state === 'inferred'
                                ? 'bg-lamp/40'
                                : 'bg-desk-edge'
                          }`}
                        />
                        <span
                          className={`min-w-0 flex-1 text-sm ${
                            state === 'open' ? 'text-chalk-dim' : 'text-chalk'
                          }`}
                        >
                          {c.name}
                          <span className="text-chalk-dim/70 font-data ml-2 text-2xs">
                            {c.difficulty}
                          </span>
                        </span>
                        <span className="font-data shrink-0 text-2xs">
                          {c.pageReferences.map((p, i) => (
                            <button
                              key={p}
                              onClick={() => openPage(p)}
                              className="text-chalk-dim hover:text-lamp rounded-sm underline-offset-2 transition-colors duration-150 hover:underline"
                              aria-label={`View slide ${p}`}
                            >
                              {i > 0 && ', '}p. {p}
                            </button>
                          ))}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
