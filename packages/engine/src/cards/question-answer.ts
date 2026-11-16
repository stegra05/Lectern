import { CLOZE, htmlToText } from './words.ts'
import type { Card } from './card.ts'
import { cardFields } from './fields.ts'

/** A card as one question and one answer in plain text, read from its fields. */
export function questionAndAnswer(card: Card): { question: string; answer: string } {
  const f = cardFields(card)
  if (f.Text !== undefined) {
    const hidden = [...f.Text.matchAll(CLOZE)].map((m) => htmlToText(m[2]!))
    return { question: htmlToText(f.Text.replace(CLOZE, '[...]')), answer: hidden.join('; ') }
  }
  const items = [...f.Back!.matchAll(/<li>(.*?)<\/li>/g)].map((m) => htmlToText(m[1]!))
  const labels = [...f.Slots!.matchAll(/<span>(.+?)<\/span>/g)].map((m) => htmlToText(m[1]!))
  const answer =
    items.length === 0
      ? htmlToText(f.Back!)
      : items
          .map((item, i) =>
            f.Role === 'contrast' || f.Role === 'code' ? `${labels[i]}: ${item}` : item,
          )
          .join('; ')
  return { question: htmlToText(f.Front!), answer }
}
