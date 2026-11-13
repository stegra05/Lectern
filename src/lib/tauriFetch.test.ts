/**
 * The Tauri fetch, driven by a stand-in for the HTTP plugin that cancels the
 * way the real one does (src/commands.rs in tauri-plugin-http): an aborted
 * request rejects with a plain "Request canceled", not an AbortError.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { OPENAI_REQUEST_TIMEOUT_MS } from '../engine/config'
import { LlmError } from '../engine/llm'
import { OpenAIClient } from '../engine/openai'
import { tauriFetch } from './tauriFetch'

const plugin = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }))
vi.mock('@tauri-apps/plugin-http', () => plugin)
vi.mock('./platform', () => ({ IS_TAURI: true }))

const hangUntilCanceled: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('Request canceled')))
  })

describe('tauriFetch', () => {
  afterEach(() => {
    vi.useRealTimers()
    plugin.fetch.mockReset()
  })

  it('lets the OpenAI client tell its own timeout from a dropped connection', async () => {
    vi.useFakeTimers()
    plugin.fetch.mockImplementation(hangUntilCanceled)
    const client = new OpenAIClient('key', tauriFetch)
    const result = client
      .turn({ model: 'gpt-6-luna', input: [{ type: 'text', text: 'x' }] })
      .catch((e: unknown) => e)

    await vi.advanceTimersByTimeAsync(2 * OPENAI_REQUEST_TIMEOUT_MS + 10_000)
    expect(((await result) as LlmError).kind).toBe('timeout')
  })

  it('passes other failures through as they are', async () => {
    const failure = new Error('error sending request')
    plugin.fetch.mockRejectedValue(failure)
    await expect(tauriFetch('https://example.com')).rejects.toBe(failure)
  })
})
