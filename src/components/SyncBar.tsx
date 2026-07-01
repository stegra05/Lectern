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

  if (cards.length === 0) return null

  return (
    <div className="absolute inset-x-0 bottom-0 border-t border-desk-edge/60 bg-desk/95 px-6 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-4">
        {ankiStatus !== 'connected' ? (
          <>
            <p className="flex-1 text-[13px] text-chalk-dim">
              Anki isn&apos;t reachable. Open Anki with the AnkiConnect add-on installed, then try
              again.
            </p>
            <button
              onClick={() => void refreshAnki()}
              className="rounded-md border border-desk-edge px-3 py-2 text-[13px] text-chalk hover:border-chalk-dim"
            >
              Check again
            </button>
          </>
        ) : syncState === 'syncing' ? (
          <>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-desk-edge">
              <div
                className="h-full bg-lamp transition-[width] duration-200"
                style={{
                  width: `${syncProgress ? (100 * syncProgress.done) / syncProgress.total : 0}%`,
                }}
              />
            </div>
            <span className="font-data text-[12px] text-chalk-dim">
              {syncProgress?.done ?? 0} / {syncProgress?.total ?? cards.length}
            </span>
          </>
        ) : syncState === 'done' && syncResult ? (
          <>
            <p className="flex-1 text-[13px] text-chalk">
              Sent {syncResult.created + syncResult.updated} cards to “{deckName}”.
              {syncResult.failures.length > 0 && (
                <span className="text-brick"> {syncResult.failures.length} failed — see Activity.</span>
              )}
            </p>
            <button
              onClick={() => void syncNow()}
              className="rounded-md border border-desk-edge px-3 py-2 text-[13px] text-chalk hover:border-chalk-dim"
            >
              Send again
            </button>
          </>
        ) : (
          <>
            <p className="flex-1 font-data text-[12px] text-chalk-dim">
              {cards.length} cards → “{deckName}”
              {syncPreview &&
                ` · ${syncPreview.toCreate} new · ${syncPreview.toUpdate} updates` +
                  (syncPreview.duplicates > 0 ? ` · ${syncPreview.duplicates} already in Anki` : '')}
            </p>
            <button
              onClick={() => void previewSyncNow()}
              disabled={syncState === 'previewing'}
              className="rounded-md border border-desk-edge px-3 py-2 text-[13px] text-chalk hover:border-chalk-dim disabled:opacity-50"
            >
              {syncState === 'previewing' ? 'Checking…' : 'Preview'}
            </button>
            <button
              onClick={() => void syncNow()}
              className="rounded-md bg-lamp px-4 py-2 text-[13px] font-semibold text-ink hover:bg-lamp-deep"
            >
              Send to Anki
            </button>
          </>
        )}
      </div>
    </div>
  )
}
