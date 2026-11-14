/**
 * Sending a course to Anki: Lectern's two note types in the chosen design, one deck per
 * lecture under the course's deck, the slide pictures, and one note per card.
 *
 * A card is sent once. `<course>/anki.json` records the Anki note of every card that went, so
 * a later send adds only what is new and never touches a note that is already there: not its
 * wording, not its progress, and not a note the student has deleted.
 */

import type { Emit } from './api.ts'
import type { CardFile } from './cards/assemble.ts'
import { two } from './cards/words.ts'
import { paths, readCards, readJson, writeJson, type CourseFile } from './course.ts'
import type { Design } from './designs.ts'
import { EngineError } from './errors.ts'
import type { DesignFiles, NoteType, Ports, Store } from './ports.ts'

/** The fields of `design/v3/cards/FIELDS.md`, in its order. The first is the one Anki requires. */
const PROVENANCE = [
  ...['Lecture', 'Topic', 'Source', 'Asked', 'Part'],
  ...['Extra', 'Excerpt', 'Slide', 'Diagram', 'Key'],
]
const QA_FIELDS = ['Front', 'Back', 'Role', 'Slots', 'Code', 'Typed', ...PROVENANCE]
const CLOZE_FIELDS = ['Text', 'Role', 'Typed', ...PROVENANCE]

/**
 * The cloze type is not named "Lectern Cloze": Lectern 2 installed a note type of that name
 * with other fields, and a student who used it still has it.
 */
export const NOTE_TYPE_NAMES = { qa: 'Lectern Q&A', cloze: 'Lectern Cloze v3' } as const

/**
 * Every stylesheet Lectern ships opens with this line. While it is there the note type is
 * Lectern's to restyle. A student who edits the styling removes the line and owns it from then on.
 */
const OWNED = /^\/\* lectern-notetype v\d+ skin:/

function noteTypes({ templates, css }: DesignFiles): NoteType[] {
  return [
    {
      name: NOTE_TYPE_NAMES.qa,
      cloze: false,
      fields: QA_FIELDS,
      css,
      template: { name: 'Card', front: templates.front, back: templates.back },
    },
    {
      name: NOTE_TYPE_NAMES.cloze,
      cloze: true,
      fields: CLOZE_FIELDS,
      css,
      template: { name: 'Cloze', front: templates.clozeFront, back: templates.clozeBack },
    },
  ]
}

/**
 * Brings Lectern's note types to the design. With `create` a missing type is installed;
 * without, only types that are already in Anki change. Returns the names it wrote.
 */
async function applyDesign(
  { anki, designs }: Pick<Ports, 'anki' | 'designs'>,
  design: Design,
  create: boolean,
): Promise<string[]> {
  const existing = new Set(await anki.noteTypes())
  const files = await designs.load(design)
  const written: string[] = []
  for (const type of noteTypes(files)) {
    const there = existing.has(type.name)
    if (there ? !OWNED.test(await anki.styling(type.name)) : !create) continue
    // The fonts go first, so a card never asks for a font that is not there yet.
    if (written.length === 0) {
      for (const font of files.fonts) await anki.storeMedia(font.name, font.data)
    }
    await (there ? anki.restyle(type) : anki.createNoteType(type))
    written.push(type.name)
  }
  return written
}

/**
 * The cards already in Anki look like the design from now on. Their notes are not touched.
 * While no course has been sent there is nothing to change, and Anki need not be open.
 */
export async function restyle(ports: Ports, design: Design, emit: Emit): Promise<void> {
  const { store } = ports
  let sent = false
  for (const course of await store.list('')) {
    sent ||= (await sentCards(store, course)).size > 0
  }
  emit({ type: 'restyled', noteTypes: sent ? await applyDesign(ports, design, false) : [] })
}

/** Which Anki note each sent card became. */
interface Delivery {
  notes: Record<string, number>
}

async function readDelivery(store: Store, course: string): Promise<Delivery> {
  return (await readJson<Delivery>(store, paths.anki(course))) ?? { notes: {} }
}

/** The ids of the cards that are in Anki. */
export async function sentCards(store: Store, course: string): Promise<Set<string>> {
  return new Set(Object.keys((await readDelivery(store, course)).notes))
}

/** A deck name cannot hold `::`, which separates a deck from its subdeck, or a quote. */
const deckPart = (name: string) => name.replace(/::+/g, ':').replace(/"/g, '').trim()

/** `Entrepreneurship::02 Effectuation`: the number first, so Anki lists lectures in course order. */
export function deckName(course: string, lecture: { number: number; title: string }): string {
  return `${deckPart(course)}::${two(lecture.number)} ${deckPart(lecture.title)}`
}

/**
 * A card names its slide picture as `l02-s14.png`. Anki keeps the pictures of all decks in one
 * folder, so the file there carries the course as well.
 */
const mediaName = (course: string, lecture: number, slide: number) =>
  `lectern-${course}-l${two(lecture)}-s${two(slide)}.png`

function fieldsForAnki(course: string, card: CardFile): Record<string, string> {
  return Object.fromEntries(
    Object.entries(card.fields).map(([name, value]) => [
      name,
      value.replace(/(<img src=")(l\d+-s\d+\.png">)/g, `$1lectern-${course}-$2`),
    ]),
  )
}

/** Tags are hierarchical in Anki: `entrepreneurship::lecture::02`, `entrepreneurship::role::case`. */
function tags(course: string, lecture: number, card: CardFile): string[] {
  return [`${course}::lecture::${two(lecture)}`, `${course}::role::${card.fields.Role}`]
}

export async function send(
  ports: Ports,
  { course, design }: { course: string; design: Design },
  emit: Emit,
): Promise<void> {
  const { store, pdf, anki } = ports
  const file = await readJson<CourseFile>(store, paths.course(course))
  if (!file) throw new EngineError(`No course found in ${course}.`, 'Create the course first.')

  const delivery = await readDelivery(store, course)
  const waiting: { lecture: CourseFile['lectures'][number]; cards: CardFile[] }[] = []
  for (const lecture of file.lectures) {
    const cards = (await readCards(store, course, lecture.number)).filter(
      (card) => !(card.id in delivery.notes),
    )
    if (cards.length > 0) waiting.push({ lecture, cards })
  }
  const total = waiting.reduce((sum, { cards }) => sum + cards.length, 0)
  if (total === 0) {
    throw new EngineError(
      'Every card of this course is already in Anki.',
      'Add a lecture and make its cards, then send again.',
    )
  }

  await applyDesign(ports, design, true)
  let done = 0
  try {
    for (const { lecture, cards } of waiting) {
      const deck = deckName(file.name, lecture)
      await anki.createDeck(deck)
      const slides = [...new Set(cards.map((card) => card.slide))].sort((a, b) => a - b)
      const pdfBytes = await store.readBytes(`${paths.slides(course)}/${lecture.file}`)
      for (const image of await pdf.renderSlides(pdfBytes, slides)) {
        await anki.storeMedia(mediaName(course, lecture.number, image.slide), image.png)
      }
      for (const card of cards) {
        delivery.notes[card.id] = await anki.addNote({
          deck,
          noteType: NOTE_TYPE_NAMES[card.note],
          fields: fieldsForAnki(course, card),
          tags: tags(course, lecture.number, card),
        })
        emit({ type: 'sending', lecture: lecture.number, done: ++done, total })
      }
    }
  } finally {
    // Also after a failure: what reached Anki must never be sent a second time.
    if (done > 0) await writeJson(store, paths.anki(course), delivery)
  }
  emit({ type: 'sent', cards: done, lectures: waiting.map(({ lecture }) => lecture.number) })
}
