/**
 * What a student does to single cards: change one, remove one, write one of their own. Every
 * card goes through the same validator and the same assembly as the cards Lectern writes, and
 * a card that is already in Anki changes there too.
 */

import type { Emit } from './commands.ts'
import { assemble, type CardFile } from './cards/assemble.ts'
import { cardId } from './cards/id.ts'
import {
  blankSlots,
  checkSlots,
  FORM_LIMITS,
  OWN_ROLES,
  toDraft,
  toSlots,
  type Problem,
  type Slots,
} from './cards/slots.ts'
import { validateDraft } from './cards/validate.ts'
import {
  paths,
  readCards,
  readJson,
  writeCards,
  type Concept,
  type CourseFile,
  type Lecture,
} from './course.ts'
import { removeSent, updateSent } from './deliver.ts'
import { EngineError } from './errors.ts'
import type { Ports } from './ports.ts'
import { slideText } from './slides.ts'

interface Place {
  course: string
  lecture: number
}

async function open({ store }: Ports, { course, lecture }: Place) {
  const file = await readJson<CourseFile>(store, paths.course(course))
  const entry = file?.lectures.find((l) => l.number === lecture)
  const tree = entry && (await readJson<Lecture>(store, paths.lecture(course, lecture)))
  if (!entry || !tree) {
    throw new EngineError(
      `The course has no lecture ${lecture} with cards.`,
      'Open a lecture from the course.',
    )
  }
  return { entry, tree, cards: await readCards(store, course, lecture) }
}

function find(cards: CardFile[], id: string): number {
  const at = cards.findIndex((card) => card.id === id)
  if (at < 0) {
    throw new EngineError('This card is no longer in the lecture.', 'Open the lecture again.')
  }
  return at
}

function conceptOf(tree: Lecture, id: string): Concept {
  const concept = tree.topics.flatMap((topic) => topic.concepts).find((c) => c.id === id)
  if (!concept) {
    throw new EngineError('This concept is no longer in the lecture.', 'Open the lecture again.')
  }
  return concept
}

/** The slots of a card, or empty slots for a card the student is about to write. */
export async function slots(
  ports: Ports,
  command: Place & { card?: string | undefined; role?: (typeof OWN_ROLES)[number] | undefined },
  emit: Emit,
): Promise<void> {
  if (command.card === undefined) {
    return emit({
      type: 'slots',
      slots: blankSlots(command.role ?? 'definition'),
      limits: FORM_LIMITS,
    })
  }
  const { cards } = await open(ports, command)
  const card = cards[find(cards, command.card)]!
  emit({ type: 'slots', card: card.id, slots: toSlots(card), limits: FORM_LIMITS })
}

/**
 * The card built from the slots, or what the student has to fix first. The validator's own
 * words are written for the model, so the form's checks come first and say it for a student;
 * whatever only the validator finds is passed on as it is.
 */
async function build(
  { store, pdf }: Ports,
  place: Place,
  file: string,
  tree: Lecture,
  concept: Concept,
  card: { id: string; slide: number; own?: true },
  filled: Slots,
): Promise<CardFile | Problem[]> {
  const problems = checkSlots(filled)
  if (problems.length > 0) return problems
  const text = await slideText(pdf, await store.readBytes(`${paths.slides(place.course)}/${file}`))
  const draft = toDraft(filled, { concept: concept.name, slide: card.slide })
  const refused = validateDraft(draft, {
    slides: [...new Set([...concept.slides, card.slide])],
    slideText: (slide) => text[slide - 1]?.join('\n'),
    // The student may write what the slide only shows, so the slide's text settles nothing.
    seenAsImage: () => true,
  })
  if (refused.length > 0) {
    return refused.map((problem) => ({
      field: 'card' as const,
      message: `${problem.charAt(0).toUpperCase()}${problem.slice(1)}.`,
    }))
  }
  const built = assemble(draft, {
    id: card.id,
    lecture: { number: tree.number, title: tree.title },
    concept: { id: concept.id, name: concept.name },
    slideLines: text[card.slide - 1] ?? [],
  })
  if (card.own) built.own = true
  return built
}

/** Changes the wording of a card. Its id, its slide and its place in the lecture stay. */
export async function edit(
  ports: Ports,
  command: Place & { card: string; slots: Slots },
  emit: Emit,
): Promise<void> {
  const { entry, tree, cards } = await open(ports, command)
  const at = find(cards, command.card)
  const old = cards[at]!
  if (command.slots.role !== old.fields.Role) {
    throw new EngineError('A card keeps its kind.', 'Remove the card and write a new one.')
  }
  const concept = conceptOf(tree, old.concept)
  const card = await build(ports, command, entry.file, tree, concept, old, command.slots)
  if (Array.isArray(card)) return emit({ type: 'refused', problems: card })
  // A past-exam card keeps what the exams and its slides gave it, whatever the new wording.
  if (old.fields.Asked) {
    for (const name of ['Asked', 'Source', 'Slide', 'Excerpt'])
      card.fields[name] = old.fields[name]!
  }
  // Anki first: when it is closed nothing changes, here or there.
  await updateSent(ports, command.course, card)
  cards[at] = card
  await writeCards(ports.store, command.course, command.lecture, cards)
  emit({ type: 'edited', card })
}

/** Removes a card from the lecture, and from Anki when it is there. */
export async function remove(
  ports: Ports,
  command: Place & { card: string },
  emit: Emit,
): Promise<void> {
  const { cards } = await open(ports, command)
  const at = find(cards, command.card)
  await removeSent(ports, command.course, command.card)
  cards.splice(at, 1)
  await writeCards(ports.store, command.course, command.lecture, cards)
  emit({ type: 'removed', card: command.card })
}

/** A card of the student's own, on a concept of the lecture. It goes to Anki with the next send. */
export async function write(
  ports: Ports,
  command: Place & { concept: string; slots: Slots },
  emit: Emit,
): Promise<void> {
  const { role } = command.slots
  if (!(OWN_ROLES as readonly string[]).includes(role)) {
    throw new EngineError(
      'A card of your own is a question with its answer, or a sentence with gaps.',
      'Choose one of the two kinds.',
    )
  }
  const { entry, tree, cards } = await open(ports, command)
  const concept = conceptOf(tree, command.concept)
  // A number no card of this concept and kind has had, so an id is never used twice.
  const stem = cardId(tree.number, concept.id, role, 0).slice(0, -1)
  const taken = cards
    .filter((card) => card.id.startsWith(stem))
    .map((card) => Number(card.id.slice(stem.length)))
    .filter(Number.isInteger)
  const id = `${stem}${Math.max(0, ...taken) + 1}`
  const slide = concept.slides[0] ?? 1
  const card = await build(
    ports,
    command,
    entry.file,
    tree,
    concept,
    { id, slide, own: true },
    command.slots,
  )
  if (Array.isArray(card)) return emit({ type: 'refused', problems: card })
  await writeCards(ports.store, command.course, command.lecture, [...cards, card])
  emit({ type: 'written', card })
}
