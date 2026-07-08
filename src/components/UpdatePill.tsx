import { useEffect, useState } from 'react'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { IS_TAURI } from '../lib/platform'
import { useLectern } from '../state/store'

// Checked once per launch, a few seconds in so it never competes with startup.
const CHECK_DELAY_MS = 5000

export function UpdatePill() {
  const [update, setUpdate] = useState<Update | null>(null)
  const [percent, setPercent] = useState<number | null>(null)
  const toast = useLectern((s) => s.toast)

  useEffect(() => {
    if (!IS_TAURI) return
    const timer = setTimeout(() => {
      check()
        .then((u) => {
          if (u) setUpdate(u)
        })
        .catch((e) => {
          // Offline or endpoint unreachable is normal; never bother the user.
          console.warn('Update check failed:', e)
        })
    }, CHECK_DELAY_MS)
    return () => clearTimeout(timer)
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
      toast('error', `Update failed: ${(e as Error).message}`)
    }
  }

  return (
    <div className="rise-in bg-desk-raised ring-desk-edge shadow-card absolute right-4 bottom-4 z-40 flex items-center gap-3 rounded-md px-4 py-2.5 text-sm ring-1">
      {percent === null ? (
        <>
          <span className="text-chalk">Version {update.version} is available.</span>
          <button
            onClick={() => void install()}
            className="text-lamp rounded-sm font-semibold underline-offset-2 transition-opacity duration-150 hover:underline"
          >
            Install and restart
          </button>
          <button
            onClick={() => setUpdate(null)}
            aria-label="Dismiss"
            className="text-chalk -m-1 rounded-sm p-1 opacity-70 transition-opacity duration-150 hover:opacity-100"
          >
            ✕
          </button>
        </>
      ) : (
        <span className="text-chalk" role="status">
          {percent < 100 ? `Downloading update… ${percent}%` : 'Restarting…'}
        </span>
      )}
    </div>
  )
}
