import { useEffect, useMemo, useRef, useState } from 'react'
import type { Concept, NoteKind } from '../engine/types'
import { renderCardHtml } from '../lib/render'
import { useLectern, type CardComposerInitial } from '../state/store'

export function CardComposer() {
  const composer = useLectern((s) => s.cardComposer)
  if (!composer) return null
  return <CardComposerInline key={`${composer.sourcePage}-${composer.front}`} composer={composer} />
}

function CardComposerInline({ composer }: { composer: CardComposerInitial }) {
  const closeComposer = useLectern((s) => s.closeCardComposer)
  const addCard = useLectern((s) => s.addCard)
  const peekSlide = useLectern((s) => s.peekSlide)
  const conceptMap = useLectern((s) => s.conceptMap)
  const pdfInfo = useLectern((s) => s.pdfInfo)

  const containerRef = useRef<HTMLDivElement>(null)

  const [modelName, setModelName] = useState<NoteKind>(composer.modelName ?? 'Basic')
  const [front, setFront] = useState(composer.front ?? '')
  const [back, setBack] = useState(composer.back ?? '')
  const [text, setText] = useState(composer.text ?? composer.front ?? '')
  const [backExtra, setBackExtra] = useState(composer.backExtra ?? '')
  const [slideNumber, setSlideNumber] = useState<number>(composer.sourcePage ?? 1)
  const [topic, setTopic] = useState(composer.topic ?? '')
  const [excerpt, setExcerpt] = useState(composer.excerpt ?? '')
  const [selectedConceptIds, setSelectedConceptIds] = useState<string[]>(composer.conceptIds ?? [])
  const [conceptSearch, setConceptSearch] = useState('')
  const [showClozeAnswer, setShowClozeAnswer] = useState(false)
  const [errorHint, setErrorHint] = useState<string | null>(null)

  const clozeTextareaRef = useRef<HTMLTextAreaElement>(null)
  const pageCount = pdfInfo?.pageCount ?? 1

  // Keep the slide peek in sync when slideNumber changes.
  const handleSlideChange = (newSlide: number) => {
    const clamped = Math.max(1, Math.min(pageCount, newSlide))
    setSlideNumber(clamped)
    peekSlide(clamped)
  }

  // Scroll composer into view when mounted
  useEffect(() => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  // Seamless transfer between Q&A (Basic) and Fill in the blank (Cloze)
  const switchModel = (nextModel: NoteKind) => {
    if (nextModel === modelName) return
    setErrorHint(null)

    if (nextModel === 'Cloze') {
      // Basic -> Cloze: transfer front and back into cloze text
      if (front.trim() && back.trim()) {
        setText(`${front.trim()}: {{c1::${back.trim()}}}`)
        setBackExtra('')
      } else if (front.trim()) {
        setText(front.trim())
      } else if (back.trim()) {
        setText(`{{c1::${back.trim()}}}`)
      }
      setModelName('Cloze')
    } else {
      // Cloze -> Basic: extract cloze answers to back and prompt to front
      const clozeMatches = [...text.matchAll(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g)]
      if (clozeMatches.length > 0) {
        const answers = clozeMatches
          .map((m) => m[1].trim())
          .filter(Boolean)
          .join(', ')
        const cleanPrompt = text.replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '[...]').trim()
        setFront(cleanPrompt)
        setBack(backExtra.trim() ? `${answers}\n\n${backExtra.trim()}` : answers)
      } else {
        setFront(text.trim())
        setBack(backExtra.trim())
      }
      setModelName('Basic')
    }
  }

  const smartConcepts = useMemo(() => {
    if (!conceptMap) return []
    return conceptMap.concepts.filter((c) => c.pageReferences.includes(slideNumber))
  }, [conceptMap, slideNumber])

  const filteredConcepts = useMemo(() => {
    if (!conceptMap) return []
    if (!conceptSearch.trim()) return conceptMap.concepts
    const q = conceptSearch.toLowerCase()
    return conceptMap.concepts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
    )
  }, [conceptMap, conceptSearch])

  const toggleConcept = (conceptId: string) => {
    setSelectedConceptIds((prev) =>
      prev.includes(conceptId) ? prev.filter((id) => id !== conceptId) : [...prev, conceptId],
    )
  }

  const handleMakeCloze = () => {
    const el = clozeTextareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = text.slice(start, end)

    const matches = [...text.matchAll(/\{\{c(\d+)::/g)]
    const maxIdx = matches.reduce((max, m) => Math.max(max, parseInt(m[1], 10)), 0)
    const nextIdx = maxIdx + 1

    const replacement = selected ? `{{c${nextIdx}::${selected}}}` : `{{c${nextIdx}::}}`
    const updated = text.slice(0, start) + replacement + text.slice(end)
    setText(updated)
    setErrorHint(null)

    setTimeout(() => {
      el.focus()
      if (selected) {
        el.setSelectionRange(start, start + replacement.length)
      } else {
        const cursor = start + `{{c${nextIdx}::`.length
        el.setSelectionRange(cursor, cursor)
      }
    }, 0)
  }

  const handleSave = () => {
    if (modelName === 'Basic') {
      if (!front.trim()) {
        setErrorHint('Enter a question or prompt for the front of the card.')
        return
      }
      if (!back.trim()) {
        setErrorHint('Enter an answer for the back of the card.')
        return
      }
      addCard({
        modelName: 'Basic',
        fields: { Front: front.trim(), Back: back.trim() },
        sourcePages: slideNumber > 0 ? [slideNumber] : [],
        slideTopic: topic.trim() || undefined,
        sourceExcerpt: excerpt.trim() || undefined,
        conceptIds: selectedConceptIds,
      })
    } else {
      if (!text.trim()) {
        setErrorHint('Enter the card text.')
        return
      }
      if (!/\{\{c\d+::[\s\S]*?\}\}/.test(text)) {
        setErrorHint(
          'Select a word and click "Hide selection as cloze" to create a fill-in deletion.',
        )
        return
      }
      const fields: Record<string, string> = { Text: text.trim() }
      if (backExtra.trim()) fields['Back Extra'] = backExtra.trim()

      addCard({
        modelName: 'Cloze',
        fields,
        sourcePages: slideNumber > 0 ? [slideNumber] : [],
        slideTopic: topic.trim() || undefined,
        sourceExcerpt: excerpt.trim() || undefined,
        conceptIds: selectedConceptIds,
      })
    }
  }

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="New card composer"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          closeComposer()
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          handleSave()
        } else if (
          (e.key === 'c' || e.key === 'C') &&
          e.shiftKey &&
          (e.metaKey || e.ctrlKey) &&
          modelName === 'Cloze'
        ) {
          e.preventDefault()
          handleMakeCloze()
        }
      }}
      className="bg-desk-raised border-2 border-lamp/40 rounded-lg p-5 shadow-sheet rise-in space-y-4 mb-4"
    >
      <header className="flex items-center justify-between border-b border-desk-edge/60 pb-3">
        <div>
          <h2 id="composer-title" className="text-chalk text-md font-semibold">
            New flashcard
          </h2>
          <p className="text-chalk-dim text-xs">
            Linked to slide {slideNumber} of {pageCount}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Note kind segmented switch with field transfer */}
          <div
            className="flex rounded-md border border-desk-edge/80 p-0.5"
            role="group"
            aria-label="Card type"
          >
            <button
              type="button"
              onClick={() => switchModel('Basic')}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors duration-150 ${
                modelName === 'Basic' ? 'bg-lamp text-ink' : 'text-chalk-dim hover:text-chalk'
              }`}
            >
              Question & answer
            </button>
            <button
              type="button"
              onClick={() => switchModel('Cloze')}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors duration-150 ${
                modelName === 'Cloze' ? 'bg-lamp text-ink' : 'text-chalk-dim hover:text-chalk'
              }`}
            >
              Fill in the blank
            </button>
          </div>

          <button
            type="button"
            onClick={closeComposer}
            className="btn-ghost px-2 py-1 text-chalk-dim hover:text-chalk"
            aria-label="Close composer (esc)"
            title="Close (esc)"
          >
            ✕
          </button>
        </div>
      </header>

      {errorHint && (
        <div
          role="alert"
          className="rounded-md border border-brick/40 bg-brick/15 px-3 py-2 text-xs text-chalk"
        >
          {errorHint}
        </div>
      )}

      {modelName === 'Basic' ? (
        <>
          <label className="block">
            <span className="eyebrow block mb-1">Front · Question</span>
            <textarea
              value={front}
              onChange={(e) => {
                setFront(e.target.value)
                setErrorHint(null)
              }}
              autoFocus
              rows={3}
              placeholder="e.g. What is the role of the loss function in training a neural network?"
              className="field resize-y font-card text-base text-chalk"
            />
          </label>

          <label className="block">
            <span className="eyebrow block mb-1">Back · Answer</span>
            <textarea
              value={back}
              onChange={(e) => {
                setBack(e.target.value)
                setErrorHint(null)
              }}
              rows={3}
              placeholder="e.g. It measures the discrepancy between predicted and target values to guide optimization."
              className="field resize-y font-card text-base text-chalk"
            />
          </label>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Card text with cloze deletion</span>
              <button
                type="button"
                onClick={handleMakeCloze}
                className="btn-secondary px-2.5 py-1 text-xs text-lamp border-lamp/40 hover:border-lamp"
                title="Select text and click or press ⌘+Shift+C"
              >
                + Hide selection as cloze (c1)
              </button>
            </div>

            <textarea
              ref={clozeTextareaRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setErrorHint(null)
              }}
              autoFocus
              rows={4}
              placeholder="e.g. The {{c1::learning rate}} dictates the step size taken during gradient descent."
              className="field resize-y font-card text-base text-chalk"
            />
            <p className="text-chalk-faint text-2xs">
              Tip: Highlight any word in the text above and click the button to hide it.
            </p>
          </div>

          {/* Live Preview for Cloze card */}
          {text.trim() && (
            <div className="rounded-md border border-desk-edge/50 bg-desk/50 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="eyebrow">Live preview</span>
                <button
                  type="button"
                  onClick={() => setShowClozeAnswer((v) => !v)}
                  className="text-chalk-dim hover:text-chalk text-2xs underline underline-offset-2"
                >
                  {showClozeAnswer ? 'preview as asked' : 'preview with answer'}
                </button>
              </div>
              <div className="bg-paper text-ink shadow-card rounded p-3">
                <div
                  className="card-content"
                  dangerouslySetInnerHTML={{
                    __html: renderCardHtml(text, {
                      cloze: showClozeAnswer ? 'shown' : 'hidden',
                    }),
                  }}
                />
                {backExtra.trim() && (
                  <div className="mt-2.5 pt-2 border-t border-ink/10 text-ink-soft text-sm">
                    {backExtra}
                  </div>
                )}
              </div>
            </div>
          )}

          <label className="block">
            <span className="eyebrow block mb-1">Back extra · optional</span>
            <textarea
              value={backExtra}
              onChange={(e) => setBackExtra(e.target.value)}
              rows={2}
              placeholder="Additional context shown on the back side of the card."
              className="field resize-y font-card text-sm text-chalk"
            />
          </label>
        </>
      )}

      {/* Slide & Topic metadata */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <div>
          <span className="eyebrow block mb-1">Source slide</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleSlideChange(slideNumber - 1)}
              disabled={slideNumber <= 1}
              className="btn-ghost px-2 py-1.5 border border-desk-edge/60"
              aria-label="Previous slide"
            >
              ←
            </button>
            <input
              type="number"
              min={1}
              max={pageCount}
              value={slideNumber}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                if (!isNaN(val)) handleSlideChange(val)
              }}
              className="field py-1 text-center font-data text-xs"
            />
            <button
              type="button"
              onClick={() => handleSlideChange(slideNumber + 1)}
              disabled={slideNumber >= pageCount}
              className="btn-ghost px-2 py-1.5 border border-desk-edge/60"
              aria-label="Next slide"
            >
              →
            </button>
            <span className="font-data text-chalk-dim text-2xs pl-1">of {pageCount}</span>
          </div>
        </div>

        <div>
          <span className="eyebrow block mb-1">Slide topic · optional</span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Optimization Algorithms"
            className="field py-1 text-xs"
          />
        </div>
      </div>

      {excerpt && (
        <div className="border-desk-edge/50 rounded border bg-desk/40 p-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="eyebrow">Source excerpt from slide</span>
            <button
              type="button"
              onClick={() => setExcerpt('')}
              className="text-chalk-faint hover:text-chalk text-2xs"
              title="Clear excerpt"
            >
              ✕
            </button>
          </div>
          <p className="font-card italic text-chalk-dim text-xs line-clamp-3">{excerpt}</p>
        </div>
      )}

      {/* Knowledge Graph Linking (Optional) */}
      {conceptMap && conceptMap.concepts.length > 0 && (
        <div className="border-t border-desk-edge/60 pt-3">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="eyebrow">Link to knowledge graph · optional</span>
            <span className="font-data text-chalk-dim text-2xs">
              {selectedConceptIds.length} linked
            </span>
          </div>
          <p className="text-chalk-faint text-2xs mb-2">
            Linked concepts will light up on the concept map and increase coverage.
          </p>

          {/* Selected concept chips */}
          {selectedConceptIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {selectedConceptIds.map((id) => {
                const c = conceptMap.concepts.find((item) => item.id === id)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleConcept(id)}
                    className="bg-lamp/20 text-lamp border border-lamp/40 rounded px-2 py-0.5 text-xs font-data flex items-center gap-1 hover:bg-lamp/30"
                    title="Click to remove link"
                  >
                    {c?.name ?? id} ✕
                  </button>
                )
              })}
            </div>
          )}

          {/* Smart suggestions for current slide */}
          {smartConcepts.length > 0 && (
            <div className="mb-2">
              <span className="text-chalk-dim text-2xs block mb-1">Taught on this slide:</span>
              <div className="flex flex-wrap gap-1.5">
                {smartConcepts.map((concept: Concept) => {
                  const isSelected = selectedConceptIds.includes(concept.id)
                  return (
                    <button
                      key={concept.id}
                      type="button"
                      onClick={() => toggleConcept(concept.id)}
                      className={`rounded px-2 py-0.5 text-xs font-data transition-colors duration-150 border ${
                        isSelected
                          ? 'bg-lamp text-ink border-lamp font-medium'
                          : 'bg-desk-edge/40 text-chalk hover:bg-desk-edge/80 border-desk-edge/70'
                      }`}
                    >
                      {isSelected ? '✓ ' : '+ '}
                      {concept.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Searchable concept picker */}
          <div className="relative">
            <input
              value={conceptSearch}
              onChange={(e) => setConceptSearch(e.target.value)}
              placeholder="Search all concepts in this lecture..."
              className="field py-1 text-xs"
            />
            {conceptSearch.trim() && (
              <div className="absolute left-0 right-0 top-full mt-1 max-h-36 overflow-y-auto rounded-md border border-desk-edge bg-desk-raised shadow-hero z-10 p-1 space-y-0.5">
                {filteredConcepts.map((c) => {
                  const isSelected = selectedConceptIds.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        toggleConcept(c.id)
                        setConceptSearch('')
                      }}
                      className={`w-full text-left px-2.5 py-1 rounded text-xs flex items-center justify-between ${
                        isSelected ? 'bg-lamp/20 text-lamp' : 'text-chalk hover:bg-desk-hover'
                      }`}
                    >
                      <span>{c.name}</span>
                      <span className="font-data text-chalk-faint text-2xs">
                        {c.pageReferences.length > 0 && `p. ${c.pageReferences.join(', ')}`}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <footer className="flex items-center justify-between border-t border-desk-edge/60 pt-3">
        <span className="font-data text-chalk-faint text-2xs">esc cancels · ⌘↩ saves</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={closeComposer} className="btn-ghost px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button type="button" onClick={handleSave} className="btn-primary px-4 py-1.5 text-sm">
            Create card
          </button>
        </div>
      </footer>
    </div>
  )
}
