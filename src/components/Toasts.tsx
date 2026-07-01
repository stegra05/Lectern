import { useLectern } from '../state/store'

export function Toasts() {
  const toasts = useLectern((s) => s.toasts)
  const dismissToast = useLectern((s) => s.dismissToast)

  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-16 z-50 flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-3 rounded-md px-4 py-2.5 text-[13px] shadow-lg ${
            t.kind === 'error'
              ? 'bg-brick text-paper'
              : t.kind === 'success'
                ? 'bg-sage text-ink'
                : 'bg-desk-raised text-chalk ring-1 ring-desk-edge'
          }`}
        >
          <span>{t.message}</span>
          {t.undo && (
            <button
              onClick={() => {
                t.undo?.()
                dismissToast(t.id)
              }}
              className="font-semibold underline underline-offset-2"
            >
              Undo
            </button>
          )}
          <button onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
