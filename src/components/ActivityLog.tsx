import { useEffect, useRef, useState } from 'react'
import { renderNoteMarkdown } from '../lib/render'
import type { LogLine } from '../state/store'
import { useLectern } from '../state/store'

/**
 * The session minutes: a mono elapsed-time gutter stamps each event, the
 * app narrates in sans, and prose from the model (quality notes, rejected
 * card fronts) is quoted in serif behind a rule, clamped until opened.
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
        <p className={`text-xs leading-snug break-words ${MESSAGE_COLOR[line.level]}`}>
          {line.message}
        </p>
        {line.quote && <Quote text={line.quote} />}
      </div>
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
