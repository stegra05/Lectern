import { useEffect, useMemo, useRef } from 'react'
import type { AppPhase } from '../state/store'
import { useLectern } from '../state/store'
import { CardTile } from './CardTile'
import { Filmstrip } from './Filmstrip'
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
  const isDone = phase === 'complete'
  const isError = phase === 'error'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Filmstrip interactive={isDone} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <section className="relative flex min-w-0 flex-1 flex-col">
          {isError ? <ErrorPanel /> : <CardColumn />}
          {isDone && <SyncBar />}
        </section>
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

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [logs.length])

  const running = phase !== 'complete' && phase !== 'error' && phase !== 'idle'
  const phaseIndex = PHASES.findIndex((p) => p.id === phase)

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-5 border-r border-desk-edge/60 p-4">
      {/* Phase register */}
      <ol className="space-y-1.5">
        {PHASES.map((p, i) => {
          const state = i < phaseIndex ? 'done' : i === phaseIndex ? 'now' : 'ahead'
          return (
            <li key={p.id} className="flex items-center gap-2.5">
              <span
                className={`size-1.5 rounded-full ${
                  state === 'done' ? 'bg-lamp/60' : state === 'now' ? 'bg-lamp animate-pulse' : 'bg-desk-edge'
                }`}
              />
              <span
                className={`text-[13px] ${
                  state === 'now' ? 'font-medium text-chalk' : state === 'done' ? 'text-chalk-dim' : 'text-chalk-dim/50'
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
        <dl className="space-y-1.5 border-t border-desk-edge/60 pt-4">
          <Stat label="Pages covered" value={`${Math.round(coverage.pageCoveragePercent)}%`} />
          <Stat
            label="Concepts"
            value={`${Math.round(coverage.effectiveConceptCoveragePercent)}%`}
          />
          {conceptMap && coverage.missingHighPriority.length > 0 && (
            <Stat label="High-priority open" value={String(coverage.missingHighPriority.length)} warn />
          )}
          {progress && <Stat label="Cards" value={`${progress.produced} / ${progress.cap}`} />}
        </dl>
      )}

      {/* Activity log */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-desk-edge/60 pt-4">
        <span className="eyebrow mb-2">Activity</span>
        <div ref={logRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {logs.map((l, i) => (
            <p
              key={i}
              className={`font-data text-[11px] leading-snug ${
                l.level === 'error' ? 'text-brick' : l.level === 'warn' ? 'text-lamp-deep' : 'text-chalk-dim'
              }`}
            >
              {l.message}
            </p>
          ))}
        </div>
      </div>

      {/* Session actions */}
      <div className="border-t border-desk-edge/60 pt-3">
        {usage && (
          <p className="mb-2 font-data text-[11px] text-chalk-dim">
            {Math.round((usage.inputTokens + usage.outputTokens) / 1000)}k tokens · $
            {usage.costUsd.toFixed(2)}
          </p>
        )}
        {doneSummary && <p className="mb-2 text-[12px] text-chalk-dim">{doneSummary}</p>}
        {running ? (
          <button
            onClick={cancelGeneration}
            className="w-full rounded-md border border-desk-edge px-3 py-2 text-[13px] text-chalk hover:border-brick hover:text-brick"
          >
            Stop generating
          </button>
        ) : (
          <button
            onClick={backToHome}
            className="w-full rounded-md border border-desk-edge px-3 py-2 text-[13px] text-chalk hover:border-chalk-dim"
          >
            New session
          </button>
        )}
      </div>
    </aside>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-[12px] text-chalk-dim">{label}</dt>
      <dd className={`font-data text-[12px] ${warn ? 'text-lamp' : 'text-chalk'}`}>{value}</dd>
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
  const listRef = useRef<HTMLDivElement>(null)
  const isDone = phase === 'complete'

  const visible = useMemo(() => {
    let list = cards
    if (pageFilter !== null) list = list.filter((c) => c.sourcePages.includes(pageFilter))
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((c) =>
        Object.values(c.fields).some((v) => v.toLowerCase().includes(q)),
      )
    }
    return list
  }, [cards, pageFilter, searchQuery])

  // Follow the stream while generating, if the user is near the bottom.
  useEffect(() => {
    const el = listRef.current
    if (!el || isDone) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 240
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [cards.length, isDone])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isDone && (
        <div className="mx-auto flex w-full max-w-2xl shrink-0 items-center gap-3 px-6 pt-4 pb-1">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search cards"
            className="w-56 rounded-md bg-desk-raised px-3 py-1.5 text-[13px] text-chalk placeholder:text-chalk-dim/60"
            aria-label="Search cards"
          />
          {pageFilter !== null && (
            <button
              onClick={() => setPageFilter(null)}
              className="rounded-full bg-lamp/15 px-2.5 py-1 font-data text-[11px] text-lamp hover:bg-lamp/25"
            >
              page {pageFilter} ✕
            </button>
          )}
          <span className="ml-auto font-data text-[12px] text-chalk-dim">
            {visible.length} of {cards.length} cards
            {rejectedCount > 0 && ` · ${rejectedCount} rejected by the quality gate`}
          </span>
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {visible.length === 0 ? (
          <Empty isDone={isDone} filtered={cards.length > 0} />
        ) : (
          <div className="mx-auto max-w-2xl space-y-3 pb-24">
            {visible.map((card, i) => (
              <CardTile
                key={card.uid}
                card={card}
                editable={isDone}
                animate={!isDone && i >= cards.length - 3}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Empty({ isDone, filtered }: { isDone: boolean; filtered: boolean }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-[14px] text-chalk-dim">
        {filtered
          ? 'No cards match — clear the search or page filter.'
          : isDone
            ? 'No cards made it through. Try a larger deck size or a different focus.'
            : 'Reading the lecture…'}
      </p>
    </div>
  )
}

function ErrorPanel() {
  const errorMessage = useLectern((s) => s.errorMessage)
  const backToHome = useLectern((s) => s.backToHome)
  const cards = useLectern((s) => s.cards)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8">
      <p className="max-w-md text-center text-[14px] text-chalk">
        {errorMessage ?? 'Generation failed.'}
      </p>
      {cards.length > 0 && (
        <p className="text-[13px] text-chalk-dim">
          {cards.length} cards were generated before the error — go back to keep or discard them.
        </p>
      )}
      <button
        onClick={backToHome}
        className="rounded-md bg-lamp px-4 py-2 text-[14px] font-semibold text-ink hover:bg-lamp-deep"
      >
        Back to start
      </button>
    </div>
  )
}
