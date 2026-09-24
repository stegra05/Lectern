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

      {/* Both connections are prerequisites, but a healthy one needs no
          chrome: a status only appears when something is wrong, says what in
          words, and takes you to where it is fixed. */}
      {ankiStatus === 'offline' && (
        <Problem
          label="Anki"
          problem="offline"
          title="Anki isn't reachable. Open Anki with the AnkiConnect add-on, or change the URL in Settings"
          onClick={() => openSettings(true)}
        />
      )}
      {!hasApiKey && (
        <Problem
          label="Gemini"
          problem="no key"
          title="No API key yet. Add one in Settings"
          onClick={() => openSettings(true)}
        />
      )}

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

function Problem({
  label,
  problem,
  title,
  onClick,
}: {
  label: string
  /** Short state word, lowercase: the label is the register, the state is
   *  the reading, and an uppercased "OFFLINE" shouts where a word will do. */
  problem: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="hover:bg-desk-raised/70 -mx-1 flex shrink-0 items-center gap-1.5 rounded-sm px-1 py-0.5 transition-colors duration-150"
      title={title}
      aria-label={title}
    >
      <span aria-hidden className="bg-brick-soft size-1.5 shrink-0 rounded-full" />
      <span className="eyebrow">{label}</span>
      <span className="font-data text-brick-soft text-2xs">· {problem}</span>
    </button>
  )
}
