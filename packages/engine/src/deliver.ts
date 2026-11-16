/**
 * Sending a course to Anki: Lectern's two note types in the Native design, one deck per
 * lecture under the course's deck, the slide pictures, and one note per card.
 *
 * A card is sent once. `<course>/anki.json` records the Anki note of every card that went, so
 * a later send adds only what is new and never touches a note that is already there: not its
 * wording, not its progress, and not a note the student has deleted.
 */

import type { Emit } from './commands.ts'
import type { Card } from './cards/card.ts'
import { cardFields } from './cards/fields.ts'
import { ROLE_SPECS } from './cards/roles.ts'
import { slug, two } from './cards/words.ts'
import { paths, readCards, readJson, writeJson, type CourseFile } from './course.ts'
import { EngineError } from './errors.ts'
import type { NoteType, Ports, Store, TemplateFiles } from './ports.ts'

/** The fields of `design/cards/FIELDS.md`, in its order. The first is the one Anki requires. */
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

/**
 * How often cards are added before the send gives up. Anki can hand back the id of a note that
 * is then not there: the add-on makes every added note an undo step, so a student who undoes
 * something in Anki while a send runs removes Lectern's newest note instead. The first send
 * into a real Anki lost 2 of 94 that way.
 */
const ATTEMPTS = 3

function noteTypes({ templates, css }: TemplateFiles): NoteType[] {
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
 * Installs Lectern's note types, or brings the ones in Anki to this version of the templates
 * and the stylesheet. A note type whose styling the student has edited is left as it is.
 */
async function installNoteTypes({ anki, templates }: Pick<Ports, 'anki' | 'templates'>) {
  const existing = new Set(await anki.noteTypes())
  for (const type of noteTypes(await templates.load())) {
    if (!existing.has(type.name)) await anki.createNoteType(type)
    else if (OWNED.test(await anki.styling(type.name))) await anki.restyle(type)
  }
}

/** Where the course is in Anki, and which Anki note each sent card became. */
interface Delivery {
  /** The course's deck, chosen at the first send and kept from then on. */
  deck?: string
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

/**
 * A deck for the course that is not there yet. A student may already have a deck of that
 * name, such as their own cards for the course, and Lectern's cards must not land in it.
 */
function freeDeck(decks: string[], course: string): string {
  // Anki tells deck names apart without regard to case.
  const taken = new Set(decks.map((deck) => deck.toLowerCase()))
  const name = deckPart(course)
  let deck = name
  for (let n = 1; taken.has(deck.toLowerCase()); n++) {
    deck = n === 1 ? `${name} (Lectern)` : `${name} (Lectern ${n})`
  }
  return deck
}

/** `Entrepreneurship::02 Effectuation`: the number first, so Anki lists lectures in course order. */
function lectureDeck(course: string, lecture: { number: number; title: string }): string {
  return `${course}::${two(lecture.number)} ${deckPart(lecture.title)}`
}

/** The course as media names and tags spell it: lowercase and without spaces, as Anki keeps them. */
const tagged = (course: string) => slug(course) || 'course'

/**
 * A card names its slide picture as `l02-s14.png`. Anki keeps the pictures of all decks in one
 * folder, so the file there carries the course as well.
 */
const mediaName = (course: string, lecture: number, slide: number) =>
  `lectern-${tagged(course)}-l${two(lecture)}-s${two(slide)}.png`

function fieldsForAnki(course: string, card: Card): Record<string, string> {
  return Object.fromEntries(
    Object.entries(cardFields(card)).map(([name, value]) => [
      name,
      value.replace(/(<img src=")(l\d+-s\d+\.png">)/g, `$1lectern-${tagged(course)}-$2`),
    ]),
  )
}

/**
 * Marks the note of a card, so a note that Anki added after the add-on gave up is found again.
 * It names the course: two courses may have cards with the same id.
 */
const idTag = (course: string, card: Card) => `lectern-id::${tagged(course)}::${card.id}`

/**
 * Tags are hierarchical in Anki: `entrepreneurship::lecture::02`, `entrepreneurship::role::case`,
 * and `entrepreneurship::own` on a card the student wrote.
 */
function tags(course: string, lecture: number, card: Card): string[] {
  const name = tagged(course)
  return [
    `${name}::lecture::${two(lecture)}`,
    `${name}::role::${card.slots.role}`,
    ...(card.own ? [`${name}::own`] : []),
    idTag(course, card),
  ]
}

/**
 * The student changed a card. When it is in Anki, its note takes the new wording and keeps its
 * progress. A note the student has deleted there is forgotten, so the card counts as not sent.
 */
export async function updateSent({ store, anki }: Ports, course: string, card: Card) {
  const delivery = await readDelivery(store, course)
  const note = delivery.notes[card.id]
  if (note === undefined) return
  if ((await anki.existingNotes([note])).length > 0) {
    await anki.updateNote(note, fieldsForAnki(course, card))
  } else {
    delete delivery.notes[card.id]
    await writeJson(store, paths.anki(course), delivery)
  }
}

/** The student removed a card. When it is in Anki, its note goes too. */
export async function removeSent({ store, anki }: Ports, course: string, card: string) {
  const delivery = await readDelivery(store, course)
  const note = delivery.notes[card]
  if (note === undefined) return
  await anki.deleteNotes([note])
  delete delivery.notes[card]
  await writeJson(store, paths.anki(course), delivery)
}

export async function send(
  ports: Ports,
  { course }: { course: string },
  emit: Emit,
  /** Aborted when the student stops the send: no card is added after it. */
  signal?: AbortSignal,
): Promise<void> {
  const { store, pdf, anki } = ports
  const file = await readJson<CourseFile>(store, paths.course(course))
  if (!file) throw new EngineError(`No course found in ${course}.`, 'Create the course first.')

  const delivery = await readDelivery(store, course)
  const waiting: { lecture: CourseFile['lectures'][number]; cards: Card[] }[] = []
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

  await installNoteTypes(ports)
  if (!delivery.deck) {
    delivery.deck = freeDeck(await anki.deckNames(), file.name)
    // Kept before the deck exists in Anki: once it does, its name would no longer look free.
    await writeJson(store, paths.anki(course), delivery)
  }
  interface Item {
    card: Card
    lecture: number
    deck: string
  }
  /** The cards Anki does not have, whatever it said when they were added. They count as not sent. */
  const lost = async (items: Item[]): Promise<Item[]> => {
    const there = new Set(
      await anki.existingNotes(items.map(({ card }) => delivery.notes[card.id]!)),
    )
    const gone = items.filter(({ card }) => !there.has(delivery.notes[card.id]!))
    for (const { card } of gone) delete delivery.notes[card.id]
    return gone
  }
  /** Adds the cards until Anki has them all. `onAdded` hears of each card once. */
  const add = async (items: Item[], onAdded?: (item: Item) => void): Promise<void> => {
    let missing = items
    for (let attempt = 1; missing.length > 0 && attempt <= ATTEMPTS; attempt++) {
      for (const item of missing) {
        if (signal?.aborted) {
          throw new EngineError(
            'The send was stopped.',
            'The cards already sent stay in Anki. Send again to add the rest.',
          )
        }
        const { card, lecture, deck } = item
        // A call that timed out may still have been applied: look for the note before adding
        // it again, and after an add that failed.
        let note = (await anki.taggedNotes(idTag(course, card)))[0]
        if (note === undefined) {
          try {
            note = await anki.addNote({
              deck,
              noteType: NOTE_TYPE_NAMES[ROLE_SPECS[card.slots.role].note],
              fields: fieldsForAnki(course, card),
              tags: tags(course, lecture, card),
            })
          } catch (error) {
            note = (await anki.taggedNotes(idTag(course, card)).catch(() => []))[0]
            if (note === undefined) throw error
          }
        }
        delivery.notes[card.id] = note
        if (attempt === 1) onAdded?.(item)
      }
      missing = await lost(missing)
    }
    if (missing.length > 0) {
      throw new EngineError(
        `${missing.length} ${missing.length === 1 ? 'card' : 'cards'} did not stay in Anki.`,
        'Do not undo or edit in Anki while Lectern sends. Then send again: only the missing cards are added.',
      )
    }
  }

  let done = 0
  const sent: Item[] = []
  try {
    for (const { lecture, cards } of waiting) {
      const deck = lectureDeck(delivery.deck, lecture)
      await anki.createDeck(deck)
      const slides = [...new Set(cards.map((card) => card.slide))].sort((a, b) => a - b)
      const pdfBytes = await store.readBytes(`${paths.slides(course)}/${lecture.file}`)
      for (const image of await pdf.renderSlides(pdfBytes, slides)) {
        await anki.storeMedia(mediaName(course, lecture.number, image.slide), image.png)
      }
      const items = cards.map((card) => ({ card, lecture: lecture.number, deck }))
      await add(items, () =>
        emit({ type: 'sending', lecture: lecture.number, done: ++done, total }),
      )
      sent.push(...items)
    }
    // Once more over everything: an undo while the next lecture's slides were drawn took the
    // last note of a lecture that had already been checked.
    await add(await lost(sent))
  } finally {
    // Also after a failure: what reached Anki must never be sent a second time.
    await writeJson(store, paths.anki(course), delivery)
  }
  emit({
    type: 'sent',
    deck: delivery.deck,
    cards: done,
    lectures: waiting.map(({ lecture }) => lecture.number),
  })
}
