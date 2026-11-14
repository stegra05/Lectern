#!/usr/bin/env node
/**
 * The engine from a command line.
 *
 *   node src/cli.ts build <course folder> [--goal pass|good|top]
 *   node src/cli.ts outline <course folder>
 *
 * `build` prints every event as one JSON line. `outline` prints the Markdown.
 */

import { basename, dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { anthropicModel } from './adapters/anthropic.ts'
import { nodeStore } from './adapters/node-store.ts'
import { pdfjsReader } from './adapters/pdfjs.ts'
import { createEngine } from './api.ts'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { goal: { type: 'string' } },
})
const [type, folder] = positionals
if ((type !== 'build' && type !== 'outline') || !folder) {
  console.error('Usage: lectern-engine build <course folder> [--goal pass|good|top]')
  console.error('       lectern-engine outline <course folder>')
  process.exit(2)
}

const path = resolve(folder)
const engine = createEngine({
  store: nodeStore(dirname(path)),
  pdf: pdfjsReader,
  model: anthropicModel(),
  now: Date.now,
})
await engine.run({ type, course: basename(path), goal: values.goal }, (event) => {
  if (event.type === 'outline') process.stdout.write(event.markdown)
  else console.log(JSON.stringify(event))
  if (event.type === 'failed') process.exitCode = 1
})
