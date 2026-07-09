/**
 * Offline retry-behavior tests for the GeminiClient transport: network-level
 * failures are retried with backoff, non-retryable client errors surface
 * immediately, and aborts propagate without retrying.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GeminiClient, GeminiError } from './gemini'

const okInteraction = () =>
  new Response(JSON.stringify({ id: 'i-1', steps: [], output_text: 'ok', usage: {} }), {
    status: 200,
  })

describe('GeminiClient retry behavior', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('retries a network-level failure and succeeds on the next attempt', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okInteraction())
    const client = new GeminiClient('key', fetchFn)

    const promise = client.interact({ model: 'm', input: 'hello' })
    await vi.advanceTimersByTimeAsync(10_000)

    expect((await promise).id).toBe('i-1')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-retryable client error', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 403 }),
      )
    const client = new GeminiClient('key', fetchFn)

    await expect(client.interact({ model: 'm', input: 'hello' })).rejects.toMatchObject({
      status: 403,
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('propagates aborts immediately', async () => {
    const controller = new AbortController()
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(() => {
      controller.abort()
      return Promise.reject(new DOMException('aborted', 'AbortError'))
    })
    const client = new GeminiClient('key', fetchFn)

    await expect(
      client.interact({ model: 'm', input: 'hello', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('does not retry uploads that fail with a non-retryable client error', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }),
      )
    const client = new GeminiClient('key', fetchFn)

    await expect(client.uploadPdf(new Uint8Array([1]), 'a.pdf')).rejects.toBeInstanceOf(GeminiError)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
