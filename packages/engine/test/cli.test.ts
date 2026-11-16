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
  return run({ OPENAI_API_KEY: 'test' }, args)
}

async function run(env: Record<string, string>, args: string[]) {
  const result = await promisify(execFile)('node', [cli, ...args], {
    // Nothing is called that costs money or needs a key: these commands stop before.
    env: { ...process.env, ...env },
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
        unreadable: [],
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

  it('builds and sends a course on the offline models and an Anki in memory', async () => {
    await h.courseOf('01 Risk.pdf')
    // With the switch set no model and no Anki is constructed that could reach a network, so
    // neither a key nor a running Anki is needed: the key is removed to show it.
    const env = { LECTERN_FAKE: '1', OPENAI_API_KEY: '' }
    const built = await run(env, ['build', join(h.root, 'course')])
    expect(built.events.at(-1)).toMatchObject({ type: 'built' })
    expect(built.code).toBe(0)
    const sent = await run(env, ['send', join(h.root, 'course')])
    expect(sent.events.at(-1)).toEqual({
      type: 'sent',
      deck: expect.any(String) as string,
      cards: expect.any(Number) as number,
      lectures: [1],
    })
    expect((sent.events.at(-1) as { cards: number }).cards).toBeGreaterThan(0)
    expect(sent.code).toBe(0)
  })
})
