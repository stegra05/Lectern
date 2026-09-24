import { useEffect, useState, type ReactNode } from 'react'
import { waitCause } from '../lib/problems'
import { useLectern } from '../state/store'

/**
 * "Rate limit · retry in 0:32" while a retry wait runs. Without it
 * a paused run showed only a pulsing dot for up to a minute, and the reason
 * sat in the activity log where nobody was looking.
 */
export function WaitNote({
  className = '',
  fallback = null,
}: {
  className?: string
  /** Shown instead while no wait is running. */
  fallback?: ReactNode
}) {
  const wait = useLectern((s) => s.wait)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!wait) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [wait])

  if (!wait) return fallback
  // `now` is from the last tick, which can predate this wait; it never
  // lasts longer than it was announced to.
  const seconds = Math.min(Math.ceil((wait.until - now) / 1000), Math.ceil(wait.waitMs / 1000))
  if (seconds <= 0) return fallback

  return (
    // No live region: a countdown announced every second is noise. The wait
    // itself lands in the activity log.
    <p className={`font-data text-lamp-deep text-2xs ${className}`}>
      {waitCause(wait.status)} · retry in {Math.floor(seconds / 60)}:
      {String(seconds % 60).padStart(2, '0')}
    </p>
  )
}
