import { ankiNotOpen, EngineError } from '../errors.ts'
import type { AnkiPort, Note, NoteType } from '../ports.ts'

export interface MemoryAnki extends AnkiPort {
  /** False behaves like Anki being closed: every call fails. */
  open: boolean
  /** True makes every call take effect and then fail as a timeout does: Anki may still finish what it was asked. */
  answersLost: boolean
  readonly types: Map<string, NoteType>
  readonly decks: Set<string>
  /** File name to base64. */
  readonly media: Map<string, string>
  readonly notes: (Note & { id: number })[]
}

/**
 * An Anki that lives in memory and refuses what the real one refuses: a note for a note type,
 * a field or a deck it does not have. For tests, and for the app when it runs offline.
 */
export function memoryAnki(): MemoryAnki {
  const types = new Map<string, NoteType>()
  const decks = new Set<string>(['Default'])
  const media = new Map<string, string>()
  const notes: (Note & { id: number })[] = []
  let nextId = 1_700_000_000_000

  const typeOf = (name: string) => {
    const type = types.get(name)
    if (!type) throw new Error(`model was not found: ${name}`)
    return type
  }
  /** Every call answers like the add-on does: later, and not at all while Anki is closed. */
  const answer = <T>(work: () => T): Promise<T> =>
    anki.open
      ? Promise.resolve()
          .then(work)
          .then((result) => {
            if (anki.answersLost) {
              throw new EngineError(
                'Anki did not answer.',
                'Close any open window or dialog in Anki, then try again.',
              )
            }
            return result
          })
      : Promise.reject(ankiNotOpen())

  const anki: MemoryAnki = {
    open: true,
    answersLost: false,
    types,
    decks,
    media,
    notes,
    noteTypes: () => answer(() => [...types.keys()]),
    styling: (name) => answer(() => typeOf(name).css),
    createNoteType: (type) =>
      answer(() => {
        if (types.has(type.name)) throw new Error(`Model name already exists: ${type.name}`)
        types.set(type.name, { ...type })
      }),
    restyle: ({ name, css, template }) =>
      answer(() => {
        const type = typeOf(name)
        if (type.template.name !== template.name) throw new Error('template was not found')
        types.set(name, { ...type, css, template })
      }),
    deckNames: () => answer(() => [...decks]),
    createDeck: (name) =>
      answer(() => {
        // Anki creates the parents of a subdeck with it.
        name.split('::').forEach((_, i, parts) => decks.add(parts.slice(0, i + 1).join('::')))
      }),
    // As Anki 26 does: the file is written under its name in lowercase.
    storeMedia: (name, data) => answer(() => void media.set(name.toLowerCase(), data)),
    updateNote: (id, fields) =>
      answer(() => {
        const note = notes.find((n) => n.id === id)
        if (!note) throw new Error(`note was not found: ${id}`)
        const unknown = Object.keys(fields).filter((f) => !typeOf(note.noteType).fields.includes(f))
        if (unknown.length > 0) throw new Error(`fields were not found: ${unknown.join(', ')}`)
        note.fields = { ...note.fields, ...fields }
      }),
    deleteNotes: (ids) =>
      answer(() => {
        for (const id of ids) {
          const at = notes.findIndex((n) => n.id === id)
          if (at >= 0) notes.splice(at, 1)
        }
      }),
    existingNotes: (ids) => answer(() => ids.filter((id) => notes.some((note) => note.id === id))),
    taggedNotes: (tag) =>
      answer(() => notes.filter((note) => note.tags.includes(tag)).map((note) => note.id)),
    addNote: (note) =>
      answer(() => {
        const type = typeOf(note.noteType)
        if (!decks.has(note.deck)) throw new Error(`deck was not found: ${note.deck}`)
        const unknown = Object.keys(note.fields).filter((field) => !type.fields.includes(field))
        if (unknown.length > 0) throw new Error(`fields were not found: ${unknown.join(', ')}`)
        if (!note.fields[type.fields[0]!]) throw new Error('cannot create note because it is empty')
        const id = nextId++
        notes.push({ ...note, id })
        return id
      }),
  }
  return anki
}
