import { useEffect, useRef, useState } from 'react'
import type { Concept, ConceptMap, Importance } from '../engine/types'
import { useLectern } from '../state/store'
import { ConceptGraph, humanizeRelation, type ConceptState } from './ConceptGraph'

const IMPORTANCE_ORDER: Importance[] = ['high', 'medium', 'low']
const IMPORTANCE_LABEL: Record<Importance, string> = {
  high: 'Key concepts',
  medium: 'Supporting',
  low: 'Background',
}

/**
 * The concept map, opened from the sidebar card: everything Gemini extracted
 * from the lecture, drawn as a graph — concepts sized by importance, lit
 * amber where cards cover them, connected by the extracted relations. A list
 * view keeps the scannable per-importance breakdown. Page numbers open the
 * slide peek.
 */
export function ConceptSheet({ onClose }: { onClose: () => void }) {
  const conceptMap = useLectern((s) => s.conceptMap)
  const coverage = useLectern((s) => s.coverage)
  const peekSlide = useLectern((s) => s.peekSlide)
  const [view, setView] = useState<'graph' | 'list'>('graph')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Read by the Esc handler without re-binding the listener per selection.
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      // First Esc clears a selected node, the next closes the sheet.
      if (selectedRef.current) setSelectedId(null)
      else onClose()
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

  const selected = selectedId
    ? (conceptMap.concepts.find((c) => c.id === selectedId) ?? null)
    : null

  return (
    <div
      className="bg-desk/70 fade-in absolute inset-0 z-40 flex items-center justify-center backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="concepts-title"
    >
      <div className="bg-desk-raised shadow-sheet sheet-in flex h-[85%] w-[min(940px,92vw)] flex-col rounded-lg">
        <header className="flex items-baseline gap-3 px-6 pt-5 pb-3">
          <h2 id="concepts-title" className="text-chalk text-md font-semibold">
            Concept map
          </h2>
          <span className="font-data text-chalk-dim text-xs">
            {conceptMap.concepts.length} concepts · {conceptMap.relations.length} relations from “
            {conceptMap.slideSetName}”
            {coverage && ` · ${Math.round(coverage.effectiveConceptCoveragePercent)}% covered`}
          </span>
          <div className="flex-1" />
          <div
            className="border-desk-edge/60 flex overflow-hidden rounded-md border"
            role="group"
            aria-label="View"
          >
            {(['graph', 'list'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`px-2.5 py-1 text-xs transition-colors duration-150 ${
                  view === v ? 'bg-desk-hover text-chalk' : 'text-chalk-dim hover:text-chalk'
                }`}
              >
                {v === 'graph' ? 'Graph' : 'List'}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="btn-ghost px-2 py-1" aria-label="Close (esc)">
            ✕
          </button>
        </header>

        {view === 'graph' ? (
          <>
            <div className="min-h-0 flex-1 px-3">
              <ConceptGraph
                conceptMap={conceptMap}
                stateOf={stateOf}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </div>
            <footer className="border-desk-edge/60 min-h-14 border-t px-6 py-3">
              {selected ? (
                <SelectedConcept
                  concept={selected}
                  state={stateOf(selected)}
                  conceptMap={conceptMap}
                  onSelect={setSelectedId}
                  onOpenPage={openPage}
                />
              ) : (
                <p className="font-data text-chalk-dim flex flex-wrap items-center gap-x-2 text-2xs">
                  <Dot className="bg-lamp" /> covered
                  <Dot className="bg-lamp/40" /> likely covered
                  <Dot className="border-chalk-dim/80 border" /> no card yet
                  <span className="text-chalk-dim/60 mx-1">·</span>
                  larger = more important
                  <span className="text-chalk-dim/60 mx-1">·</span>
                  click a concept for its relations and slides
                </p>
              )}
            </footer>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
            <div className="mx-auto max-w-xl">
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
        )}
      </div>
    </div>
  )
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={`inline-block size-1.5 rounded-full ${className}`} />
}

/** Footer detail for the selected node: state, pages, and its relations. */
function SelectedConcept({
  concept,
  state,
  conceptMap,
  onSelect,
  onOpenPage,
}: {
  concept: Concept
  state: ConceptState
  conceptMap: ConceptMap
  onSelect: (id: string | null) => void
  onOpenPage: (page: number) => void
}) {
  const nameOf = (id: string) => conceptMap.concepts.find((c) => c.id === id)?.name
  const related = conceptMap.relations.filter(
    (r) => r.source === concept.id || r.target === concept.id,
  )

  return (
    <div className="max-h-24 space-y-1 overflow-y-auto">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span
          className={`size-1.5 shrink-0 self-center rounded-full ${
            state === 'covered'
              ? 'bg-lamp'
              : state === 'inferred'
                ? 'bg-lamp/40'
                : 'border-chalk-dim/80 border'
          }`}
        />
        <span className="text-chalk text-sm font-medium">{concept.name}</span>
        <span className="font-data text-chalk-dim text-2xs">
          {concept.difficulty} ·{' '}
          {state === 'covered'
            ? 'covered by a card'
            : state === 'inferred'
              ? 'likely covered'
              : 'no card yet'}
        </span>
        <span className="font-data text-2xs">
          {concept.pageReferences.map((p, i) => (
            <button
              key={p}
              onClick={() => onOpenPage(p)}
              className="text-chalk-dim hover:text-lamp rounded-sm underline-offset-2 transition-colors duration-150 hover:underline"
              aria-label={`View slide ${p}`}
            >
              {i > 0 && ', '}p. {p}
            </button>
          ))}
        </span>
      </div>
      {related.length > 0 && (
        <div className="font-data text-chalk-dim flex flex-wrap gap-x-3 gap-y-0.5 text-2xs">
          {related.map((r) => {
            const otherId = r.source === concept.id ? r.target : r.source
            const otherName = nameOf(otherId)
            if (!otherName) return null
            return (
              <button
                key={`${r.source}|${r.type}|${r.target}`}
                onClick={() => onSelect(otherId)}
                className="hover:text-lamp rounded-sm transition-colors duration-150"
                aria-label={`Select ${otherName}`}
              >
                {r.source === concept.id
                  ? `${humanizeRelation(r.type)} → ${otherName}`
                  : `${otherName} → ${humanizeRelation(r.type)}`}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
