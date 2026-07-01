import { useEffect, useState } from 'react'
import { MODEL_CHOICES } from '../engine/config'
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

  const [draft, setDraft] = useState<Settings | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    if (open && settings) {
      setDraft({ ...settings })
      setKeyDraft('')
    }
  }, [open, settings])

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

  const field =
    'mt-1.5 w-full rounded-md bg-desk px-3 py-2 text-[14px] text-chalk placeholder:text-chalk-dim/60'

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-desk/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && openSettings(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div className="max-h-[85%] w-[460px] overflow-y-auto rounded-lg bg-desk-raised p-6 shadow-2xl">
        <h2 className="text-[15px] font-semibold text-chalk">Settings</h2>

        <div className="mt-5 space-y-5">
          <label className="block">
            <span className="eyebrow">Gemini API key</span>
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder={hasApiKey ? 'Saved in the system keychain — paste to replace' : 'Paste your key from aistudio.google.com'}
              className={field}
            />
            {hasApiKey && (
              <button
                onClick={() => {
                  void deleteApiKey().then(() => {
                    setHasApiKey(false)
                    toast('info', 'API key removed from the keychain.')
                  })
                }}
                className="mt-1 text-[12px] text-chalk-dim underline-offset-2 hover:text-brick hover:underline"
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
              className={field}
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
                className={field}
              />
              <button
                onClick={() => void refreshAnki()}
                className="mt-1.5 shrink-0 rounded-md border border-desk-edge px-3 py-2 text-[13px] text-chalk hover:border-chalk-dim"
              >
                {ankiStatus === 'checking' ? '…' : ankiStatus === 'connected' ? 'Connected' : 'Ping'}
              </button>
            </div>
            {ankiStatus === 'offline' && (
              <p className="mt-1 text-[12px] text-chalk-dim">
                Open Anki and install the AnkiConnect add-on (code 2055492159).
              </p>
            )}
          </label>

          <button
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="eyebrow hover:text-chalk"
            aria-expanded={advancedOpen}
          >
            Advanced {advancedOpen ? '▾' : '▸'}
          </button>

          {advancedOpen && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="eyebrow">Basic note type</span>
                  <input
                    value={draft.basicModelName}
                    onChange={(e) => setDraft({ ...draft, basicModelName: e.target.value })}
                    className={field}
                  />
                </label>
                <label className="block">
                  <span className="eyebrow">Cloze note type</span>
                  <input
                    value={draft.clozeModelName}
                    onChange={(e) => setDraft({ ...draft, clozeModelName: e.target.value })}
                    className={field}
                  />
                </label>
              </div>
              <label className="block">
                <span className="eyebrow">Tag template</span>
                <input
                  value={draft.tagTemplate}
                  onChange={(e) => setDraft({ ...draft, tagTemplate: e.target.value })}
                  className={`${field} font-data text-[13px]`}
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.enableDefaultTag}
                  onChange={(e) => setDraft({ ...draft, enableDefaultTag: e.target.checked })}
                  className="accent-lamp"
                />
                <span className="text-[13px] text-chalk">
                  Also tag every card with “{draft.defaultTag}”
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={() => openSettings(false)}
            className="rounded-md px-4 py-2 text-[13px] text-chalk-dim hover:text-chalk"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            className="rounded-md bg-lamp px-4 py-2 text-[13px] font-semibold text-ink hover:bg-lamp-deep"
          >
            Save settings
          </button>
        </div>
      </div>
    </div>
  )
}
