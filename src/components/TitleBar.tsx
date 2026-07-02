import { useLectern } from '../state/store'

export function TitleBar() {
  const ankiStatus = useLectern((s) => s.ankiStatus)
  const hasApiKey = useLectern((s) => s.hasApiKey)
  const openSettings = useLectern((s) => s.openSettings)

  return (
    <header
      data-tauri-drag-region
      className="border-desk-edge/60 flex h-11 shrink-0 items-center gap-3 border-b pr-3 pl-[84px]"
    >
      <span data-tauri-drag-region className="eyebrow text-chalk select-none">
        Lectern
      </span>
      <div data-tauri-drag-region className="flex-1" />

      <Status
        label="Anki"
        tone={ankiStatus === 'connected' ? 'ok' : ankiStatus === 'checking' ? 'wait' : 'bad'}
        title={
          ankiStatus === 'connected'
            ? 'Anki is connected'
            : ankiStatus === 'checking'
              ? 'Checking Anki…'
              : "Anki isn't reachable — open Anki with the AnkiConnect add-on"
        }
      />
      <Status
        label="Gemini"
        tone={hasApiKey ? 'ok' : 'bad'}
        title={hasApiKey ? 'API key saved' : 'No API key — add one in Settings'}
      />

      <button
        id="settings-trigger"
        onClick={() => openSettings(true)}
        className="btn-ghost px-2.5 py-1"
        aria-label="Open settings"
        title="Settings (⌘,)"
      >
        Settings
      </button>
    </header>
  )
}

function Status({
  label,
  tone,
  title,
}: {
  label: string
  tone: 'ok' | 'bad' | 'wait'
  title: string
}) {
  const dot =
    tone === 'ok' ? 'bg-sage' : tone === 'wait' ? 'bg-chalk-dim animate-pulse' : 'bg-brick-soft'
  return (
    <span className="flex items-center gap-1.5" role="status" title={title} aria-label={title}>
      <span className={`size-1.5 rounded-full ${dot}`} />
      <span className="eyebrow">{label}</span>
    </span>
  )
}
