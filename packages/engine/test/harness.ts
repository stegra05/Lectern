import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import {
  scriptedDecisions,
  scriptedModel,
  type ScriptedDecisions,
  type ScriptedModel,
} from '../src/adapters/fake.ts'
import { memoryAnki } from '../src/adapters/memory-anki.ts'
import { nodeStore } from '../src/adapters/node-store.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import { createEngine, type CardFile, type Event } from '../src/api.ts'
import type { ModelPort, ModelRequest } from '../src/ports.ts'
import { decisions, script, SLIDES } from './fixtures.ts'
import { addSlides, tempRoot, templates } from './helpers.ts'

interface RunOptions {
  /** Dollars each model call is billed. */
  costPerCall?: number
  /** Dollars per million tokens of the writing model, for the estimate. */
  price?: ModelPort['price']
  /** Replaces the scripted writing model. */
  script?: (request: ModelRequest) => unknown
  /** Replaces the scripted decision model. */
  decide?: Parameters<typeof scriptedDecisions>[0]
}

/**
 * One course folder and the engine on the offline models. Each test file makes its own, so
 * that files run side by side and each builds a course once.
 */
export function pipeline() {
  let root = ''
  let model: ScriptedModel
  let decider: ScriptedDecisions

  const text = (path: string) => readFile(join(root, 'course', path), 'utf8')
  const json = async <T = unknown>(path: string) => JSON.parse(await text(path)) as T
  const cards = async (lecture: string) =>
    parse(await text(`lectures/${lecture}/cards.yaml`)) as CardFile[]

  return {
    get root() {
      return root
    },
    get model() {
      return model
    },
    get decider() {
      return decider
    },
    text,
    json,
    cards,
    card: async (lecture: string, id: string) => (await cards(lecture)).find((c) => c.id === id)!,
    /** The requests of one task the writing model got. */
    calls: (task: string) => model.requests.filter((r) => r.task === task),
    /** Matches the request that asks for one fact. */
    about: (fact: string) => (r: { prompt: string }) => r.prompt.includes(`Fact to test: ${fact}`),

    /** A course folder holding the given lectures of `SLIDES`. */
    courseOf: async (...files: string[]): Promise<void> => {
      root = await tempRoot()
      for (const file of files) await addSlides(root, file, SLIDES[file]!)
    },

    /** Runs one command against the course folder with a ticking clock. */
    run: async (command: unknown, options: RunOptions = {}): Promise<Event[]> => {
      model = scriptedModel(options.script ?? script, options.costPerCall)
      if (options.price) Object.assign(model, { price: options.price })
      decider = scriptedDecisions(options.decide ?? decisions)
      let clock = Date.UTC(2026, 10, 14)
      const ports = {
        store: nodeStore(root),
        pdf: pdfjsReader,
        model,
        decisions: decider,
        anki: memoryAnki(),
        templates,
        now: () => (clock += 1000),
      }
      const events: Event[] = []
      await createEngine(ports).run(command, (event) => events.push(event))
      return events
    },
  }
}
