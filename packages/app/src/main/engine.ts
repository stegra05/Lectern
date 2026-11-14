/**
 * Builds the engine with everything it needs from outside: the folder of courses, the PDF
 * reader and the models. The rest of the shell only ever calls `run`.
 */

import { createEngine, type Engine } from '@lectern/engine'
import { nodeStore } from '@lectern/engine/adapters/node-store'
import { offlineDecisions, offlineModel } from '@lectern/engine/adapters/offline'
import { openaiDecisions, openaiModel } from '@lectern/engine/adapters/openai'
import { pdfjsReader } from '@lectern/engine/adapters/pdfjs'

export interface EngineOptions {
  /** The folder that holds one folder per course. */
  courses: string
  /** The student's OpenAI key, or null when none is stored yet. */
  key: string | null
  /** Run on the offline models: no key, no network, no cost. */
  fake: boolean
  /** How long each call of the offline models takes, so a run can be watched. */
  fakeDelayMs: number
}

export function engineFor({ courses, key, fake, fakeDelayMs }: EngineOptions): Engine {
  return createEngine({
    store: nodeStore(courses),
    pdf: pdfjsReader,
    model: fake ? offlineModel(fakeDelayMs) : openaiModel(undefined, { apiKey: key ?? undefined }),
    decisions: fake ? offlineDecisions(fakeDelayMs) : openaiDecisions({ apiKey: key ?? undefined }),
    now: Date.now,
  })
}
