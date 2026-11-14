#!/usr/bin/env node
/**
 * The engine from a command line.
 *
 *   node src/cli.ts estimate <course folder> [--goal pass|good|top] [--model gpt-6-luna]
 *   node src/cli.ts build <course folder> [--goal pass|good|top] [--profile concept|formula|programming|fact-heavy] [--model gpt-6-luna] [--cap dollars]
 *   node src/cli.ts outline <course folder>
 *
 * `estimate` and `build` print every event as one JSON line. `outline` prints the Markdown.
 * `build` spends money on the OpenAI account of `OPENAI_API_KEY`; `estimate` does not.
 */

import { basename, dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
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
  },
})
const [type, folder] = positionals
if (!type || !['estimate', 'build', 'outline'].includes(type) || !folder) {
  console.error(
    'Usage: lectern-engine estimate|build|outline <course folder> [--goal pass|good|top]',
  )
  process.exit(2)
}

const path = resolve(folder)
const command = {
  type,
  course: basename(path),
  ...(type === 'outline' ? {} : { goal: values.goal }),
  ...(type === 'build'
    ? { profile: values.profile, capUsd: values.cap ? Number(values.cap) : undefined }
    : {}),
}
try {
  const engine = createEngine({
    store: nodeStore(dirname(path)),
    pdf: pdfjsReader,
    model: openaiModel(values.model),
    decisions: openaiDecisions(),
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
