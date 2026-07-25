import { useEffect, useRef, useState } from 'react'
import { conceptMapToMarkdown, conceptMapToMermaid, relationsFor } from '../engine/conceptExport'
import type { Concept, ConceptMap, Difficulty, Importance } from '../engine/types'
import { copyText } from '../lib/clipboard'
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
  const [copyOpen, setCopyOpen] = useState(false)
  // Read by the Esc handler without re-binding the listener per change.
  const selectedRef = useRef(selectedId)
  const copyOpenRef = useRef(copyOpen)
  useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])
  useEffect(() => {
    copyOpenRef.current = copyOpen
  }, [copyOpen])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      // Esc unwinds one layer at a time: menu, then selection, then the sheet.
      if (copyOpenRef.current) setCopyOpen(false)
      else if (selectedRef.current) setSelectedId(null)
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
          <CopyMenu conceptMap={conceptMap} open={copyOpen} setOpen={setCopyOpen} />
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
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            <div className="mx-auto max-w-2xl">
              {IMPORTANCE_ORDER.map((importance) => {
                const group = conceptMap.concepts.filter((c) => c.importance === importance)
                if (group.length === 0) return null
                return (
                  <section key={importance}>
                    {/* The heading stays put while its own group scrolls under
                        it, so a long map never loses its place. */}
                    <h3 className="bg-desk-raised border-desk-edge/60 sticky top-0 z-10 flex items-baseline gap-2 border-b pt-4 pb-1.5">
                      <span className="eyebrow">{IMPORTANCE_LABEL[importance]}</span>
                      <span className="font-data text-chalk-dim/60 text-2xs">{group.length}</span>
                    </h3>
                    <ul>
                      {group.map((c) => (
                        <ConceptRow
                          key={c.id}
                          concept={c}
                          state={stateOf(c)}
                          conceptMap={conceptMap}
                          onOpenPage={openPage}
                        />
                      ))}
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

/** Page links per row before the rest collapse into a "+n". */
const PAGE_REFS_SHOWN = 4

const DIFFICULTY_STEPS: Record<Difficulty, number> = {
  foundational: 1,
  intermediate: 2,
  advanced: 3,
}

/** Difficulty as three rungs rather than the word. Repeated down every row,
 *  "foundational" is noise; a shape you can scan in peripheral vision is not. */
function DifficultyMeter({ difficulty }: { difficulty: Difficulty }) {
  const filled = DIFFICULTY_STEPS[difficulty]
  return (
    <span
      className="flex shrink-0 items-end gap-px"
      title={`${difficulty} — ${filled} of 3`}
      aria-label={difficulty}
    >
      {[1, 2, 3].map((step) => (
        <span
          key={step}
          className={`w-0.5 rounded-full ${step <= filled ? 'bg-chalk-dim' : 'bg-desk-edge'}`}
          style={{ height: `${2 + step * 2}px` }}
        />
      ))}
    </span>
  )
}

/**
 * One concept in the list view: state, name, difficulty, pages — and the
 * relations that hang off it, phrased exactly as the Markdown export writes
 * them, so what you read here is what lands in your notes.
 */
function ConceptRow({
  concept,
  state,
  conceptMap,
  onOpenPage,
}: {
  concept: Concept
  state: ConceptState
  conceptMap: ConceptMap
  onOpenPage: (page: number) => void
}) {
  const nameOf = (id: string) => conceptMap.concepts.find((c) => c.id === id)?.name.trim()
  const relations = relationsFor(concept, conceptMap.relations, nameOf)

  return (
    <li className="border-desk-edge/25 border-b py-2 last:border-b-0">
      <div className="flex items-baseline gap-2.5">
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
                : 'border-chalk-dim/50 border'
          }`}
        />
        <span
          className={`min-w-0 flex-1 text-sm ${state === 'open' ? 'text-chalk-dim' : 'text-chalk'}`}
        >
          {concept.name}
        </span>
        <DifficultyMeter difficulty={concept.difficulty} />
        {/* "p." once, then the numbers — the same shape a card's footer uses.
            Long lists are clipped so the column can never wrap and drag the
            row apart; the full set stays in the tooltip. */}
        <span
          className="font-data text-chalk-dim min-w-[5.5rem] shrink-0 text-right text-2xs whitespace-nowrap"
          title={
            concept.pageReferences.length > 0
              ? `Pages ${concept.pageReferences.join(', ')}`
              : undefined
          }
        >
          {concept.pageReferences.length > 0 && 'p. '}
          {concept.pageReferences.slice(0, PAGE_REFS_SHOWN).map((p, i) => (
            <button
              key={p}
              onClick={() => onOpenPage(p)}
              className="hover:text-lamp rounded-sm underline-offset-2 transition-colors duration-150 hover:underline"
              aria-label={`View slide ${p}`}
            >
              {i > 0 && ', '}
              {p}
            </button>
          ))}
          {concept.pageReferences.length > PAGE_REFS_SHOWN && (
            <span className="text-chalk-dim/60">
              {' '}
              +{concept.pageReferences.length - PAGE_REFS_SHOWN}
            </span>
          )}
        </span>
      </div>
      {relations.length > 0 && (
        <ul className="border-desk-edge/50 mt-1 ml-[0.4375rem] space-y-0.5 border-l pl-3">
          {relations.map((relation) => (
            <li key={relation.text} className="font-data text-chalk-dim/70 text-2xs">
              {relation.text}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * Take the map with you: the outline pastes into an outliner as nested
 * bullets (RemNote, Notion, Obsidian), the Mermaid block renders as the graph
 * in the same places. Open state lives in the sheet so Esc unwinds the menu
 * before the sheet itself.
 */
function CopyMenu({
  conceptMap,
  open,
  setOpen,
}: {
  conceptMap: ConceptMap
  open: boolean
  setOpen: (open: boolean) => void
}) {
  const toast = useLectern((s) => s.toast)

  const copy = async (label: string, build: (map: ConceptMap) => string) => {
    setOpen(false)
    const ok = await copyText(build(conceptMap))
    if (ok) toast('success', `Concept map copied as ${label}.`)
    else toast('error', 'Could not reach the clipboard.')
  }

  const formats: Array<{
    key: string
    label: string
    hint: string
    build: (m: ConceptMap) => string
  }> = [
    {
      key: 'outline',
      label: 'an outline',
      hint: 'Markdown · RemNote, Notion, Obsidian',
      build: conceptMapToMarkdown,
    },
    {
      key: 'diagram',
      label: 'a diagram',
      hint: 'Mermaid · renders as the graph',
      build: conceptMapToMermaid,
    },
  ]

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn-ghost px-2.5 py-1 text-xs"
        title="Copy the concept map to paste elsewhere"
      >
        Copy
      </button>
      {open && (
        <>
          {/* Catches the click that dismisses the menu. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="bg-desk-raised border-desk-edge/60 shadow-sheet fade-in absolute right-0 z-20 mt-1 w-60 rounded-md border p-1"
          >
            {formats.map((format) => (
              <button
                key={format.key}
                role="menuitem"
                onClick={() => void copy(format.label, format.build)}
                className="hover:bg-desk-hover block w-full rounded-sm px-2.5 py-1.5 text-left transition-colors duration-150"
              >
                <span className="text-chalk block text-sm">Copy as {format.label}</span>
                <span className="font-data text-chalk-dim block text-2xs">{format.hint}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
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
