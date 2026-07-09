import { useEffect, useRef, useState } from 'react'
import { renderNoteMarkdown } from '../lib/render'
import type { LogLine } from '../state/store'
import { useLectern } from '../state/store'

/**
 * The session minutes: a mono elapsed-time gutter stamps each event, the
 * app narrates in sans, and prose from the model (quality notes, rejected
 * card fronts) is quoted in serif behind a rule, clamped until opened.
 * After generation, the user speaks here too — follow-up card requests are
 * typed into the composer below the log and quoted like the model's prose,
 * behind a lamp-colored rule.
 */
export function ActivityLog() {
  const logs = useLectern((s) => s.logs)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [logs.length])

  const t0 = logs[0]?.at ?? 0

  return (
    <div
      ref={scrollRef}
      className="scroll-fade-y min-h-0 flex-1 space-y-2 overflow-y-auto pt-1 pr-1 pb-2"
    >
      {logs.map((line, i) => {
        const time = stamp(line.at - t0)
        const prevTime = i > 0 ? stamp(logs[i - 1].at - t0) : null
        return <Entry key={i} line={line} time={time === prevTime ? null : time} />
      })}
    </div>
  )
}

function stamp(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const MESSAGE_COLOR: Record<LogLine['level'], string> = {
  info: 'text-chalk-dim',
  warn: 'text-lamp-deep',
  error: 'text-brick-soft',
}

function Entry({ line, time }: { line: LogLine; time: string | null }) {
  return (
    <div className="flex gap-2">
      <span
        aria-hidden={time === null}
        className="font-data text-2xs text-chalk-dim/60 w-9 shrink-0 pt-px text-right"
      >
        {time}
      </span>
      <div className="min-w-0 flex-1">
        {line.speaker === 'user' ? (
          <div className="border-lamp/50 border-l-2 pl-2">
            <span className="eyebrow block">You</span>
            <p className="log-quote leading-snug break-words">{line.message}</p>
          </div>
        ) : (
          <p className={`text-xs leading-snug break-words ${MESSAGE_COLOR[line.level]}`}>
            {line.message}
          </p>
        )}
        {line.quote && <Quote text={line.quote} />}
      </div>
    </div>
  )
}

/**
 * The follow-up composer: one line at the foot of the minutes where the user
 * asks for additional cards ("add cards on X"). Additions only — requests
 * never edit the reviewed deck.
 */
export function FollowUpComposer() {
  const busy = useLectern((s) => s.followUpBusy)
  const requestMoreCards = useLectern((s) => s.requestMoreCards)
  const cancelGeneration = useLectern((s) => s.cancelGeneration)
  const [draft, setDraft] = useState('')

  const submit = () => {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    void requestMoreCards(text)
  }

  return (
    <div className="mt-2 shrink-0">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
          if (e.key === 'Escape') setDraft('')
        }}
        maxLength={500}
        disabled={busy}
        placeholder={busy ? 'Adding cards…' : 'Request more cards…'}
        aria-label="Request more cards"
        title="Ask for cards on a missing topic or an emphasis — e.g. “add cards on the trolley problem”"
        className="field w-full px-2.5 py-1.5 text-xs"
      />
      {busy && (
        <div className="mt-1 flex items-baseline justify-between">
          <span className="font-data text-2xs text-chalk-dim animate-pulse">Working on it…</span>
          <button
            onClick={cancelGeneration}
            className="font-data text-2xs text-chalk-dim hover:text-brick-soft transition-colors duration-150"
          >
            stop
          </button>
        </div>
      )}
    </div>
  )
}

/** A quoted excerpt from the model, clamped to three lines until opened. */
function Quote({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  // ~28 serif characters fit per sidebar line; under three lines, skip the toggle.
  const clampable = text.length > 84
  const body = (
    <span
      className={`log-quote ${clampable && !open ? 'line-clamp-3' : 'block'}`}
      dangerouslySetInnerHTML={{ __html: renderNoteMarkdown(text) }}
    />
  )

  if (!clampable) {
    return <div className="border-desk-edge mt-1 border-l-2 pl-2">{body}</div>
  }
  return (
    <button
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      className="border-desk-edge hover:border-chalk-dim/60 mt-1 block w-full border-l-2 pl-2 text-left transition-colors duration-150"
    >
      {body}
      <span className="font-data text-2xs text-chalk-dim/70 mt-0.5 block">
        {open ? 'less' : 'more'}
      </span>
    </button>
  )
}
