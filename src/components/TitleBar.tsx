import { useLectern } from '../state/store'

export function TitleBar() {
  const ankiStatus = useLectern((s) => s.ankiStatus)
  const hasApiKey = useLectern((s) => s.hasApiKey)
  const openSettings = useLectern((s) => s.openSettings)
  const view = useLectern((s) => s.view)
  const fileName = useLectern((s) => s.fileName)
  const deckName = useLectern((s) => s.deckName)

  return (
    <header
      data-tauri-drag-region
      className="border-desk-edge/60 flex h-11 shrink-0 items-center gap-3 border-b pr-3 pl-[84px]"
    >
      <span data-tauri-drag-region className="eyebrow text-chalk shrink-0 select-none">
        Lectern
      </span>

      {/* In a session the window is the only place that answers "which lecture,
          which deck?" — the sidebar and the send bar each hold half of it. */}
      {view === 'session' && fileName && (
        <p
          data-tauri-drag-region
          className="text-chalk-dim min-w-0 flex-1 truncate text-xs select-none"
          title={`${fileName} → ${deckName}`}
        >
          {fileName}
          {deckName && (
            <>
              <span aria-hidden className="mx-1.5">
                →
              </span>
              <span className="text-chalk">{deckName}</span>
            </>
          )}
        </p>
      )}
      {!(view === 'session' && fileName) && <div data-tauri-drag-region className="flex-1" />}

      {/* Both connections are prerequisites, so a broken one says what is
          broken in words and takes you to where it is fixed. */}
      <Status
        label="Anki"
        problem={
          ankiStatus === 'connected' ? null : ankiStatus === 'checking' ? 'checking…' : 'offline'
        }
        tone={ankiStatus === 'connected' ? 'ok' : ankiStatus === 'checking' ? 'wait' : 'bad'}
        title={
          ankiStatus === 'connected'
            ? 'Anki is connected — open Settings'
            : ankiStatus === 'checking'
              ? 'Checking Anki…'
              : "Anki isn't reachable — open Anki with the AnkiConnect add-on, or change the URL in Settings"
        }
        onClick={() => openSettings(true)}
      />
      <Status
        label="Gemini"
        problem={hasApiKey ? null : 'no key'}
        tone={hasApiKey ? 'ok' : 'bad'}
        title={hasApiKey ? 'API key saved — open Settings' : 'No API key yet — add one in Settings'}
        onClick={() => openSettings(true)}
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
  problem,
  tone,
  title,
  onClick,
}: {
  label: string
  /** Short state word shown next to the label while something is off. */
  problem: string | null
  tone: 'ok' | 'bad' | 'wait'
  title: string
  onClick: () => void
}) {
  const dot =
    tone === 'ok' ? 'bg-sage' : tone === 'wait' ? 'bg-chalk-dim animate-pulse' : 'bg-brick-soft'
  return (
    <button
      onClick={onClick}
      className="hover:bg-desk-raised/70 -mx-1 flex shrink-0 items-center gap-1.5 rounded-sm px-1 py-0.5 transition-colors duration-150"
      title={title}
      aria-label={title}
    >
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="eyebrow">{label}</span>
      {/* Lowercase on purpose: the label is the register, the state is the
          reading — an uppercased "OFFLINE" shouts where a word will do. */}
      {problem && (
        <span
          className={`font-data text-2xs ${tone === 'bad' ? 'text-brick-soft' : 'text-chalk-dim'}`}
        >
          · {problem}
        </span>
      )}
    </button>
  )
}
