/**
 * Offline retry-behavior tests for the GeminiClient transport: network-level
 * failures are retried with backoff, non-retryable client errors surface
 * immediately, and aborts propagate without retrying.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GeminiClient } from './gemini'
import { LlmError } from './llm'
import type { RetryNotice } from './types'

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

    const promise = client.turn({ model: 'm', input: [{ type: 'text', text: 'hello' }] })
    await vi.advanceTimersByTimeAsync(10_000)

    expect((await promise).conversation).toEqual({ provider: 'gemini', interactionId: 'i-1' })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-retryable client error', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 403 }),
      )
    const client = new GeminiClient('key', fetchFn)

    await expect(
      client.turn({ model: 'm', input: [{ type: 'text', text: 'hello' }] }),
    ).rejects.toMatchObject({
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
      client.turn({
        model: 'm',
        input: [{ type: 'text', text: 'hello' }],
        signal: controller.signal,
      }),
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

    await expect(client.uploadPdf(new Uint8Array([1]), 'a.pdf')).rejects.toBeInstanceOf(LlmError)
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
    const client = new GeminiClient('key', fetchFn, (n) => notices.push(n))

    const promise = client.turn({ model: 'm', input: [{ type: 'text', text: 'hello' }] })
    await vi.advanceTimersByTimeAsync(60_000)
    await promise

    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ status: 429, attempt: 1, waitMs: 30_000 })
  })

  it('honors the server’s retry-after over its own backoff', async () => {
    const notices: RetryNotice[] = []
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rateLimited('slow down', { 'retry-after': '90' }))
      .mockResolvedValueOnce(okInteraction())
    const client = new GeminiClient('key', fetchFn, (n) => notices.push(n))

    const promise = client.turn({ model: 'm', input: [{ type: 'text', text: 'hello' }] })
    await vi.advanceTimersByTimeAsync(120_000)
    await promise

    expect(notices[0].waitMs).toBe(90_000)
  })

  it('stops promising a retry once it has run out of them', async () => {
    // A fresh Response per call: a body can only be read once.
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => rateLimited())
    const client = new GeminiClient('key', fetchFn)

    // Catch first, then let the clock run, or the rejection goes unhandled.
    const settled = client
      .turn({ model: 'm', input: [{ type: 'text', text: 'hello' }] })
      .catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(600_000)

    const error = await settled
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).status).toBe(429)
    expect((error as LlmError).kind).toBe('rate_limited')
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

    const settled = client
      .turn({ model: 'm', input: [{ type: 'text', text: 'hello' }] })
      .catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(600_000)

    const error = await settled
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).kind).toBe('quota_daily')
    // Asked once: a retry would only have made the student wait for this.
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('knows a malformed key when Gemini reports it as a bad request', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: 'API key not valid. Please pass a valid API key.',
            status: 'INVALID_ARGUMENT',
          },
        }),
        { status: 400 },
      ),
    )
    const client = new GeminiClient('key', fetchFn)

    const error = await client
      .turn({ model: 'm', input: [{ type: 'text', text: 'hello' }] })
      .catch((e: unknown) => e)
    expect((error as LlmError).kind).toBe('key_rejected')
  })

  it('reports a dropped connection as its own kind of wait', async () => {
    const notices: RetryNotice[] = []
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okInteraction())
    const client = new GeminiClient('key', fetchFn, (n) => notices.push(n))

    const promise = client.turn({ model: 'm', input: [{ type: 'text', text: 'hello' }] })
    await vi.advanceTimersByTimeAsync(10_000)
    await promise

    expect(notices[0]).toMatchObject({ status: 0 })
  })
})

describe('GeminiClient.deleteDocument', () => {
  it('deletes by the file name inside the uri, and takes a 404 as already gone', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
    const client = new GeminiClient('key', fetchFn)
    const document = {
      id: 'https://generativelanguage.googleapis.com/v1beta/files/abc123',
      mimeType: 'application/pdf',
    }

    await client.deleteDocument(document)
    await client.deleteDocument(document)

    expect(fetchFn.mock.calls[0][0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/files/abc123',
    )
    expect(fetchFn.mock.calls[0][1]?.method).toBe('DELETE')
  })
})
