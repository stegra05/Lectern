/**
 * Offline retry-behavior tests for the GeminiClient transport: network-level
 * failures are retried with backoff, non-retryable client errors surface
 * immediately, and aborts propagate without retrying.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GeminiClient, GeminiError, type RetryNotice } from './gemini'

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

/** A 429 body, optionally naming the quota window Google reports. */
const rateLimited = (message = 'Resource has been exhausted', headers: HeadersInit = {}) =>
  new Response(JSON.stringify({ error: { message, status: 'RESOURCE_EXHAUSTED' } }), {
    status: 429,
    headers,
  })

describe('GeminiClient rate-limit visibility', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('announces every wait instead of stalling silently', async () => {
    const notices: RetryNotice[] = []
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rateLimited('quota exceeded', { 'retry-after': '30' }))
      .mockResolvedValueOnce(okInteraction())
    const client = new GeminiClient('key', fetchFn, undefined, (n) => notices.push(n))

    const promise = client.interact({ model: 'm', input: 'hello' })
    await vi.advanceTimersByTimeAsync(60_000)
    await promise

    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ status: 429, attempt: 1, waitMs: 30_000 })
    expect(notices[0].message).toBe('Gemini rate limit reached — waiting 30s (retry 1 of 5).')
  })

  it('honors the server’s retry-after over its own backoff', async () => {
    const notices: RetryNotice[] = []
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rateLimited('slow down', { 'retry-after': '90' }))
      .mockResolvedValueOnce(okInteraction())
    const client = new GeminiClient('key', fetchFn, undefined, (n) => notices.push(n))

    const promise = client.interact({ model: 'm', input: 'hello' })
    await vi.advanceTimersByTimeAsync(120_000)
    await promise

    expect(notices[0].waitMs).toBe(90_000)
    expect(notices[0].message).toContain('waiting 1m 30s')
  })

  it('stops promising a retry once it has run out of them', async () => {
    // A fresh Response per call: a body can only be read once.
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => rateLimited())
    const client = new GeminiClient('key', fetchFn)

    // Catch first, then let the clock run, or the rejection goes unhandled.
    const settled = client.interact({ model: 'm', input: 'hello' }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(600_000)

    const error = await settled
    expect(error).toBeInstanceOf(GeminiError)
    expect((error as GeminiError).status).toBe(429)
    expect((error as GeminiError).userMessage).toContain('kept rate-limiting')
    // The initial attempt plus every retry.
    expect(fetchFn).toHaveBeenCalledTimes(6)
  })

  it('says plainly when a daily quota is spent, since waiting will not help', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        rateLimited('Quota exceeded for metric generate_requests_per_day, limit 250 PerDay'),
      )
    const client = new GeminiClient('key', fetchFn)

    const settled = client.interact({ model: 'm', input: 'hello' }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(600_000)

    const error = await settled
    expect(error).toBeInstanceOf(GeminiError)
    expect((error as GeminiError).userMessage).toContain('daily quota')
  })

  it('reports a dropped connection as its own kind of wait', async () => {
    const notices: RetryNotice[] = []
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okInteraction())
    const client = new GeminiClient('key', fetchFn, undefined, (n) => notices.push(n))

    const promise = client.interact({ model: 'm', input: 'hello' })
    await vi.advanceTimersByTimeAsync(10_000)
    await promise

    expect(notices[0]).toMatchObject({ status: 0 })
    expect(notices[0].message).toContain('Connection to Gemini dropped')
  })
})
