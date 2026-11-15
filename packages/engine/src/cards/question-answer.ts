import { CLOZE, htmlToText } from './words.ts'
import type { CardFile } from './assemble.ts'

/** A card as one question and one answer in plain text, read back from its fields. */
export function questionAndAnswer(card: CardFile): { question: string; answer: string } {
  const f = card.fields
  if (card.note === 'cloze') {
    const hidden = [...f.Text!.matchAll(CLOZE)].map((m) => htmlToText(m[2]!))
    return { question: htmlToText(f.Text!.replace(CLOZE, '[...]')), answer: hidden.join('; ') }
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
