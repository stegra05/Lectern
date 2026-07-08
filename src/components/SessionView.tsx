import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppPhase } from '../state/store'
import { useLectern } from '../state/store'
import { CardTile } from './CardTile'
import { ConceptSheet } from './ConceptSheet'
import { Filmstrip } from './Filmstrip'
import { isTypingTarget, SlidePeek } from './SlidePeek'
import { SyncBar } from './SyncBar'

const PHASES: Array<{ id: AppPhase; label: string }> = [
  { id: 'uploading', label: 'Upload' },
  { id: 'mapping', label: 'Concept map' },
  { id: 'generating', label: 'Cards' },
  { id: 'reflecting', label: 'Quality pass' },
  { id: 'complete', label: 'Review' },
]

export function SessionView() {
  const phase = useLectern((s) => s.phase)
  const hasCards = useLectern((s) => s.cards.length > 0)
  const isDone = phase === 'complete'
  const isError = phase === 'error'
  // After an error, the cards produced so far stay reviewable and syncable.
  const reviewable = isDone || isError

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Filmstrip streaming={!reviewable} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <section className="relative flex min-w-0 flex-1 flex-col">
          {isError && <ErrorBanner />}
          <CardColumn />
          {reviewable && hasCards && <SyncBar />}
        </section>
        <SlidePeek interactive={reviewable} />
      </div>
    </div>
  )
}

function Sidebar() {
  const phase = useLectern((s) => s.phase)
  const progress = useLectern((s) => s.progress)
  const coverage = useLectern((s) => s.coverage)
  const conceptMap = useLectern((s) => s.conceptMap)
  const logs = useLectern((s) => s.logs)
  const usage = useLectern((s) => s.usage)
  const doneSummary = useLectern((s) => s.doneSummary)
  const cancelGeneration = useLectern((s) => s.cancelGeneration)
  const backToHome = useLectern((s) => s.backToHome)
  const logRef = useRef<HTMLDivElement>(null)
  const [conceptsOpen, setConceptsOpen] = useState(false)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [logs.length])

  const running = phase !== 'complete' && phase !== 'error' && phase !== 'idle'
  const phaseIndex = PHASES.findIndex((p) => p.id === phase)

  return (
    <aside className="border-desk-edge/60 flex w-64 shrink-0 flex-col gap-5 border-r p-4">
      {/* Phase register */}
      <ol className="space-y-1.5">
        {PHASES.map((p, i) => {
          const state = i < phaseIndex ? 'done' : i === phaseIndex ? 'now' : 'ahead'
          return (
            <li key={p.id} className="flex items-center gap-2.5">
              <span
                className={`size-1.5 rounded-full ${
                  state === 'done'
                    ? 'bg-lamp/60'
                    : state === 'now'
                      ? 'bg-lamp animate-pulse'
                      : 'bg-desk-edge'
                }`}
              />
              <span
                className={`text-sm ${
                  state === 'now'
                    ? 'text-chalk font-medium'
                    : state === 'done'
                      ? 'text-chalk-dim'
                      : 'text-chalk-dim/50'
                }`}
              >
                {p.label}
              </span>
            </li>
          )
        })}
      </ol>

      {/* The ledger, in numbers */}
      {coverage && (
        <div className="border-desk-edge/60 space-y-1.5 border-t pt-4">
          <Stat label="Pages covered" value={`${Math.round(coverage.pageCoveragePercent)}%`} />
          <Stat
            label="Concepts"
            value={`${Math.round(coverage.effectiveConceptCoveragePercent)}%`}
            onClick={conceptMap ? () => setConceptsOpen(true) : undefined}
          />
          {conceptMap && coverage.missingHighPriority.length > 0 && (
            <Stat
              label="Key concepts open"
              value={String(coverage.missingHighPriority.length)}
              warn
              onClick={() => setConceptsOpen(true)}
            />
          )}
          {progress && <Stat label="Cards" value={`${progress.produced} / ${progress.cap}`} />}
        </div>
      )}

      {conceptsOpen && <ConceptSheet onClose={() => setConceptsOpen(false)} />}

      {/* Activity log */}
      <div className="border-desk-edge/60 flex min-h-0 flex-1 flex-col border-t pt-4">
        <span className="eyebrow mb-2">Activity</span>
        <div ref={logRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {logs.map((l, i) => (
            <p
              key={i}
              className={`font-data text-2xs leading-snug ${
                l.level === 'error'
                  ? 'text-brick-soft'
                  : l.level === 'warn'
                    ? 'text-lamp-deep'
                    : 'text-chalk-dim'
              }`}
            >
              {l.message}
            </p>
          ))}
        </div>
      </div>

      {/* Session actions */}
      <div className="border-desk-edge/60 border-t pt-3">
        {usage && (
          <p className="font-data text-chalk-dim mb-2 text-2xs">
            {Math.round((usage.inputTokens + usage.outputTokens) / 1000)}k tokens · $
            {usage.costUsd.toFixed(2)}
          </p>
        )}
        {doneSummary && <p className="text-chalk-dim mb-2 text-xs">{doneSummary}</p>}
        {running ? (
          <button
            onClick={cancelGeneration}
            className="btn-secondary hover:border-brick-soft/60 hover:text-brick-soft w-full px-3 py-2"
          >
            Stop generating
          </button>
        ) : (
          <button onClick={() => void backToHome()} className="btn-secondary w-full px-3 py-2">
            New session
          </button>
        )}
      </div>
    </aside>
  )
}

function Stat({
  label,
  value,
  warn,
  onClick,
}: {
  label: string
  value: string
  warn?: boolean
  onClick?: () => void
}) {
  const row = (
    <>
      <span className="text-chalk-dim text-xs">{label}</span>
      <span className={`font-data text-xs ${warn ? 'text-lamp' : 'text-chalk'}`}>{value}</span>
    </>
  )
  if (!onClick) return <div className="flex items-baseline justify-between">{row}</div>
  return (
    <button
      onClick={onClick}
      className="hover:bg-desk-raised/70 -mx-1 flex w-[calc(100%+0.5rem)] items-baseline justify-between rounded-sm px-1 transition-colors duration-150"
      aria-label={`${label}: ${value} — show the extracted concepts`}
      title="Show the extracted concepts"
    >
      {row}
    </button>
  )
}

function ErrorBanner() {
  const errorMessage = useLectern((s) => s.errorMessage)
  const hasCards = useLectern((s) => s.cards.length > 0)
  const startGeneration = useLectern((s) => s.startGeneration)
  const backToHome = useLectern((s) => s.backToHome)

  return (
    <div
      role="alert"
      className="border-brick/40 bg-brick/15 rise-in mx-6 mt-4 shrink-0 rounded-md border px-4 py-3"
    >
      <p className="text-chalk text-base font-medium">Generation stopped</p>
      <p className="text-chalk-dim mt-0.5 text-sm">
        {errorMessage ?? 'Something went wrong.'}
        {hasCards && ' The cards below are kept — review them or send them to Anki.'}
      </p>
      <div className="mt-2.5 flex gap-2">
        <button
          onClick={() => void startGeneration()}
          className="btn-primary px-3.5 py-1.5 text-sm"
        >
          Try again
        </button>
        <button onClick={() => void backToHome()} className="btn-ghost px-3 py-1.5">
          Back to start
        </button>
      </div>
    </div>
  )
}

function CardColumn() {
  const cards = useLectern((s) => s.cards)
  const phase = useLectern((s) => s.phase)
  const searchQuery = useLectern((s) => s.searchQuery)
  const setSearchQuery = useLectern((s) => s.setSearchQuery)
  const pageFilter = useLectern((s) => s.pageFilter)
  const setPageFilter = useLectern((s) => s.setPageFilter)
  const rejectedCount = useLectern((s) => s.rejectedCount)
  const selectedUid = useLectern((s) => s.selectedUid)
  const listRef = useRef<HTMLDivElement>(null)
  const isDone = phase === 'complete'
  const isError = phase === 'error'
  const reviewable = isDone || isError
  const streaming = phase === 'generating' || phase === 'reflecting'

  const visible = useMemo(() => {
    let list = cards
    if (pageFilter !== null) list = list.filter((c) => c.sourcePages.includes(pageFilter))
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((c) => Object.values(c.fields).some((v) => v.toLowerCase().includes(q)))
    }
    return list
  }, [cards, pageFilter, searchQuery])

  // Follow the stream while generating, if the user is near the bottom.
  useEffect(() => {
    const el = listRef.current
    if (!el || reviewable) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [cards.length, reviewable])

  // Keyboard review: ↑↓/jk walk the visible cards, e/↩ edits, x removes
  // (undoable), s peeks the card's source slide. Fields keep their own keys.
  useEffect(() => {
    if (!reviewable) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const state = useLectern.getState()
      if (state.editingUid || state.settingsOpen) return
      const index = visible.findIndex((c) => c.uid === state.selectedUid)
      const select = (i: number) => state.setSelectedUid(visible[i]?.uid ?? null)

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          if (visible.length > 0) select(index === -1 ? 0 : Math.min(visible.length - 1, index + 1))
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          if (visible.length > 0) select(index === -1 ? visible.length - 1 : Math.max(0, index - 1))
          break
        case 'e':
        case 'Enter':
          if (index !== -1) {
            e.preventDefault()
            state.setEditingUid(visible[index].uid)
          }
          break
        case 'x':
        case 'Backspace':
        case 'Delete':
          if (index !== -1) {
            e.preventDefault()
            const next = visible[index + 1] ?? visible[index - 1]
            state.setSelectedUid(next?.uid ?? null)
            state.removeCard(visible[index].uid)
          }
          break
        case 's':
          if (index !== -1) {
            const page = visible[index].sourcePages[0]
            if (page !== undefined) {
              e.preventDefault()
              state.peekSlide(state.slidePeek === page ? null : page)
            }
          }
          break
        case 'Escape':
          // The slide peek's own Esc wins while it is open.
          if (state.slidePeek === null) state.setSelectedUid(null)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [reviewable, visible])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {reviewable && cards.length > 0 && (
        <div className="mx-auto flex w-full max-w-2xl shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-6 pt-4 pb-1">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setSearchQuery('')}
            placeholder="Search cards"
            className="field w-56 px-3 py-1.5 text-sm"
            aria-label="Search cards"
          />
          {pageFilter !== null && (
            <button
              onClick={() => setPageFilter(null)}
              className="bg-lamp/15 font-data text-lamp hover:bg-lamp/25 rounded-full px-2.5 py-1 text-2xs transition-colors duration-150"
              aria-label={`Stop filtering by page ${pageFilter}`}
            >
              page {pageFilter} ✕
            </button>
          )}
          <div className="ml-auto flex flex-row-reverse flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span aria-live="polite" className="font-data text-chalk-dim text-xs whitespace-nowrap">
              {visible.length} of {cards.length} cards
              {rejectedCount > 0 && ` · ${rejectedCount} rejected by the quality gate`}
            </span>
            <span
              aria-hidden
              className="font-data text-chalk-dim/70 text-2xs whitespace-nowrap"
              title="Keyboard review: ↑↓ select a card, e edit, x remove, s show its slide"
            >
              ↑↓ select · e edit · x remove · s slide
            </span>
          </div>
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {visible.length === 0 ? (
          <Empty phase={phase} filtered={cards.length > 0} />
        ) : (
          <div className="mx-auto max-w-2xl space-y-3 pb-24">
            {visible.map((card, i) => (
              <CardTile
                key={card.uid}
                card={card}
                editable={reviewable}
                selected={reviewable && card.uid === selectedUid}
                animate={!reviewable && i >= cards.length - 3}
              />
            ))}
            {/* The next card, forming. */}
            {streaming && <div aria-hidden className="bg-paper/8 h-10 animate-pulse rounded-md" />}
          </div>
        )}
      </div>
    </div>
  )
}

function Empty({ phase, filtered }: { phase: AppPhase; filtered: boolean }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-chalk-dim text-base">
        {filtered
          ? 'No cards match — clear the search or page filter.'
          : phase === 'complete'
            ? 'No cards made it through. Try a larger deck size or a different focus.'
            : phase === 'error'
              ? 'No cards had been accepted before the stop.'
              : 'Reading the lecture…'}
      </p>
    </div>
  )
}
