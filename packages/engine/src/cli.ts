#!/usr/bin/env node
/**
 * The engine from a command line.
 *
 *   node src/cli.ts estimate <course folder> [--goal pass|good|top] [--model gpt-6-luna]
 *   node src/cli.ts build <course folder> [--goal pass|good|top] [--profile concept|formula|programming|fact-heavy] [--model gpt-6-luna] [--cap dollars] [--preset placeholder|concept]
 *   node src/cli.ts outline <course folder>
 *   node src/cli.ts send <course folder> [--design native|structure|lamp|colours|afterglow|vitrine]
 *
 * `outline` prints the Markdown. Every other command prints its events as one JSON line each.
 * `build` spends money on the OpenAI account of `OPENAI_API_KEY`; the others do not.
 * `send` writes into the Anki that is open on this computer, through its AnkiConnect add-on.
 */

import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ankiConnect } from './adapters/ankiconnect.ts'
import { nodeDesigns } from './adapters/node-designs.ts'
import { nodeStore } from './adapters/node-store.ts'
import { openaiDecisions, openaiModel } from './adapters/openai.ts'
import { pdfjsReader } from './adapters/pdfjs.ts'
import { createEngine, EngineError } from './api.ts'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    goal: { type: 'string' },
    profile: { type: 'string' },
    model: { type: 'string' },
    cap: { type: 'string' },
    preset: { type: 'string' },
    design: { type: 'string' },
  },
})
const [type, folder] = positionals
if (!type || !['estimate', 'build', 'outline', 'send'].includes(type) || !folder) {
  console.error(
    'Usage: lectern-engine estimate|build|outline|send <course folder> [--goal pass|good|top] [--design native]',
  )
  process.exit(2)
}

const path = resolve(folder)
const command = {
  type,
  course: basename(path),
  ...(type === 'estimate' || type === 'build' ? { goal: values.goal } : {}),
  ...(type === 'send' ? { design: values.design ?? 'native' } : {}),
  ...(type === 'build'
    ? {
        profile: values.profile,
        preset: values.preset,
        capUsd: values.cap ? Number(values.cap) : undefined,
      }
    : {}),
}
try {
  const engine = createEngine({
    store: nodeStore(dirname(path)),
    pdf: pdfjsReader,
    model: openaiModel(values.model),
    decisions: openaiDecisions(),
    anki: ankiConnect(),
    designs: nodeDesigns(join(import.meta.dirname, '../../../design/v3/cards/anki')),
    now: Date.now,
  })
  await engine.run(command, (event) => {
    if (event.type === 'outline') process.stdout.write(event.markdown)
    else console.log(JSON.stringify(event))
    if (event.type === 'failed') process.exitCode = 1
  })
} catch (error) {
  // Only the choice of model can fail before the engine runs.
  const fix = error instanceof EngineError ? error.fix : 'Run the command again.'
  console.log(JSON.stringify({ type: 'failed', message: (error as Error).message, fix }))
  process.exitCode = 1
}
