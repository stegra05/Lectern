import { memo, useState } from 'react'
import type { Card } from '../engine/types'
import { renderCardHtml } from '../lib/render'
import { useLectern } from '../state/store'

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

  return (
    <article
      className={`group relative rounded-md bg-paper p-4 shadow-[0_2px_10px_rgb(0_0_0/0.35)] ${
        animate ? 'card-settle' : ''
      }`}
    >
      {isEditing ? (
        <CardEditorInline card={card} />
      ) : (
        <>
          <CardBody card={card} />
          <footer className="mt-3 flex items-baseline justify-between gap-3 border-t border-ink/8 pt-2">
            <span className="truncate font-data text-[11px] text-ink-soft">
              {card.sourcePages.length > 0 && `p. ${card.sourcePages.join(', ')}`}
              {card.conceptIds.length > 0 && ` · ${card.conceptIds.slice(0, 2).join(' ')}`}
              {` · Q ${Math.round(card.qualityScore)}`}
              {card.ankiNoteId ? ' · in Anki' : ''}
            </span>
            {card.slideTopic && (
              <span className="shrink-0 font-data text-[11px] text-ink-soft">{card.slideTopic}</span>
            )}
          </footer>
          {editable && (
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <button
                onClick={() => setEditingUid(card.uid)}
                className="rounded bg-paper-shade px-2 py-1 text-[12px] font-medium text-ink-soft hover:text-ink"
              >
                Edit
              </button>
              <button
                onClick={() => removeCard(card.uid)}
                className="rounded bg-paper-shade px-2 py-1 text-[12px] font-medium text-brick hover:brightness-90"
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
        dangerouslySetInnerHTML={{ __html: renderCardHtml(text, { cloze: 'shown' }) }}
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
      <div className="h-px bg-ink/8" />
      <div className="card-content" dangerouslySetInnerHTML={{ __html: renderCardHtml(back) }} />
    </div>
  )
}

function CardEditorInline({ card }: { card: Card }) {
  const updateCardFields = useLectern((s) => s.updateCardFields)
  const setEditingUid = useLectern((s) => s.setEditingUid)
  const [draft, setDraft] = useState<Record<string, string>>({ ...card.fields })

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
          <span className="font-data text-[11px] tracking-wide text-ink-soft uppercase">{name}</span>
          <textarea
            value={value}
            autoFocus={name === Object.keys(draft)[0]}
            onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value }))}
            rows={Math.max(2, Math.ceil(value.length / 70))}
            className="mt-1 w-full resize-y rounded border border-ink/15 bg-paper-shade/60 p-2 font-card text-[14px] text-ink"
          />
        </label>
      ))}
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setEditingUid(null)}
          className="rounded px-3 py-1.5 text-[13px] text-ink-soft hover:text-ink"
        >
          Cancel
        </button>
        <button
          onClick={save}
          className="rounded bg-ink px-3 py-1.5 text-[13px] font-medium text-paper hover:bg-ink/85"
        >
          Save card
        </button>
      </div>
    </div>
  )
}
