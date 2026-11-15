import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { Event } from '../src/api.ts'
import { pipeline } from './harness.ts'

const h = pipeline()
const cli = join(import.meta.dirname, '../src/cli.ts')

/** The command line on a course folder: its events as JSON lines, and the exit code. */
async function cliRun(...args: string[]) {
  const result = await promisify(execFile)('node', [cli, ...args], {
    // Nothing is called that costs money or needs a key: these commands stop before.
    env: { ...process.env, OPENAI_API_KEY: 'test' },
  }).catch((error: { code: number; stdout: string }) => error)
  const events = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Event)
  return { events, code: 'code' in result ? result.code : 0 }
}

describe('the command line', () => {
  it('prints the events of a command as JSON lines', async () => {
    await h.courseOf('01 Risk.pdf')
    const { events, code } = await cliRun('estimate', join(h.root, 'course'))
    expect(events).toEqual([
      {
        type: 'estimate',
        lectures: 1,
        slides: 5,
        cards: 5,
        costUsd: expect.any(Number) as number,
        costEur: expect.any(Number) as number,
        capUsd: 0.25,
      },
    ])
    expect(code).toBe(0)
  })

  it('prints the failure with its fix and exits with 1', async () => {
    await h.courseOf()
    const { events, code } = await cliRun('build', join(h.root, 'course'))
    expect(events.at(-1)).toEqual({
      type: 'failed',
      message: 'No PDF found in course/slides.',
      fix: 'Put one PDF per lecture into the slides folder of the course.',
    })
    expect(code).toBe(1)
  })
})
