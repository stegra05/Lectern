import { useEffect } from 'react'
import { isSyncable } from '../engine/anki'
import { count } from '../engine/plural'
import { ankiCardCount } from '../engine/quality'
import { LINKS } from '../lib/links'
import { useLectern } from '../state/store'
import { ExternalLink } from './ExternalLink'

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
  const openDeckInAnki = useLectern((s) => s.openDeckInAnki)
  const editingUid = useLectern((s) => s.editingUid)

  const syncable = cards.filter(isSyncable)
  // Two different reasons a card stays behind, and they read very differently
  // to the user: one is already in Anki, the other was deliberately withheld.
  // Only the ones still untouched: an edited inherited card is in the send,
  // as an update to the note it came from.
  const inherited = cards.filter((c) => c.fromAnki && !c.edited).length
  const excluded = cards.length - syncable.length - inherited
  // Not while a card editor is open: ⌘↩ is advertised inside it as "saves",
  // and it used to also push the whole deck to Anki.
  const canSend =
    ankiStatus === 'connected' && syncState !== 'syncing' && syncable.length > 0 && !editingUid

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

  // The second line carries only counts that change what the send does,
  // and only when there is one: a straight send of brand-new cards needs
  // none. Why the numbers are what they are sits in the tooltip.
  const detail: string[] = []
  if (syncPreview && (syncPreview.toUpdate > 0 || syncPreview.duplicates > 0)) {
    detail.push(`${syncPreview.toCreate} new`)
    if (syncPreview.toUpdate > 0) detail.push(`${syncPreview.toUpdate} updated`)
    if (syncPreview.duplicates > 0) detail.push(`${syncPreview.duplicates} already in Anki`)
  }
  if (excluded > 0) detail.push(`${excluded} left out`)

  const why: string[] = []
  // A cloze note with three deletions is three cards to study, while the
  // deck size the user chose counts notes.
  const ankiCards = syncable.reduce((total, card) => total + ankiCardCount(card), 0)
  if (ankiCards > syncable.length) {
    why.push(`${ankiCards} cards to study, since a cloze makes one per blank.`)
  }
  if (inherited > 0) {
    why.push(`${count(inherited, 'card')} already in the deck stay as they are.`)
  }
  if (excluded > 0) why.push('Cards not from the lecture stay out until you include them.')

  return (
    <div className="border-desk-edge/60 bg-desk/95 absolute inset-x-0 bottom-0 border-t px-6 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-4">
        {ankiStatus !== 'connected' ? (
          <>
            <p className="text-chalk-dim flex-1 text-sm">
              Anki isn&apos;t reachable. Open Anki with the AnkiConnect add-on installed, then try
              again.{' '}
              <ExternalLink href={LINKS.ankiConnect} className="hover:text-chalk">
                Get AnkiConnect
              </ExternalLink>
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
              aria-valuetext={`${syncProgress?.done ?? 0} of ${syncProgress?.total ?? cards.length} cards sent`}
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
          <div aria-live="polite" className="flex flex-1 items-center gap-4">
            <p className="text-chalk flex-1 text-sm">
              Sent {count(syncResult.created + syncResult.updated, 'card')} to “{deckName}”.
              {syncResult.duplicates.length > 0 && (
                <span className="text-chalk-dim">
                  {' '}
                  {syncResult.duplicates.length} already there, left alone.
                </span>
              )}
              {syncResult.failures.length > 0 && (
                <span className="text-brick-soft">
                  {' '}
                  {syncResult.failures.length} failed. See Activity.
                </span>
              )}
            </p>
            {/* Where the cards went is the natural next step; Send again only
                matters after an edit, which resets this bar anyway. */}
            <button onClick={() => void openDeckInAnki()} className="btn-secondary px-3 py-2">
              Open in Anki
            </button>
            <button onClick={() => void syncNow()} className="btn-ghost px-3 py-2">
              Send again
            </button>
          </div>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <p
                className="text-chalk truncate text-sm"
                title={why.length > 0 ? why.join(' ') : undefined}
              >
                {count(syncable.length, 'card')} → <span className="font-medium">{deckName}</span>
              </p>
              {detail.length > 0 && (
                <p className="font-data text-chalk-dim truncate text-xs" title={why.join(' ')}>
                  {detail.join(' · ')}
                </p>
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
