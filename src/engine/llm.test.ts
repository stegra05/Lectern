import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RATE_LIMIT_MAX_RETRIES } from './config'
import { LlmError, fromSdkError, withRetry, type LlmErrorKind } from './llm'
import type { RetryNotice } from './types'

/** Run withRetry over an attempt that always fails with `kind`. */
async function failingWith(kind: LlmErrorKind) {
  const attempt = vi.fn<() => Promise<never>>(() =>
    Promise.reject(new LlmError('x', 0, kind, 'openai')),
  )
  const notices: RetryNotice[] = []
  const result = withRetry(
    attempt,
    (e) => e as LlmError,
    (n) => notices.push(n),
  ).catch((e: unknown) => e)
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  return { error: await result, attempt, notices }
}

describe('withRetry', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('tries a timed-out request once more, then gives up', async () => {
    const { error, attempt, notices } = await failingWith('timeout')
    expect((error as LlmError).kind).toBe('timeout')
    expect(attempt).toHaveBeenCalledTimes(2)
    expect(notices).toEqual([
      expect.objectContaining({ kind: 'timeout', attempt: 1, maxAttempts: 1 }),
    ])
  })

  it('keeps retrying a dropped connection up to the usual limit', async () => {
    const { attempt, notices } = await failingWith('network')
    expect(attempt).toHaveBeenCalledTimes(RATE_LIMIT_MAX_RETRIES + 1)
    expect(notices).toHaveLength(RATE_LIMIT_MAX_RETRIES)
    for (const notice of notices) {
      expect(notice).toMatchObject({ kind: 'network', maxAttempts: RATE_LIMIT_MAX_RETRIES })
    }
  })
})

describe('fromSdkError', () => {
  class APIError extends Error {}
  class APIConnectionError extends APIError {}
  class APIConnectionTimeoutError extends APIConnectionError {}
  const sdk = { APIError, APIConnectionError, APIConnectionTimeoutError }
  const kindOf = (e: Error) => fromSdkError(e, 'openai', sdk, () => 'server').kind

  it('tells a timeout from a dropped connection', () => {
    expect(kindOf(new APIConnectionTimeoutError('Request timed out.'))).toBe('timeout')
    expect(kindOf(new APIConnectionError('Connection error.'))).toBe('network')
  })
})
