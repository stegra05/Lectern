/**
 * Builds the engine with everything it needs from outside: the folder of courses, the PDF
 * reader, the models, Anki and the note type files. The rest of the shell only ever calls `run`.
 */

import { writeFile } from 'node:fs/promises'

import { createEngine, type Engine } from '@lectern/engine'
import { ankiConnect } from '@lectern/engine/adapters/ankiconnect'
import { memoryAnki, type MemoryAnki } from '@lectern/engine/adapters/memory-anki'
import { nodeStore } from '@lectern/engine/adapters/node-store'
import { nodeTemplates } from '@lectern/engine/adapters/node-templates'
import { offlineDecisions, offlineModel } from '@lectern/engine/adapters/offline'
import { openaiDecisions, openaiModel } from '@lectern/engine/adapters/openai'
import { pdfjsReader } from '@lectern/engine/adapters/pdfjs'

export interface EngineOptions {
  /** The folder that holds one folder per course. */
  courses: string
  /** The folder with the note type files: the four templates and the stylesheet. */
  templates: string
  /** The student's OpenAI key, or null when none is stored yet. */
  key: string | null
  /** Run on the offline models: no key, no network, no cost. */
  fake: boolean
  /** How long each call of the offline models takes, so a run can be watched. */
  fakeDelayMs: number
  /** Offline only: a file the in-memory Anki writes its notes to on every change. */
  notesFile: string
}

// Offline, cards go to an Anki that lives in memory for as long as the app runs.
const offlineAnki = memoryAnki()

/** The in-memory Anki, writing its notes to a file whenever they change, for tests to read. */
function writingNotes(anki: MemoryAnki, file: string): MemoryAnki {
  const write = () => writeFile(file, JSON.stringify(anki.notes))
  return {
    ...anki,
    addNote: async (note) => {
      const id = await anki.addNote(note)
      await write()
      return id
    },
    updateNote: async (id, fields) => {
      await anki.updateNote(id, fields)
      await write()
    },
    deleteNotes: async (ids) => {
      await anki.deleteNotes(ids)
      await write()
    },
  }
}

export function engineFor({
  courses,
  templates,
  key,
  fake,
  fakeDelayMs,
  notesFile,
}: EngineOptions): Engine {
  return createEngine({
    store: nodeStore(courses),
    anki: fake ? writingNotes(offlineAnki, notesFile) : ankiConnect(),
    templates: nodeTemplates(templates),
    pdf: pdfjsReader,
    model: fake ? offlineModel(fakeDelayMs) : openaiModel(undefined, { apiKey: key ?? undefined }),
    decisions: fake ? offlineDecisions(fakeDelayMs) : openaiDecisions({ apiKey: key ?? undefined }),
    now: Date.now,
  })
}
