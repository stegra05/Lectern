import { memo, useState } from 'react'
import type { Card } from '../engine/types'
import { renderCardHtml } from '../lib/render'
import { useLectern } from '../state/store'

/** Accepted cards score 100 minus 10 per soft issue — flag at 2+ issues. */
const QUALITY_ATTENTION_THRESHOLD = 85

export const CardTile = memo(function CardTile({
  card,
  editable,
  animate,
}: {
  card: Card
  editable: boolean
  animate: boolean
}) {
  const editingUid = useLectern((s) => s.editingUid)
  const setEditingUid = useLectern((s) => s.setEditingUid)
  const removeCard = useLectern((s) => s.removeCard)
  const isEditing = editingUid === card.uid
  const needsAttention = card.qualityScore < QUALITY_ATTENTION_THRESHOLD

  return (
    <article
      className={`group bg-paper shadow-card relative rounded-lg p-4 ${
        animate ? 'card-settle' : ''
      }`}
    >
      {isEditing ? (
        <CardEditorInline card={card} />
      ) : (
        <>
          <CardBody card={card} />
          <footer className="border-ink/8 mt-3 flex items-baseline justify-between gap-3 border-t pt-2">
            <span className="font-data text-ink-soft truncate text-2xs">
              {card.sourcePages.length > 0 && `p. ${card.sourcePages.join(', ')}`}
              {needsAttention && (
                <span
                  className="bg-lamp/20 text-lamp-ink ml-2 rounded-sm px-1 py-px"
                  title={`Quality score ${Math.round(card.qualityScore)} of 100 — worth a read before sending`}
                >
                  check wording
                </span>
              )}
              {card.ankiNoteId ? ' · in Anki' : ''}
            </span>
            {card.slideTopic && (
              <span className="font-data text-ink-soft shrink-0 text-2xs">{card.slideTopic}</span>
            )}
          </footer>
          {editable && (
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
              <button onClick={() => setEditingUid(card.uid)} className="btn-paper px-2 py-1">
                Edit
              </button>
              <button
                onClick={() => removeCard(card.uid)}
                className="btn-paper text-brick hover:text-brick px-2 py-1"
              >
                Remove
              </button>
            </div>
          )}
        </>
      )}
    </article>
  )
})

function CardBody({ card }: { card: Card }) {
  if (card.modelName === 'Cloze') {
    const text = card.fields.Text ?? Object.values(card.fields)[0] ?? ''
    return (
      <div
        className="card-content"
        dangerouslySetInnerHTML={{
          __html: renderCardHtml(text, { cloze: 'shown' }),
        }}
      />
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
      <div className="bg-ink/8 h-px" />
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

  return (
    <div
      className="space-y-3"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setEditingUid(null)
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
            className="border-ink/15 bg-paper-shade/60 font-card text-ink focus-visible:border-lamp-deep/60 mt-1 w-full resize-y rounded-sm border p-2 text-base transition-[border-color] duration-150 focus-visible:outline-none"
          />
        </label>
      ))}
      <div className="flex items-center justify-end gap-2">
        <span className="font-data text-ink-soft/70 mr-auto text-2xs">esc cancels · ⌘↩ saves</span>
        <button
          onClick={() => setEditingUid(null)}
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
