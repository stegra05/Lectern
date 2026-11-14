/**
 * What the shell keeps for the student outside any course: the chosen card design and the API
 * key. The key is encrypted with the system's protected storage and never leaves this process.
 */

import { safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DESIGNS, type Design, type KeyResult, type Settings } from '../shared/contract.ts'

export interface SettingsStore {
  get(): Promise<Settings>
  setDesign(design: Design): Promise<Settings>
  /** The key for the provider, or null when none is stored. */
  key(): Promise<string | null>
  saveKey(key: string): Promise<KeyResult>
}

async function readOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}

/**
 * `dir` is the app's own data folder. With `fake` the app runs on the offline models, so a
 * key is neither checked nor stored.
 */
export function settingsStore(dir: string, fake: boolean): SettingsStore {
  const settingsPath = join(dir, 'settings.json')
  const keyPath = join(dir, 'openai.key')

  async function design(): Promise<Design> {
    const text = await readOrNull(settingsPath)
    const stored = text ? (JSON.parse(text.toString()) as { design?: string }).design : undefined
    return DESIGNS.find((d) => d === stored) ?? 'native'
  }

  async function key(): Promise<string | null> {
    // A key in the environment wins, so a developer can run the app without storing one.
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
    const sealed = await readOrNull(keyPath)
    return sealed ? safeStorage.decryptString(sealed) : null
  }

  // With the offline models there is nothing to protect, so the key is only remembered while
  // the app runs. The first run screen still works, and no keychain prompt interrupts a test.
  let fakeKey = false

  async function get(): Promise<Settings> {
    const hasKey = fake ? fakeKey : (await key()) !== null
    return { provider: 'openai', hasKey, design: await design() }
  }

  return {
    get,
    key,
    async setDesign(next) {
      await mkdir(dir, { recursive: true })
      await writeFile(settingsPath, `${JSON.stringify({ design: next }, null, 2)}\n`)
      return get()
    },
    async saveKey(candidate) {
      const trimmed = candidate.trim()
      if (!trimmed) {
        return {
          ok: false,
          message: 'There is no key yet.',
          fix: 'Paste your OpenAI key into the field.',
        }
      }
      if (fake) {
        fakeKey = true
        return { ok: true }
      }
      const problem = await checkKey(trimmed)
      if (problem) return problem
      if (!safeStorage.isEncryptionAvailable()) {
        return {
          ok: false,
          message: 'This computer cannot protect the key.',
          fix: 'Unlock your system keychain or password store, then save the key again.',
        }
      }
      await mkdir(dir, { recursive: true })
      await writeFile(keyPath, safeStorage.encryptString(trimmed))
      return { ok: true }
    },
  }
}

/** Asks OpenAI for its model list, which costs nothing. Null when the key works. */
async function checkKey(key: string): Promise<KeyResult | null> {
  let response: Response
  try {
    response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    })
  } catch {
    return {
      ok: false,
      message: 'Lectern could not reach OpenAI.',
      fix: 'Check your internet connection, then save the key again.',
    }
  }
  if (response.ok) return null
  if (response.status === 401) {
    return {
      ok: false,
      message: 'OpenAI did not accept this key.',
      fix: 'Copy the whole key again from platform.openai.com. It starts with sk-.',
    }
  }
  return {
    ok: false,
    message: `OpenAI answered with an error (${response.status}).`,
    fix: 'Wait a minute, then save the key again.',
  }
}
