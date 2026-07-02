import { useEffect } from 'react'
import { useLectern } from '../state/store'

export function SyncBar() {
  const cards = useLectern((s) => s.cards)
  const deckName = useLectern((s) => s.deckName)
  const ankiStatus = useLectern((s) => s.ankiStatus)
  const refreshAnki = useLectern((s) => s.refreshAnki)
  const syncState = useLectern((s) => s.syncState)
  const syncPreview = useLectern((s) => s.syncPreview)
  const syncProgress = useLectern((s) => s.syncProgress)
  const syncResult = useLectern((s) => s.syncResult)
  const previewSyncNow = useLectern((s) => s.previewSyncNow)
  const syncNow = useLectern((s) => s.syncNow)

  const canSend = ankiStatus === 'connected' && syncState !== 'syncing' && cards.length > 0

  // ⌘↩ sends — the review flow's one power shortcut.
  useEffect(() => {
    if (!canSend) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        // Leave ⌘↩ to the card editor when one is open.
        if (e.target instanceof Element && e.target.closest('textarea')) return
        e.preventDefault()
        void syncNow()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canSend, syncNow])

  if (cards.length === 0) return null

  return (
    <div className="border-desk-edge/60 bg-desk/95 absolute inset-x-0 bottom-0 border-t px-6 py-3 backdrop-blur">
      <div aria-live="polite" className="mx-auto flex max-w-2xl items-center gap-4">
        {ankiStatus !== 'connected' ? (
          <>
            <p className="text-chalk-dim flex-1 text-sm">
              Anki isn&apos;t reachable. Open Anki with the AnkiConnect add-on installed, then try
              again.
            </p>
            <button onClick={() => void refreshAnki()} className="btn-secondary px-3 py-2">
              Check again
            </button>
          </>
        ) : syncState === 'syncing' ? (
          <>
            <div
              role="progressbar"
              aria-label="Sending cards to Anki"
              aria-valuemin={0}
              aria-valuemax={syncProgress?.total ?? cards.length}
              aria-valuenow={syncProgress?.done ?? 0}
              className="bg-desk-edge h-1 flex-1 overflow-hidden rounded-full"
            >
              <div
                className="bg-lamp h-full transition-[width] duration-200 ease-out"
                style={{
                  width: `${syncProgress ? (100 * syncProgress.done) / syncProgress.total : 0}%`,
                }}
              />
            </div>
            <span className="font-data text-chalk-dim text-xs">
              {syncProgress?.done ?? 0} / {syncProgress?.total ?? cards.length}
            </span>
          </>
        ) : syncState === 'done' && syncResult ? (
          <>
            <p className="text-chalk flex-1 text-sm">
              Sent {syncResult.created + syncResult.updated} cards to “{deckName}”.
              {syncResult.failures.length > 0 && (
                <span className="text-brick-soft">
                  {' '}
                  {syncResult.failures.length} failed — see Activity.
                </span>
              )}
            </p>
            <button onClick={() => void syncNow()} className="btn-secondary px-3 py-2">
              Send again
            </button>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-chalk truncate text-sm">
                {cards.length} cards → <span className="font-medium">{deckName}</span>
              </p>
              {syncPreview && (
                <p className="font-data text-chalk-dim truncate text-xs">
                  {syncPreview.toCreate} new · {syncPreview.toUpdate} updates
                  {syncPreview.duplicates > 0 && ` · ${syncPreview.duplicates} already in Anki`}
                </p>
              )}
            </div>
            <button
              onClick={() => void previewSyncNow()}
              disabled={syncState === 'previewing'}
              className="btn-secondary px-3 py-2"
            >
              {syncState === 'previewing' ? 'Checking…' : 'Preview'}
            </button>
            <button
              onClick={() => void syncNow()}
              className="btn-primary px-4 py-2"
              title="Send to Anki (⌘↩)"
            >
              Send to Anki
            </button>
          </>
        )}
      </div>
    </div>
  )
}
