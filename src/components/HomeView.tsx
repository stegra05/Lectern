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
  const startGeneration = useLectern((s) => s.startGeneration)

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
              <div className="absolute inset-0 translate-y-2 rotate-[-1.6deg] rounded-lg bg-paper/20 transition-transform duration-300 group-hover:rotate-[-2.4deg]" />
              <div className="absolute inset-0 translate-y-1 rotate-[1.1deg] rounded-lg bg-paper/45 transition-transform duration-300 group-hover:rotate-[1.8deg]" />
              <div className="relative flex aspect-[3/2] flex-col items-center justify-center rounded-lg bg-paper shadow-[0_10px_30px_rgb(0_0_0/0.5)] transition-transform duration-300 group-hover:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-lamp">
                <p className="font-card text-[19px] font-medium text-ink">Drop a lecture PDF</p>
                <p className="mt-1.5 text-[13px] text-ink-soft">or click to browse</p>
              </div>
            </button>
            <p className="eyebrow mt-10 text-center">PDF → concept map → flashcards → Anki</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Source document */}
            <section className="flex items-center gap-4 rounded-md bg-desk-raised/70 p-3">
              <div className="h-16 w-[85px] shrink-0 overflow-hidden rounded-sm bg-paper/15">
                {pageThumbs[1] && (
                  <img src={pageThumbs[1]} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-chalk">{fileName}</p>
                {pdfInfo && (
                  <p className="mt-0.5 font-data text-[12px] text-chalk-dim">
                    {pdfInfo.pageCount} pages · {Math.round(pdfInfo.textChars / 1000)}k chars
                  </p>
                )}
              </div>
              <button
                onClick={clearPdf}
                className="rounded px-2 py-1 text-[13px] text-chalk-dim hover:text-chalk"
              >
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
                className="mt-1.5 w-full rounded-md bg-desk-raised px-3 py-2 text-[14px] text-chalk placeholder:text-chalk-dim/60"
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
                <span className="font-data text-[12px] text-chalk-dim">
                  {targetCards ?? `auto · ~${sizing?.totalCardCap ?? '—'}`} cards
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={Math.max(80, (sizing?.totalCardCap ?? 40) * 2)}
                value={targetCards ?? sizing?.totalCardCap ?? 30}
                onChange={(e) => setTargetCards(Number(e.target.value))}
                className="mt-2 w-full accent-lamp"
                aria-label="Target number of cards"
              />
              {targetCards !== null && (
                <button
                  onClick={() => setTargetCards(null)}
                  className="mt-1 text-[12px] text-chalk-dim underline-offset-2 hover:text-chalk hover:underline"
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
                className="mt-1.5 w-full resize-none rounded-md bg-desk-raised px-3 py-2 text-[14px] text-chalk placeholder:text-chalk-dim/60"
              />
            </label>

            {/* Generate */}
            <div className="flex items-center justify-between pt-2">
              <p className="font-data text-[12px] text-chalk-dim">
                {settings?.model &&
                  (MODEL_CHOICES.find((m) => m.id === settings.model)?.label.split(' — ')[0] ??
                    settings.model)}
                {estimate && ` · ~$${estimate.costUsd.toFixed(2)}`}
              </p>
              <button
                onClick={() => void startGeneration()}
                className="rounded-md bg-lamp px-5 py-2.5 text-[14px] font-semibold text-ink transition-colors hover:bg-lamp-deep"
              >
                Generate deck
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
