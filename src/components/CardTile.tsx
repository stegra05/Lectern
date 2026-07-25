import { memo, useEffect, useRef, useState } from 'react'
import type { Card } from '../engine/types'
import { confirmDiscard } from '../lib/confirm'
import { plainCardText, renderCardHtml } from '../lib/render'
import { useLectern } from '../state/store'

/** What a screen reader says when the selection lands on a card. */
const cardLabel = (card: Card): string => {
  const prompt = plainCardText(card.fields.Front ?? card.fields.Text ?? '').slice(0, 120)
  const pages = card.sourcePages.length > 0 ? `, page ${card.sourcePages.join(', ')}` : ''
  return `${card.modelName} card: ${prompt}${pages}`
}

/** Accepted cards score 100 minus 10 per soft issue — flag at 2+ issues. */
const QUALITY_ATTENTION_THRESHOLD = 85

export const CardTile = memo(function CardTile({
  card,
  editable,
  selected,
  animate,
}: {
  card: Card
  editable: boolean
  selected: boolean
  animate: boolean
}) {
  const editingUid = useLectern((s) => s.editingUid)
  const setEditingUid = useLectern((s) => s.setEditingUid)
  const setSelectedUid = useLectern((s) => s.setSelectedUid)
  const removeCard = useLectern((s) => s.removeCard)
  const peekSlide = useLectern((s) => s.peekSlide)
  const setCardSyncExcluded = useLectern((s) => s.setCardSyncExcluded)
  const ref = useRef<HTMLElement>(null)
  const isEditing = editingUid === card.uid
  const needsAttention = card.qualityScore < QUALITY_ATTENTION_THRESHOLD
  // Cloze cards study as a question, so the review has to be able to see one.
  const [showClozeAnswer, setShowClozeAnswer] = useState(true)

  // Keep the keyboard-selected card in view, and move focus with it so a
  // screen reader announces the card j/k just landed on.
  useEffect(() => {
    if (!selected) return
    ref.current?.scrollIntoView({ block: 'nearest' })
    if (document.activeElement !== ref.current && !ref.current?.contains(document.activeElement)) {
      ref.current?.focus({ preventScroll: true })
    }
  }, [selected])

  return (
    <article
      ref={ref}
      onClick={editable ? () => setSelectedUid(card.uid) : undefined}
      role={editable ? 'option' : undefined}
      aria-selected={editable ? selected : undefined}
      tabIndex={editable ? (selected ? 0 : -1) : undefined}
      aria-label={editable ? cardLabel(card) : undefined}
      className={`group bg-paper shadow-card relative scroll-mb-24 rounded-lg p-4 ${
        animate ? 'card-settle' : ''
      } ${selected ? 'ring-lamp ring-2' : ''} ${
        // Cards carried over from the deck sit back a step: they are context
        // for this session, not its output.
        card.fromAnki
          ? 'opacity-85 transition-opacity duration-150 group-focus-within:opacity-100 hover:opacity-100'
          : ''
      }`}
    >
      {isEditing ? (
        <CardEditorInline card={card} />
      ) : (
        <>
          {card.slideTopic && (
            <div className="font-data text-ink-soft mb-2 text-2xs tracking-wide uppercase">
              {card.slideTopic}
            </div>
          )}
          <CardBody
            card={card}
            showClozeAnswer={showClozeAnswer}
            onToggleCloze={() => setShowClozeAnswer((v) => !v)}
          />
          <footer className="border-ink/8 mt-3 flex items-baseline justify-between gap-3 border-t pt-2">
            <span className="font-data text-ink-soft flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-2xs">
              {card.sourcePages.length > 0 && (
                <>
                  {'p. '}
                  {card.sourcePages.map((p, i) => (
                    <button
                      key={p}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (editable) setSelectedUid(card.uid)
                        peekSlide(p)
                      }}
                      className="hover:text-lamp-ink rounded-sm underline-offset-2 transition-colors duration-150 hover:underline"
                      aria-label={`View slide ${p}`}
                      title={`View slide ${p}`}
                    >
                      {i > 0 && ', '}
                      {p}
                    </button>
                  ))}
                </>
              )}
              {card.outsideSource && (
                <span
                  className="bg-brick/10 text-brick rounded-sm px-1 py-px"
                  title="You asked for this card, but it is not in the uploaded document — check it before sending."
                >
                  outside source
                </span>
              )}
              {needsAttention && (
                <span
                  className="bg-lamp/20 text-lamp-ink rounded-sm px-1 py-px"
                  title={`${card.qualityIssues.map((i) => i.replaceAll('_', ' ')).join(', ')} — worth a read before sending`}
                >
                  {card.qualityIssues.includes('excerpt_not_on_cited_page')
                    ? 'check the source'
                    : 'check this one'}
                </span>
              )}
              {card.fromAnki && !card.edited && (
                <span
                  className="bg-ink/8 rounded-sm px-1 py-px"
                  title="Already in this deck from an earlier run. This session generated around it — edit it to send an update."
                >
                  already in the deck
                </span>
              )}
              {card.ankiNoteId && !(card.fromAnki && !card.edited) && (
                <span
                  className="bg-sage/15 text-ink-soft rounded-sm px-1 py-px"
                  title="This card has a note in Anki. Sending again updates that note rather than adding a second one."
                >
                  in Anki · updates
                </span>
              )}
            </span>
            {card.outsideSource && editable && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setCardSyncExcluded(card.uid, !card.syncExcluded)
                }}
                className="font-data text-ink-soft hover:text-ink shrink-0 text-2xs underline underline-offset-2 transition-colors duration-150"
                title="Outside-source cards stay out of the Anki send until you include them"
              >
                {card.syncExcluded ? 'not sent to Anki — include' : 'sent to Anki — exclude'}
              </button>
            )}
          </footer>
          {card.sourceExcerpt && (
            <details className="mt-2" onClick={(e) => e.stopPropagation()}>
              <summary className="font-data text-ink-soft hover:text-ink cursor-pointer text-2xs transition-colors duration-150">
                Source excerpt
              </summary>
              <blockquote className="font-card text-ink-soft border-lamp-deep bg-paper-shade mt-1.5 rounded-r-sm border-l-2 px-3 py-2 text-sm italic">
                {card.sourceExcerpt}
              </blockquote>
            </details>
          )}
          {editable && (
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
              <button onClick={() => setEditingUid(card.uid)} className="btn-paper px-2 py-1">
                Edit
              </button>
              {/* No Remove on an inherited card: this view cannot delete from
                  Anki, and a button that only hid it would imply otherwise. */}
              {card.fromAnki !== true && (
                <button
                  onClick={() => removeCard(card.uid)}
                  className="btn-paper text-brick hover:text-brick px-2 py-1"
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </>
      )}
    </article>
  )
})

function CardBody({
  card,
  showClozeAnswer,
  onToggleCloze,
}: {
  card: Card
  showClozeAnswer: boolean
  onToggleCloze: () => void
}) {
  if (card.modelName === 'Cloze') {
    const text = card.fields.Text ?? Object.values(card.fields)[0] ?? ''
    // "Back Extra" is on the answer side of the real card; leaving it out of
    // the review meant judging half a card.
    const extra = card.fields['Back Extra']
    return (
      <div className="space-y-2.5">
        <div
          className="card-content"
          dangerouslySetInnerHTML={{
            __html: renderCardHtml(text, { cloze: showClozeAnswer ? 'shown' : 'hidden' }),
          }}
        />
        {extra && (
          <>
            <div className="bg-lamp-deep h-0.5 w-10 rounded-full" />
            <div
              className="card-content"
              dangerouslySetInnerHTML={{ __html: renderCardHtml(extra) }}
            />
          </>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleCloze()
          }}
          className="font-data text-ink-soft hover:text-ink text-2xs underline underline-offset-2 transition-colors duration-150"
        >
          {showClozeAnswer ? 'show as asked' : 'show the answer'}
        </button>
      </div>
    )
  }
  const front = card.fields.Front ?? Object.values(card.fields)[0] ?? ''
  const back = card.fields.Back ?? Object.values(card.fields)[1] ?? ''
  return (
    <div className="space-y-2.5">
      <div
        className="card-content font-medium"
        dangerouslySetInnerHTML={{ __html: renderCardHtml(front) }}
      />
      <div className="bg-lamp-deep h-0.5 w-10 rounded-full" />
      <div className="card-content" dangerouslySetInnerHTML={{ __html: renderCardHtml(back) }} />
    </div>
  )
}

function CardEditorInline({ card }: { card: Card }) {
  const updateCardFields = useLectern((s) => s.updateCardFields)
  const setEditingUid = useLectern((s) => s.setEditingUid)
  const [draft, setDraft] = useState<Record<string, string>>({
    ...card.fields,
  })

  const save = () => updateCardFields(card.uid, draft)
  const dirty = Object.keys(draft).some((name) => draft[name] !== card.fields[name])
  const cancel = () => {
    if (!dirty) return setEditingUid(null)
    void confirmDiscard('Your edits to this card will be lost.', 'Discard edits?').then((ok) => {
      if (ok) setEditingUid(null)
    })
  }

  return (
    <div
      className="space-y-3"
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel()
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
      }}
    >
      {Object.entries(draft).map(([name, value]) => (
        <label key={name} className="block">
          <span className="font-data text-ink-soft text-2xs tracking-wide uppercase">{name}</span>
          <textarea
            value={value}
            autoFocus={name === Object.keys(draft)[0]}
            onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value }))}
            rows={Math.max(2, Math.ceil(value.length / 70))}
            className="border-ink/15 bg-paper-shade/60 font-card text-ink focus-visible:border-lamp-deep/60 mt-1 w-full resize-y rounded-sm border p-2 text-base transition-[border-color] duration-150"
          />
        </label>
      ))}
      <div className="flex items-center justify-end gap-2">
        <span className="font-data text-ink-soft mr-auto text-2xs">esc cancels · ⌘↩ saves</span>
        <button
          onClick={cancel}
          className="btn text-ink-soft hover:bg-paper-shade hover:text-ink px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
        <button
          onClick={save}
          className="btn bg-ink text-paper hover:bg-ink/85 px-3 py-1.5 text-sm"
        >
          Save card
        </button>
      </div>
    </div>
  )
}
