import { useEffect } from 'react'
import { isSyncable } from '../engine/anki'
import { useLectern } from '../state/store'

/** Settling time before re-asking Anki what the send would do, so removing a
 *  run of cards costs one round trip rather than one per keystroke. */
const PREVIEW_DEBOUNCE_MS = 400

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

  const syncable = cards.filter(isSyncable)
  // Two different reasons a card stays behind, and they read very differently
  // to the user: one is already in Anki, the other was deliberately withheld.
  const inherited = cards.filter((c) => c.fromAnki).length
  const excluded = cards.length - syncable.length - inherited
  const canSend = ankiStatus === 'connected' && syncState !== 'syncing' && syncable.length > 0

  // What the send will actually do — how many are new, how many update a note
  // already in Anki, how many Anki would refuse as duplicates — is the whole
  // question this bar has to answer. It used to hide behind a "Preview"
  // button; now it just appears, and follows the deck as cards are removed or
  // an inherited card is edited into the send.
  const syncableKey = syncable.map((c) => c.uid).join(',')
  const previewable = ankiStatus === 'connected' && syncState === 'idle' && syncableKey !== ''
  useEffect(() => {
    if (!previewable) return
    const timer = window.setTimeout(() => void previewSyncNow(), PREVIEW_DEBOUNCE_MS)
    // Coming back from Anki is where the answer changes without the deck
    // changing — a duplicate deleted over there, a note edited by hand.
    const onFocus = () => void previewSyncNow()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [previewable, syncableKey, deckName, previewSyncNow])

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

  // Only the parts the headline "N cards → deck" does not already say: a
  // straight send of N brand-new cards needs no second line at all.
  const detail: string[] = []
  if (syncPreview && (syncPreview.toUpdate > 0 || syncPreview.duplicates > 0)) {
    detail.push(`${syncPreview.toCreate} new`)
    if (syncPreview.toUpdate > 0) detail.push(`${syncPreview.toUpdate} updated`)
    if (syncPreview.duplicates > 0) detail.push(`${syncPreview.duplicates} already in Anki`)
  }
  if (inherited > 0) detail.push(`${inherited} kept from the deck, unchanged`)
  if (excluded > 0) {
    detail.push(
      `${excluded} outside-source card${excluded === 1 ? '' : 's'} ` +
        `stay${excluded === 1 ? 's' : ''} behind`,
    )
  }

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
                {syncable.length} {syncable.length === 1 ? 'card' : 'cards'} →{' '}
                <span className="font-medium">{deckName}</span>
              </p>
              {detail.length > 0 && (
                <p className="font-data text-chalk-dim truncate text-xs">{detail.join(' · ')}</p>
              )}
            </div>
            <button
              onClick={() => void syncNow()}
              disabled={syncable.length === 0}
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
