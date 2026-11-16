import { describe, expect, it } from 'vitest'
import { inAppWords } from './words.ts'

describe('the engine failures in the app', () => {
  const failed = {
    type: 'failed',
    message: 'OpenAI rejected the API key.',
    fix: 'Check the key in OPENAI_API_KEY.',
  } as const

  it('points a rejected key to Settings', () => {
    expect(inAppWords({ ...failed, reason: 'key' })).toEqual({
      type: 'failed',
      message: failed.message,
      fix: 'Check your OpenAI key in Settings, then try again.',
      reason: 'key',
    })
  })

  it('leaves every other failure as the engine worded it', () => {
    expect(inAppWords({ ...failed, reason: 'credit' })).toEqual({ ...failed, reason: 'credit' })
    expect(inAppWords(failed)).toEqual(failed)
  })
})
