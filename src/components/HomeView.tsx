import { useLectern } from '../state/store'
import { MODEL_CHOICES } from '../engine/config'

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
  const sizing = useLectern((s) => s.sizing)
  const estimate = useLectern((s) => s.estimate)
  const settings = useLectern((s) => s.settings)
  const hasApiKey = useLectern((s) => s.hasApiKey)
  const openSettings = useLectern((s) => s.openSettings)
  const startGeneration = useLectern((s) => s.startGeneration)

  const missingDeck = !deckName.trim()
  const cannotGenerate = !hasApiKey || missingDeck

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
                  {targetCards ?? `auto · ~${sizing?.totalCardCap ?? '—'}`} cards
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={Math.max(80, (sizing?.totalCardCap ?? 40) * 2)}
                value={targetCards ?? sizing?.totalCardCap ?? 30}
                onChange={(e) => setTargetCards(Number(e.target.value))}
                className="mt-2"
                aria-label="Target number of cards"
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
