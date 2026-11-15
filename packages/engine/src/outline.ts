/**
 * The course as a Markdown outline: lectures, topics, concepts, and under each concept its
 * cards as question and answer. Read from the stored files; no model is involved.
 */

import type { CardFile } from './cards/assemble.ts'
import { CLOZE, htmlToText, two } from './cards/words.ts'
import { paths, readCards, readJson, type CourseFile, type Lecture } from './course.ts'
import { EngineError } from './errors.ts'
import type { Store } from './ports.ts'

export async function outline(store: Store, course: string): Promise<string> {
  const file = await readJson<CourseFile>(store, paths.course(course))
  if (!file) throw new EngineError(`No course found in ${course}.`, 'Build the course first.')
  const lines = [`# ${file.name}`]
  for (const { number } of file.lectures) {
    const lecture = (await readJson<Lecture>(store, paths.lecture(course, number)))!
    const cards = await readCards(store, course, number)
    lines.push('', `## ${two(number)} ${lecture.title}`)
    for (const topic of lecture.topics) {
      lines.push('', `### ${topic.name}`)
      for (const concept of topic.concepts) {
        const own = cards.filter((c) => c.concept === concept.id).map(questionAndAnswer)
        lines.push('', `#### ${concept.name}`, ...(own.length > 0 ? [''] : []))
        for (const { question, answer } of own) lines.push(`- Q: ${question}`, `  A: ${answer}`)
      }
    }
  }
  return `${lines.join('\n')}\n`
}

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
