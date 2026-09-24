import { useEffect, useState } from 'react'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { LINKS } from '../lib/links'
import { IS_TAURI } from '../lib/platform'
import { useLectern } from '../state/store'
import { ExternalLink } from './ExternalLink'

// First check a few seconds in, so it never competes with startup.
const CHECK_DELAY_MS = 5000
// A check stays fresh this long. The app often stays open for days, and a
// once-per-launch check never saw a release published while it was running.
const RECHECK_AFTER_MS = 6 * 60 * 60 * 1000

export function UpdatePill() {
  const [update, setUpdate] = useState<Update | null>(null)
  const [percent, setPercent] = useState<number | null>(null)
  const showProblem = useLectern((s) => s.showProblem)

  useEffect(() => {
    if (!IS_TAURI) return
    let lastCheck = 0
    // Once a release is found (or dismissed), this launch has said its piece.
    let found = false
    const run = () => {
      if (found) return
      lastCheck = Date.now()
      check()
        .then((u) => {
          if (!u) return
          found = true
          setUpdate(u)
        })
        .catch((e) => {
          // Offline or endpoint unreachable is normal; never bother the user.
          console.warn('Update check failed:', e)
        })
    }
    const onFocus = () => {
      if (lastCheck > 0 && Date.now() - lastCheck > RECHECK_AFTER_MS) run()
    }
    const first = setTimeout(run, CHECK_DELAY_MS)
    const recheck = setInterval(run, RECHECK_AFTER_MS)
    window.addEventListener('focus', onFocus)
    return () => {
      clearTimeout(first)
      clearInterval(recheck)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  if (!update) return null

  const install = async () => {
    setPercent(0)
    let total = 0
    let received = 0
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength
          if (total > 0) setPercent(Math.min(99, Math.round((received / total) * 100)))
        } else if (event.event === 'Finished') {
          setPercent(100)
        }
      })
      await relaunch()
    } catch (e) {
      setUpdate(null)
      setPercent(null)
      showProblem(e, 'updating')
    }
  }

  return (
    // Bottom left: the bottom-right corner belongs to the send bar's primary
    // button, and the top-right corner turned out to sit on the filmstrip,
    // covering — and blocking clicks on — the last few slides all session.
    <div
      role="status"
      className="rise-in bg-desk-raised ring-desk-edge shadow-card absolute bottom-4 left-4 z-20 flex items-center gap-3 rounded-md px-4 py-2.5 text-sm ring-1"
    >
      {percent === null ? (
        <>
          <span className="text-chalk">
            Version {update.version} is available.{' '}
            <ExternalLink
              href={LINKS.changelog}
              className="text-chalk-dim hover:text-chalk text-xs"
            >
              What’s new
            </ExternalLink>
          </span>
          <button
            onClick={() => void install()}
            className="text-lamp rounded-sm font-semibold underline-offset-2 transition-opacity duration-150 hover:underline"
          >
            Install and restart
          </button>
          <button
            onClick={() => setUpdate(null)}
            aria-label="Dismiss the update notice"
            className="text-chalk -m-1 rounded-sm p-1 opacity-70 transition-opacity duration-150 hover:opacity-100"
          >
            ✕
          </button>
        </>
      ) : (
        <span className="text-chalk">
          {percent < 100 ? `Downloading update… ${percent}%` : 'Restarting…'}
        </span>
      )}
    </div>
  )
}
