import { useLectern } from '../state/store'
import { ExternalLink } from './ExternalLink'

/** Removing eight weak cards used to leave eight identical undo toasts
 *  stacked over the card list, each swallowing clicks for 30 seconds. */
const MAX_VISIBLE = 3

export function Toasts() {
  const all = useLectern((s) => s.toasts)
  const dismissToast = useLectern((s) => s.dismissToast)
  const toasts = all.slice(-MAX_VISIBLE)
  const hidden = all.length - toasts.length

  // The container mounts with the app, not with the first toast: a live
  // region announced only when it appears is a live region that is missed.
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-16 z-50 flex flex-col items-center gap-2"
    >
      {hidden > 0 && (
        <div className="bg-desk-raised text-chalk-dim ring-desk-edge rounded-md px-3 py-1 text-2xs ring-1">
          {hidden} more
        </div>
      )}
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={`rise-in pointer-events-auto flex max-w-lg items-center gap-3 rounded-md px-4 py-2.5 text-sm shadow-card ${
            t.kind === 'error'
              ? 'bg-brick text-paper'
              : t.kind === 'success'
                ? 'bg-sage text-ink'
                : 'bg-desk-raised text-chalk ring-desk-edge ring-1'
          }`}
        >
          <span className="min-w-0">
            <span className="block">{t.message}</span>
            {t.detail && <span className="block text-xs opacity-85">{t.detail}</span>}
            {t.link && (
              <ExternalLink href={t.link.url} className="text-xs hover:opacity-80">
                {t.link.label}
              </ExternalLink>
            )}
          </span>
          {t.action && (
            <button
              onClick={() => {
                t.action?.run()
                dismissToast(t.id)
              }}
              className="shrink-0 rounded-sm font-semibold underline underline-offset-2 transition-opacity duration-150 hover:opacity-80"
            >
              {t.action.label}
            </button>
          )}
          <button
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss this message"
            className="-m-1 rounded-sm p-1 opacity-70 transition-opacity duration-150 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
