import { useState } from 'react'
import { selectHasApiKey, useLectern } from '../state/store'
import { MODEL_CHOICES, PROVIDERS, providerOf } from '../engine/config'
import { count } from '../engine/plural'
import type { CardDensity } from '../engine/types'
import { MAX_FOCUS_PROMPT_LEN } from '../engine/prompts'
import { SetupChecklist } from './SetupChecklist'

/** Deck depth. The size itself comes from the concept map's card budgets,
 *  so the student picks how deep, not how many. */
const DENSITIES: Array<{ id: CardDensity; label: string; note: string }> = [
  { id: 'overview', label: 'Overview', note: 'The essentials' },
  { id: 'standard', label: 'Standard', note: 'Every facet' },
  { id: 'thorough', label: 'Thorough', note: 'Plus why and how' },
]

const formatTokens = (tokens: number): string =>
  tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : `${Math.max(1, Math.round(tokens / 1000))}k`

export function HomeView() {
  const fileName = useLectern((s) => s.fileName)
  const pdfInfo = useLectern((s) => s.pdfInfo)
  const pageThumbs = useLectern((s) => s.pageThumbs)
  const pickPdf = useLectern((s) => s.pickPdf)
  const deckName = useLectern((s) => s.deckName)
  const setDeckName = useLectern((s) => s.setDeckName)
  const ankiDecks = useLectern((s) => s.ankiDecks)
  const focusPrompt = useLectern((s) => s.focusPrompt)
  const setFocusPrompt = useLectern((s) => s.setFocusPrompt)
  const expectedCards = useLectern((s) => s.expectedCards)
  const setCardDensity = useLectern((s) => s.setCardDensity)
  const estimate = useLectern((s) => s.estimate)
  const settings = useLectern((s) => s.settings)
  const hasApiKey = useLectern(selectHasApiKey)
  const openSettings = useLectern((s) => s.openSettings)
  const startGeneration = useLectern((s) => s.startGeneration)
  const existingDeckCount = useLectern((s) => s.existingDeckCount)
  const extendDeck = useLectern((s) => s.extendDeck)
  const setExtendDeck = useLectern((s) => s.setExtendDeck)
  const ankiStatus = useLectern((s) => s.ankiStatus)
  // Open from the start when a focus is already typed (Replace keeps it).
  const [focusOpen, setFocusOpen] = useState(() => focusPrompt !== '')

  const missingDeck = !deckName.trim()
  const cannotGenerate = !hasApiKey || missingDeck
  const hasExistingCards = (existingDeckCount ?? 0) > 0
  const extending = hasExistingCards && extendDeck
  // Three states that used to look identical — an empty space under the
  // field — while only one of them means "a new deck appears in Anki".
  const deckState: 'unknown' | 'offline' | 'new' | 'empty' =
    ankiStatus !== 'connected'
      ? 'offline'
      : missingDeck || existingDeckCount === null
        ? 'unknown'
        : ankiDecks.includes(deckName)
          ? 'empty'
          : 'new'

  const density = settings?.cardDensity ?? 'standard'

  return (
    <main className="flex flex-1 items-start justify-center overflow-y-auto px-8 py-12">
      <div className="w-full max-w-xl">
        {!fileName ? (
          <div className="pt-12">
            <button
              onClick={() => void pickPdf()}
              className="group relative mx-auto block w-full max-w-sm focus-visible:outline-none"
              aria-label="Choose a lecture PDF"
            >
              {/* A blank index card waiting on the desk, two more beneath it */}
              <div className="bg-paper/20 absolute inset-0 translate-y-2 rotate-[-1.6deg] rounded-lg transition-transform duration-200 ease-out group-hover:rotate-[-2.4deg]" />
              <div className="bg-paper/45 absolute inset-0 translate-y-1 rotate-[1.1deg] rounded-lg transition-transform duration-200 ease-out group-hover:rotate-[1.8deg]" />
              <div className="bg-paper shadow-hero group-focus-visible:ring-lamp relative flex aspect-[3/2] flex-col items-center justify-center rounded-lg transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-active:translate-y-0 group-focus-visible:ring-2">
                <p className="font-card text-ink text-xl font-medium">Drop a lecture PDF</p>
                <p className="text-ink-soft mt-1.5 text-sm">or click to browse</p>
              </div>
            </button>
            <p className="eyebrow mt-10 text-center">PDF → concept map → flashcards → Anki</p>

            <SetupChecklist />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Source document */}
            <section className="bg-desk-raised/70 flex items-center gap-4 rounded-md p-3">
              <div className="bg-paper/15 h-16 w-[85px] shrink-0 overflow-hidden rounded-sm">
                {pageThumbs[1] && (
                  <img src={pageThumbs[1]} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-chalk truncate text-base font-medium">{fileName}</p>
                {pdfInfo && (
                  <p className="font-data text-chalk-dim mt-0.5 text-xs">
                    {count(pdfInfo.pageCount, 'page')}
                  </p>
                )}
              </div>
              {/* "Replace" opens the picker straight away — clearing back to
                  an empty desk first made it a two-step, and cancelling the
                  dialog would have thrown the loaded lecture away. */}
              <button
                onClick={() => void pickPdf()}
                className="btn-ghost px-2.5 py-1.5"
                title="Choose a different lecture PDF"
              >
                Replace
              </button>
            </section>

            {/* Deck */}
            <div>
              <label className="block">
                <span className="eyebrow">Anki deck</span>
                <input
                  value={deckName}
                  onChange={(e) => setDeckName(e.target.value)}
                  list="anki-decks"
                  placeholder="e.g. Machine Learning::Lecture 2"
                  className="field mt-1.5"
                />
              </label>
              <datalist id="anki-decks">
                {ankiDecks.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
              {/* What this name means in Anki right now. A typo silently
                  created a second, near-identical deck at send time. */}
              {!hasExistingCards && deckState !== 'unknown' && (
                <p className="text-chalk-dim mt-1.5 text-2xs">
                  {deckState === 'new' ? (
                    <>
                      New deck: Lectern creates “<span className="font-data">{deckName}</span>” when
                      you send.
                    </>
                  ) : deckState === 'empty' ? (
                    'This deck exists and holds no cards yet.'
                  ) : (
                    'Anki is not reachable, so Lectern cannot tell whether this deck already exists.'
                  )}
                </p>
              )}
              {hasExistingCards && (
                <div className="border-desk-edge/60 bg-desk-raised/50 rise-in mt-2 rounded-md border px-2.5 py-2">
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={extendDeck}
                      onChange={(e) => setExtendDeck(e.target.checked)}
                      className="accent-lamp mt-0.5 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="text-chalk block text-xs">
                        Don&apos;t repeat what this deck already covers
                      </span>
                      <span className="text-chalk-dim block text-2xs">
                        <span className="font-data">{existingDeckCount}</span> cards are already
                        here. Lectern reads them first, so this run goes after what is missing.
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </div>

            {/* Deck depth. The number follows from the lecture: it is
                settled once the concept map has been read, so before the
                run it is only ever "about". */}
            <fieldset>
              <legend className="eyebrow">{extending ? 'Depth to add' : 'Deck depth'}</legend>
              <div className="border-desk-edge/70 bg-desk-raised mt-1.5 grid grid-cols-3 gap-1 rounded-md border p-1">
                {DENSITIES.map((option) => (
                  <label
                    key={option.id}
                    className={`has-focus-visible:ring-lamp cursor-pointer rounded-sm px-2 py-1.5 text-center transition-colors duration-150 has-focus-visible:ring-1 ${
                      density === option.id
                        ? 'bg-desk text-chalk'
                        : 'text-chalk-dim hover:text-chalk'
                    }`}
                  >
                    <input
                      type="radio"
                      name="card-density"
                      value={option.id}
                      checked={density === option.id}
                      onChange={() => setCardDensity(option.id)}
                      className="sr-only"
                    />
                    <span className="block text-sm">{option.label}</span>
                    <span className="block text-2xs opacity-80">{option.note}</span>
                  </label>
                ))}
              </div>
              <p className="text-chalk-dim mt-1.5 text-xs">
                {extending
                  ? 'Adds what the deck still lacks at this depth, concept by concept.'
                  : expectedCards
                    ? `Around ${expectedCards.min} to ${expectedCards.max} cards. The exact number is set once the lecture has been read.`
                    : 'The number of cards is set once the lecture has been read.'}
              </p>
            </fieldset>

            {/* Focus: optional, so it waits behind a link until wanted. */}
            {!focusOpen ? (
              <button
                onClick={() => setFocusOpen(true)}
                className="text-chalk-dim hover:text-chalk rounded-sm text-xs underline-offset-2 transition-colors duration-150 hover:underline"
              >
                + Add a focus, e.g. only what’s on the exam
              </button>
            ) : (
              <label className="block">
                <span className="flex items-baseline justify-between">
                  <span className="eyebrow">Focus · optional</span>
                  {/* The counter stays out of the way until the field fills up. */}
                  {focusPrompt.length > MAX_FOCUS_PROMPT_LEN * 0.6 && (
                    <span
                      className={`font-data text-xs ${
                        focusPrompt.length >= MAX_FOCUS_PROMPT_LEN ? 'text-lamp' : 'text-chalk-dim'
                      }`}
                    >
                      {focusPrompt.length} / {MAX_FOCUS_PROMPT_LEN}
                    </span>
                  )}
                </span>
                <textarea
                  value={focusPrompt}
                  onChange={(e) => setFocusPrompt(e.target.value)}
                  rows={3}
                  autoFocus={focusPrompt === ''}
                  maxLength={MAX_FOCUS_PROMPT_LEN}
                  placeholder={'e.g. "definitions and formulas for the exam, not the case studies"'}
                  className="field mt-1.5 resize-y"
                />
              </label>
            )}

            {/* Generate */}
            <div className="flex items-center justify-between pt-2">
              {/* Tokens sit next to the price because the limit people hit
                  first is a token quota, not a bill. */}
              <p
                className="font-data text-chalk-dim text-xs"
                title={
                  estimate
                    ? `Rough estimate: ~${estimate.inputTokens.toLocaleString()} input + ` +
                      `~${estimate.outputTokens.toLocaleString()} output tokens. ` +
                      'Compare against your key’s quota if you are on the free tier.'
                    : undefined
                }
              >
                {settings?.model &&
                  (MODEL_CHOICES.find((m) => m.id === settings.model)?.label ?? settings.model)}
                {estimate &&
                  ` · ~${formatTokens(estimate.inputTokens + estimate.outputTokens)} tokens · ~$${estimate.costUsd.toFixed(2)}`}
              </p>
              <button
                onClick={() => void startGeneration()}
                disabled={cannotGenerate}
                className="btn-primary px-5 py-2.5"
              >
                {extending ? 'Extend deck' : 'Generate deck'}
              </button>
            </div>
            {!hasApiKey ? (
              <p className="-mt-3 text-right text-xs">
                <button
                  onClick={() => openSettings(true)}
                  className="text-chalk-dim hover:text-chalk rounded-sm underline underline-offset-2 transition-colors duration-150"
                >
                  Add your {PROVIDERS[providerOf(settings?.model ?? '')].label} API key in Settings
                </button>{' '}
                <span className="text-chalk-dim">to generate.</span>
              </p>
            ) : (
              missingDeck && (
                <p className="text-chalk-dim -mt-3 text-right text-xs">
                  Name the target deck to generate.
                </p>
              )
            )}
          </div>
        )}
      </div>
    </main>
  )
}
