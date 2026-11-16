import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(text),
  decryptString: (data: Buffer) => data.toString(),
}
vi.mock('electron', () => ({ safeStorage }))

const { settingsStore } = await import('./settings.ts')

beforeEach(() => {
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, status: 200 }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  safeStorage.encryptString = (text) => Buffer.from(text)
})

describe('saving the key', () => {
  it('stores a key that works', async () => {
    const store = settingsStore(await mkdtemp(join(tmpdir(), 'lectern-key-')), false)
    expect(await store.saveKey('sk-test')).toEqual({ ok: true })
    expect(await store.key()).toBe('sk-test')
  })

  it('answers with a message and a fix when the key cannot be stored', async () => {
    safeStorage.encryptString = () => {
      throw new Error('The keychain refused.')
    }
    const store = settingsStore(await mkdtemp(join(tmpdir(), 'lectern-key-')), false)
    const result = await store.saveKey('sk-test')
    expect(result).toMatchObject({
      ok: false,
      message: 'Lectern could not store the key on this computer.',
    })
  })

  it('answers with a message and a fix when the data folder cannot be written', async () => {
    const store = settingsStore('/dev/null/lectern', false)
    expect((await store.saveKey('sk-test')).ok).toBe(false)
  })

  it('gives up on a network that never answers', async () => {
    // The timeout is the platform's own, so the test makes it fire at once and checks its length.
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort())
    vi.stubGlobal(
      'fetch',
      (_: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (init.signal?.aborted) reject(new Error('aborted'))
        }),
    )
    const store = settingsStore(await mkdtemp(join(tmpdir(), 'lectern-key-')), false)
    expect(await store.saveKey('sk-test')).toMatchObject({
      ok: false,
      message: 'Lectern could not reach OpenAI.',
    })
    expect(timeout).toHaveBeenCalledWith(15_000)
    timeout.mockRestore()
  })
})
