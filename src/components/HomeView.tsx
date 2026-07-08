import { useMemo } from 'react'
import { useLectern } from '../state/store'
import { MODEL_CHOICES } from '../engine/config'
import { computeSizingPlan } from '../engine/pacing'

/**
 * The deck-size slider is exponential: card-by-card precision for small decks,
 * coarser strides the higher it goes, up to genuinely large decks. The track
 * position t ∈ [0, 1] maps to MIN·(max/MIN)^t, snapped to friendly steps.
 */
const SLIDER_MIN = 5
const SLIDER_RESOLUTION = 500

function snapCards(raw: number): number {
  const step = raw < 30 ? 1 : raw < 100 ? 5 : 25
  return Math.round(raw / step) * step
}

function cardsFromTrack(t: number, max: number): number {
  const raw = SLIDER_MIN * Math.pow(max / SLIDER_MIN, t)
  return Math.min(max, Math.max(SLIDER_MIN, snapCards(raw)))
}

function trackFromCards(cards: number, max: number): number {
  const clamped = Math.min(max, Math.max(SLIDER_MIN, cards))
  return Math.log(clamped / SLIDER_MIN) / Math.log(max / SLIDER_MIN)
}

export function HomeView() {
  const fileName = useLectern((s) => s.fileName)
  const pdfInfo = useLectern((s) => s.pdfInfo)
  const pageThumbs = useLectern((s) => s.pageThumbs)
  const pickPdf = useLectern((s) => s.pickPdf)
  const clearPdf = useLectern((s) => s.clearPdf)
  const deckName = useLectern((s) => s.deckName)
  const setDeckName = useLectern((s) => s.setDeckName)
  const ankiDecks = useLectern((s) => s.ankiDecks)
  const focusPrompt = useLectern((s) => s.focusPrompt)
  const setFocusPrompt = useLectern((s) => s.setFocusPrompt)
  const targetCards = useLectern((s) => s.targetCards)
  const setTargetCards = useLectern((s) => s.setTargetCards)
  const estimate = useLectern((s) => s.estimate)
  const settings = useLectern((s) => s.settings)
  const hasApiKey = useLectern((s) => s.hasApiKey)
  const openSettings = useLectern((s) => s.openSettings)
  const startGeneration = useLectern((s) => s.startGeneration)

  const missingDeck = !deckName.trim()
  const cannotGenerate = !hasApiKey || missingDeck

  // The slider scale anchors on what the document itself suggests — never on
  // the user override (which feeds store.sizing), or the scale would stretch
  // while dragging.
  const autoCap = useMemo(() => (pdfInfo ? computeSizingPlan(pdfInfo).totalCardCap : 40), [pdfInfo])
  const sliderMax = Math.min(1000, Math.max(200, autoCap * 5))

  return (
    <main className="flex flex-1 items-start justify-center overflow-y-auto px-8 py-12">
      <div className="w-full max-w-xl">
        {!fileName ? (
          <div className="pt-16">
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
                    {pdfInfo.pageCount} pages · {Math.round(pdfInfo.textChars / 1000)}k chars
                  </p>
                )}
              </div>
              <button onClick={clearPdf} className="btn-ghost px-2.5 py-1.5">
                Replace
              </button>
            </section>

            {/* Deck */}
            <label className="block">
              <span className="eyebrow">Anki deck</span>
              <input
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
                list="anki-decks"
                placeholder="e.g. Machine Learning::Lecture 2"
                className="field mt-1.5"
              />
              <datalist id="anki-decks">
                {ankiDecks.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </label>

            {/* Deck size */}
            <div>
              <div className="flex items-baseline justify-between">
                <span className="eyebrow">Deck size</span>
                <span className="font-data text-chalk-dim text-xs">
                  {targetCards ?? `auto · ~${autoCap}`} cards
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={SLIDER_RESOLUTION}
                value={Math.round(
                  trackFromCards(targetCards ?? autoCap, sliderMax) * SLIDER_RESOLUTION,
                )}
                onChange={(e) =>
                  setTargetCards(
                    cardsFromTrack(Number(e.target.value) / SLIDER_RESOLUTION, sliderMax),
                  )
                }
                className="mt-2"
                aria-label="Target number of cards"
                aria-valuetext={`${targetCards ?? autoCap} cards`}
              />
              {targetCards !== null && (
                <button
                  onClick={() => setTargetCards(null)}
                  className="text-chalk-dim hover:text-chalk mt-1 rounded-sm text-xs underline-offset-2 transition-colors duration-150 hover:underline"
                >
                  Size from the document instead
                </button>
              )}
            </div>

            {/* Focus */}
            <label className="block">
              <span className="eyebrow">Focus · optional</span>
              <textarea
                value={focusPrompt}
                onChange={(e) => setFocusPrompt(e.target.value)}
                rows={2}
                maxLength={180}
                placeholder={'e.g. "definitions and formulas for the exam"'}
                className="field mt-1.5 resize-none"
              />
            </label>

            {/* Generate */}
            <div className="flex items-center justify-between pt-2">
              <p className="font-data text-chalk-dim text-xs">
                {settings?.model &&
                  (MODEL_CHOICES.find((m) => m.id === settings.model)?.label.split(' — ')[0] ??
                    settings.model)}
                {estimate && ` · ~$${estimate.costUsd.toFixed(2)}`}
              </p>
              <button
                onClick={() => void startGeneration()}
                disabled={cannotGenerate}
                className="btn-primary px-5 py-2.5"
              >
                Generate deck
              </button>
            </div>
            {!hasApiKey ? (
              <p className="-mt-3 text-right text-xs">
                <button
                  onClick={() => openSettings(true)}
                  className="text-chalk-dim hover:text-chalk rounded-sm underline underline-offset-2 transition-colors duration-150"
                >
                  Add your Gemini API key in Settings
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
