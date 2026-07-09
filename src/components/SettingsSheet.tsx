import { useEffect, useRef, useState } from 'react'
import { MODEL_CHOICES } from '../engine/config'
import { NOTE_TYPE_THEMES, type NoteTypeTheme } from '../engine/noteTypes'
import type { Settings } from '../engine/types'
import { deleteApiKey, setApiKey } from '../lib/settings'
import { useLectern } from '../state/store'

export function SettingsSheet() {
  const open = useLectern((s) => s.settingsOpen)
  const openSettings = useLectern((s) => s.openSettings)
  const settings = useLectern((s) => s.settings)
  const hasApiKey = useLectern((s) => s.hasApiKey)
  const setHasApiKey = useLectern((s) => s.setHasApiKey)
  const applySettings = useLectern((s) => s.applySettings)
  const ankiStatus = useLectern((s) => s.ankiStatus)
  const refreshAnki = useLectern((s) => s.refreshAnki)
  const toast = useLectern((s) => s.toast)
  const migrateLegacyCards = useLectern((s) => s.migrateLegacyCards)
  const migratingCards = useLectern((s) => s.migratingCards)

  const [draft, setDraft] = useState<Settings | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)

  // Reset the drafts from the saved settings each time the sheet opens (or
  // the settings object changes underneath an open sheet) — done during
  // render via the previous-render comparison pattern, not an effect.
  const [syncedFrom, setSyncedFrom] = useState<Settings | null>(null)
  if (!open && syncedFrom !== null) setSyncedFrom(null)
  if (open && settings && syncedFrom !== settings) {
    setSyncedFrom(settings)
    setDraft({ ...settings })
    setKeyDraft('')
  }

  // Esc closes; focus returns to the button that opened the sheet.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        openSettings(false)
      } else if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const focusables = sheetRef.current?.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (!focusables || focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.getElementById('settings-trigger')?.focus()
    }
  }, [open, openSettings])

  if (!open || !draft) return null

  const save = async () => {
    if (keyDraft.trim()) {
      try {
        await setApiKey(keyDraft.trim())
        setHasApiKey(true)
      } catch (e) {
        toast('error', `Could not save the API key: ${(e as Error).message}`)
        return
      }
    }
    await applySettings(draft)
    openSettings(false)
    toast('success', 'Settings saved.')
  }

  return (
    <div
      className="bg-desk/70 fade-in absolute inset-0 z-40 flex items-center justify-center backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && openSettings(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div
        ref={sheetRef}
        className="bg-desk-raised shadow-sheet sheet-in max-h-[85%] w-[460px] overflow-y-auto rounded-lg p-6"
      >
        <h2 id="settings-title" className="text-chalk text-md font-semibold">
          Settings
        </h2>

        <div className="mt-5 space-y-5">
          <label className="block">
            <span className="eyebrow">Gemini API key</span>
            <input
              autoFocus
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder={
                hasApiKey
                  ? 'Saved in the system keychain — paste to replace'
                  : 'Paste your key from aistudio.google.com'
              }
              className="field bg-desk mt-1.5"
            />
            {hasApiKey && (
              <button
                onClick={() => {
                  void deleteApiKey().then(() => {
                    setHasApiKey(false)
                    toast('info', 'API key removed from the keychain.')
                  })
                }}
                className="text-chalk-dim hover:text-brick-soft mt-1 rounded-sm text-xs underline-offset-2 transition-colors duration-150 hover:underline"
              >
                Remove saved key
              </button>
            )}
          </label>

          <label className="block">
            <span className="eyebrow">Model</span>
            <select
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              className="field bg-desk mt-1.5 cursor-pointer"
            >
              {MODEL_CHOICES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="eyebrow">AnkiConnect URL</span>
            <div className="flex items-center gap-2">
              <input
                value={draft.ankiUrl}
                onChange={(e) => setDraft({ ...draft, ankiUrl: e.target.value })}
                className="field bg-desk mt-1.5"
              />
              <button
                onClick={() => void refreshAnki()}
                disabled={ankiStatus === 'checking'}
                className="btn-secondary mt-1.5 shrink-0 px-3 py-2"
              >
                {ankiStatus === 'checking'
                  ? 'Checking…'
                  : ankiStatus === 'connected'
                    ? 'Connected'
                    : 'Ping'}
              </button>
            </div>
            {ankiStatus === 'offline' && (
              <p className="text-chalk-dim mt-1 text-xs">
                Open Anki and install the AnkiConnect add-on (code 2055492159).
              </p>
            )}
          </label>

          <div className="block">
            <span className="eyebrow">Card design</span>
            <label className="mt-1.5 flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.useLecternNoteTypes}
                onChange={(e) => setDraft({ ...draft, useLecternNoteTypes: e.target.checked })}
                className="accent-lamp"
              />
              <span className="text-chalk text-sm">Style synced cards with Lectern note types</span>
            </label>
            {draft.useLecternNoteTypes ? (
              <div className="mt-3 space-y-3">
                <select
                  value={draft.noteTypeTheme}
                  onChange={(e) =>
                    setDraft({ ...draft, noteTypeTheme: e.target.value as NoteTypeTheme })
                  }
                  className="field bg-desk cursor-pointer"
                  aria-label="Card design theme"
                >
                  {NOTE_TYPE_THEMES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <div>
                  <button
                    onClick={() => void migrateLegacyCards()}
                    disabled={migratingCards || ankiStatus !== 'connected'}
                    className="btn-secondary px-3 py-1.5 text-sm"
                  >
                    {migratingCards ? 'Restyling…' : 'Apply design to earlier synced cards'}
                  </button>
                  <p className="text-chalk-dim mt-1 text-xs">
                    Moves cards tagged “{draft.defaultTag}” from plain Basic/Cloze onto the Lectern
                    note types. Review progress is kept.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-chalk-dim mt-1 text-xs">
                Cards go to the note types named under Advanced.
              </p>
            )}
          </div>

          <button
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="eyebrow hover:text-chalk flex items-center gap-1 rounded-sm transition-colors duration-150"
            aria-expanded={advancedOpen}
          >
            Advanced
            <span
              aria-hidden
              className={`inline-block transition-transform duration-150 ease-out ${advancedOpen ? 'rotate-90' : ''}`}
            >
              ▸
            </span>
          </button>

          {advancedOpen && (
            <div className="rise-in space-y-4">
              {draft.useLecternNoteTypes && (
                <p className="text-chalk-dim text-xs">
                  The note type names below are used only while the Lectern card design is off.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="eyebrow">Basic note type</span>
                  <input
                    value={draft.basicModelName}
                    onChange={(e) => setDraft({ ...draft, basicModelName: e.target.value })}
                    className="field bg-desk mt-1.5"
                  />
                </label>
                <label className="block">
                  <span className="eyebrow">Cloze note type</span>
                  <input
                    value={draft.clozeModelName}
                    onChange={(e) => setDraft({ ...draft, clozeModelName: e.target.value })}
                    className="field bg-desk mt-1.5"
                  />
                </label>
              </div>
              <label className="block">
                <span className="eyebrow">Tag template</span>
                <input
                  value={draft.tagTemplate}
                  onChange={(e) => setDraft({ ...draft, tagTemplate: e.target.value })}
                  className="field bg-desk font-data mt-1.5 text-sm"
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.enableDefaultTag}
                  onChange={(e) => setDraft({ ...draft, enableDefaultTag: e.target.checked })}
                  className="accent-lamp"
                />
                <span className="text-chalk text-sm">
                  Also tag every card with “{draft.defaultTag}”
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={() => openSettings(false)} className="btn-ghost px-4 py-2">
            Cancel
          </button>
          <button onClick={() => void save()} className="btn-primary px-4 py-2 text-sm">
            Save settings
          </button>
        </div>
      </div>
    </div>
  )
}
