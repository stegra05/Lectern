import { ankiNotOpen, EngineError } from '../errors.ts'
import type { AnkiPort } from '../ports.ts'

/** Long enough for a slide picture to be stored, short enough to notice a dialog blocking Anki. */
const TIMEOUT_MS = 30_000

/** Anki through its AnkiConnect add-on, which listens on this computer only. */
export function ankiConnect(url = 'http://127.0.0.1:8765'): AnkiPort {
  async function call(action: string, params?: Record<string, unknown>): Promise<unknown> {
    let reply: { result: unknown; error: string | null }
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: JSON.stringify({ action, version: 6, ...(params ? { params } : {}) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      reply = (await response.json()) as typeof reply
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new EngineError(
          'Anki did not answer.',
          'Close any open window or dialog in Anki, then try again.',
        )
      }
      throw ankiNotOpen()
    }
    if (reply.error !== null) {
      throw new EngineError(
        `Anki could not finish a step: ${reply.error.replace(/\.$/, '')}.`,
        'Check Anki for a message, then try again.',
      )
    }
    return reply.result
  }

  return {
    noteTypes: async () => (await call('modelNames')) as string[],
    styling: async (noteType) =>
      ((await call('modelStyling', { modelName: noteType })) as { css: string }).css,
    async createNoteType({ name, cloze, fields, css, template }) {
      await call('createModel', {
        modelName: name,
        inOrderFields: fields,
        css,
        isCloze: cloze,
        cardTemplates: [{ Name: template.name, Front: template.front, Back: template.back }],
      })
    },
    async restyle({ name, css, template }) {
      // Templates before the stylesheet: the first line of the stylesheet says the note type
      // is Lectern's, so it is written last and a step that fails in between is done again.
      await call('updateModelTemplates', {
        model: {
          name,
          templates: { [template.name]: { Front: template.front, Back: template.back } },
        },
      })
      await call('updateModelStyling', { model: { name, css } })
    },
    deckNames: async () => (await call('deckNames')) as string[],
    async createDeck(name) {
      await call('createDeck', { deck: name })
    },
    async storeMedia(name, data) {
      await call('storeMediaFile', { filename: name, data })
    },
    async updateNote(id, fields) {
      await call('updateNoteFields', { note: { id, fields } })
    },
    async deleteNotes(ids) {
      await call('deleteNotes', { notes: ids })
    },
    existingNotes: async (ids) =>
      ids.length === 0
        ? []
        : ((await call('findNotes', { query: `nid:${ids.join(',')}` })) as number[]),
    addNote: async ({ deck, noteType, fields, tags }) =>
      (await call('addNote', {
        // Anki refuses a note whose first field it already has. Two courses may ask the same
        // question, and Lectern keeps its own record of what it sent.
        note: {
          deckName: deck,
          modelName: noteType,
          fields,
          tags,
          options: { allowDuplicate: true },
        },
      })) as number,
  }
}
