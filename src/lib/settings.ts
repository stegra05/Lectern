/**
 * User settings (Tauri store plugin, JSON in app data dir) and the Gemini API
 * key (OS keychain via Rust commands — same entry the original Lectern used,
 * so existing keys carry over).
 *
 * In plain-browser dev mode both fall back to localStorage.
 */

import { invoke } from '@tauri-apps/api/core'
import { load, type Store } from '@tauri-apps/plugin-store'
import { DEFAULT_SETTINGS } from '../engine/config'
import type { Settings } from '../engine/types'
import { IS_TAURI } from './platform'

const STORE_FILE = 'settings.json'
const LS_SETTINGS = 'lectern-settings'
const LS_DEV_KEY = 'lectern-dev-api-key'

let storePromise: Promise<Store> | null = null

function getStore(): Promise<Store> {
  storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} })
  return storePromise
}

export async function loadSettings(): Promise<Settings> {
  if (!IS_TAURI) {
    const raw = localStorage.getItem(LS_SETTINGS)
    return { ...DEFAULT_SETTINGS, ...(raw ? (JSON.parse(raw) as Partial<Settings>) : {}) }
  }
  const store = await getStore()
  const saved = (await store.get<Partial<Settings>>('settings')) ?? {}
  return { ...DEFAULT_SETTINGS, ...saved }
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (!IS_TAURI) {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings))
    return
  }
  const store = await getStore()
  await store.set('settings', settings)
}

// --- API key (never in the JSON store) --------------------------------------

export async function getApiKey(): Promise<string | null> {
  if (!IS_TAURI) return localStorage.getItem(LS_DEV_KEY)
  return invoke<string | null>('keychain_get')
}

export async function setApiKey(value: string): Promise<void> {
  if (!IS_TAURI) {
    localStorage.setItem(LS_DEV_KEY, value)
    return
  }
  await invoke('keychain_set', { value })
}

export async function deleteApiKey(): Promise<void> {
  if (!IS_TAURI) {
    localStorage.removeItem(LS_DEV_KEY)
    return
  }
  await invoke('keychain_delete')
}
