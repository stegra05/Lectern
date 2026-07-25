import { useCallback, useEffect, useRef, useState } from 'react'
import { MODEL_CHOICES } from '../engine/config'
import { NOTE_TYPE_THEMES, type NoteTypeTheme } from '../engine/noteTypes'
import { buildCardTags, unknownTagPlaceholders } from '../engine/tags'
import type { Settings } from '../engine/types'
import { confirmDiscard } from '../lib/confirm'
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
  const deckName = useLectern((s) => s.deckName)
  const slideSetName = useLectern((s) => s.conceptMap?.slideSetName ?? '')

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

  // Settings only take effect on Save, so every way out of the sheet has to
  // ask before throwing typed changes away — an API key pasted and then
  // dismissed with Esc used to vanish without a word.
  const dirty =
    draft !== null &&
    settings !== null &&
    (keyDraft.trim().length > 0 ||
      (Object.keys(draft) as Array<keyof Settings>).some((k) => draft[k] !== settings[k]))
  // A test ping against an unsaved URL leaves the status dot describing a
  // server the app is not actually configured for — put it back on the way out.
  const urlChanged = draft !== null && settings !== null && draft.ankiUrl !== settings.ankiUrl

  const requestClose = useCallback(() => {
    const finish = () => {
      if (urlChanged) void useLectern.getState().refreshAnki()
      openSettings(false)
    }
    if (!dirty) return finish()
    void confirmDiscard('Your changes to Settings will be lost.', 'Discard changes?').then((ok) => {
      if (ok) finish()
    })
  }, [openSettings, dirty, urlChanged])

  // Focus returns to the button that opened the sheet. Its own effect, so that
  // rebinding the key handler below never yanks focus out of a field mid-edit.
  useEffect(() => {
    if (!open) return
    return () => document.getElementById('settings-trigger')?.focus()
  }, [open])

  // Esc closes, Tab stays inside the dialog.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        requestClose()
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
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, requestClose])

  if (!open || !draft) return null

  const unknownPlaceholders = unknownTagPlaceholders(draft.tagTemplate)
  const tagPreview = buildCardTags({
    template: draft.tagTemplate,
    deck: deckName || 'Machine Learning::Lecture 2',
    slideSet: slideSetName || 'Neural Networks',
    topic: 'Backpropagation',
    defaultTag: draft.defaultTag,
    enableDefaultTag: draft.enableDefaultTag,
  }).join('  ')

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
      onClick={(e) => e.target === e.currentTarget && requestClose()}
    >
      {/* Header and footer are pinned and only the settings scroll: on a short
          window the Save button used to sit below the fold, with nothing to
          suggest the sheet scrolled at all. */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="bg-desk-raised shadow-sheet sheet-in flex max-h-[85%] w-[460px] flex-col overflow-hidden rounded-lg"
      >
        <h2
          id="settings-title"
          className="text-chalk shrink-0 px-6 pt-6 pb-1 text-md font-semibold"
        >
          Settings
        </h2>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
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
              // Deleting the key means fetching a new one from Google to
              // generate again, so it asks first.
              <button
                onClick={() => {
                  void confirmDiscard(
                    'Lectern cannot generate cards until you paste a key again.',
                    'Remove the saved API key?',
                  ).then((ok) => {
                    if (!ok) return
                    void deleteApiKey().then(() => {
                      setHasApiKey(false)
                      toast('info', 'API key removed from the keychain.')
                    })
                  })
                }}
                className="text-chalk-dim hover:text-brick-soft mt-1.5 rounded-sm text-xs underline underline-offset-2 transition-colors duration-150"
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
              {/* Tests the URL in the field, not the saved one — pressing this
                  after editing the address used to check the old server. The
                  button stays a verb and the outcome is reported below it. */}
              <button
                onClick={() => void refreshAnki(draft.ankiUrl)}
                disabled={ankiStatus === 'checking'}
                className="btn-secondary mt-1.5 shrink-0 px-3 py-2"
              >
                {ankiStatus === 'checking' ? 'Testing…' : 'Test'}
              </button>
            </div>
            <p className="text-chalk-dim mt-1.5 flex items-baseline gap-1.5 text-xs">
              <span
                aria-hidden
                className={`size-1.5 shrink-0 translate-y-[-1px] rounded-full ${
                  ankiStatus === 'connected'
                    ? 'bg-sage'
                    : ankiStatus === 'checking'
                      ? 'bg-chalk-dim animate-pulse'
                      : 'bg-brick-soft'
                }`}
              />
              <span>
                {ankiStatus === 'connected'
                  ? 'Anki answered — cards can be sent.'
                  : ankiStatus === 'checking'
                    ? 'Checking…'
                    : 'No answer. Open Anki and install the AnkiConnect add-on (code 2055492159).'}
              </span>
            </p>
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
                    disabled={migratingCards || ankiStatus !== 'connected' || dirty}
                    className="btn-secondary px-3 py-1.5 text-sm"
                  >
                    {migratingCards ? 'Restyling…' : 'Apply design to earlier synced cards'}
                  </button>
                  <p className="text-chalk-dim mt-1 text-xs">
                    Moves cards tagged “{settings?.defaultTag ?? draft.defaultTag}” from plain
                    Basic/Cloze onto the Lectern note types. Review progress is kept; a note with
                    fields Lectern does not use keeps them on its back.
                    {dirty && ' Save your settings first — this acts on the saved ones.'}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-chalk-dim mt-1 text-xs">
                Cards go to the note types named under Advanced.
              </p>
            )}
          </div>

          <div className="block">
            <span className="eyebrow">While you wait</span>
            <label className="mt-1.5 flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.notifyOnFinish}
                onChange={(e) => setDraft({ ...draft, notifyOnFinish: e.target.checked })}
                className="accent-lamp"
              />
              <span className="text-chalk text-sm">Notify me when a deck finishes</span>
            </label>
            <p className="text-chalk-dim mt-1 text-xs">
              Only when Lectern is in the background — no notification if you are watching it work.
            </p>
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
                {/* The three placeholders were undiscoverable without reading
                    the source, and the result was invisible until the cards
                    were in Anki. */}
                <p className="text-chalk-dim mt-1.5 text-2xs">
                  Placeholders: <span className="font-data">{'{{deck}}'}</span>{' '}
                  <span className="font-data">{'{{slide_set}}'}</span>{' '}
                  <span className="font-data">{'{{topic}}'}</span>
                </p>
                {unknownPlaceholders.length > 0 && (
                  <p className="text-lamp mt-1 text-2xs">
                    {unknownPlaceholders.map((name) => `{{${name}}}`).join(', ')} is not a
                    placeholder — it goes into the tag as written.
                  </p>
                )}
                <p className="text-chalk-dim mt-1 text-2xs">
                  A card would be tagged{' '}
                  <span className="font-data text-chalk">{tagPreview || '(no tag)'}</span>
                </p>
              </label>
              <label className="block">
                <span className="eyebrow">Tag on every card</span>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.enableDefaultTag}
                    onChange={(e) => setDraft({ ...draft, enableDefaultTag: e.target.checked })}
                    className="accent-lamp shrink-0"
                    aria-label="Add a flat tag to every card"
                  />
                  <input
                    value={draft.defaultTag}
                    onChange={(e) => setDraft({ ...draft, defaultTag: e.target.value })}
                    disabled={!draft.enableDefaultTag}
                    className="field bg-desk font-data text-sm disabled:opacity-45"
                    aria-label="The flat tag added to every card"
                  />
                </div>
                <p className="text-chalk-dim mt-1 text-2xs">
                  How Lectern finds its own cards later — the restyle button above searches for it.
                </p>
              </label>
            </div>
          )}
        </div>

        <div className="border-desk-edge/60 flex shrink-0 items-center justify-end gap-2 border-t px-6 py-4">
          {dirty && <span className="text-chalk-dim mr-auto text-xs">Unsaved changes</span>}
          <button onClick={requestClose} className="btn-ghost px-4 py-2">
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
