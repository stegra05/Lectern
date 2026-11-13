/**
 * User settings (Tauri store plugin, JSON in app data dir) and one API key
 * per provider (OS keychain via Rust commands; Gemini's is the entry the
 * original Lectern used, so existing keys carry over).
 *
 * In plain-browser dev mode both fall back to localStorage.
 */

import { invoke } from '@tauri-apps/api/core'
import { load, type Store } from '@tauri-apps/plugin-store'
import {
  DEFAULT_MODEL,
  DEFAULT_SETTINGS,
  MODEL_CHOICES,
  MODEL_MIGRATIONS,
  type ProviderId,
} from '../engine/config'
import type { Settings } from '../engine/types'
import { IS_TAURI } from './platform'

const STORE_FILE = 'settings.json'
const LS_SETTINGS = 'lectern-settings'
const devKeyName = (provider: ProviderId) => `lectern-dev-${provider}-key`

let storePromise: Promise<Store> | null = null

function getStore(): Promise<Store> {
  storePromise ??= load(STORE_FILE, { autoSave: true, defaults: {} })
  return storePromise
}

/** Carry a saved model id forward to the one that replaced it. A saved value
 *  the picker no longer offers cannot be corrected from the UI, so anything
 *  unrecognized falls back to the default rather than being sent to the API. */
export function migrateModel(model: string | undefined): string {
  if (!model) return DEFAULT_MODEL
  const mapped = MODEL_MIGRATIONS[model] ?? model
  return MODEL_CHOICES.some((m) => m.id === mapped) ? mapped : DEFAULT_MODEL
}

function withMigrations(saved: Partial<Settings>): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...saved }
  return { ...merged, model: migrateModel(merged.model) }
}

export async function loadSettings(): Promise<Settings> {
  if (!IS_TAURI) {
    const raw = localStorage.getItem(LS_SETTINGS)
    return withMigrations(raw ? (JSON.parse(raw) as Partial<Settings>) : {})
  }
  const store = await getStore()
  const saved = (await store.get<Partial<Settings>>('settings')) ?? {}
  return withMigrations(saved)
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (!IS_TAURI) {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings))
    return
  }
  const store = await getStore()
  await store.set('settings', settings)
}

// --- API keys (never in the JSON store) -------------------------------------

export async function getApiKey(provider: ProviderId): Promise<string | null> {
  if (!IS_TAURI) return localStorage.getItem(devKeyName(provider))
  return invoke<string | null>('keychain_get', { provider })
}

export async function setApiKey(provider: ProviderId, value: string): Promise<void> {
  if (!IS_TAURI) {
    localStorage.setItem(devKeyName(provider), value)
    return
  }
  await invoke('keychain_set', { provider, value })
}

export async function deleteApiKey(provider: ProviderId): Promise<void> {
  if (!IS_TAURI) {
    localStorage.removeItem(devKeyName(provider))
    return
  }
  await invoke('keychain_delete', { provider })
}
