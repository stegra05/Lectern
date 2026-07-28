/**
 * Deck-ledger persistence: one Tauri store file per deck in the app data dir
 * (same plugin and location as settings.json, so no extra fs permissions),
 * localStorage in plain-browser dev mode.
 *
 * Reads are tolerant — a missing, corrupt, or future-version file is simply
 * no ledger. Writes replace the whole record; merging happened in the engine.
 */

import { load } from '@tauri-apps/plugin-store'
import { ledgerStoreFile, parseDeckLedger, type DeckLedger } from '../engine/ledger'
import { IS_TAURI } from './platform'

const STORE_KEY = 'ledger'
const LS_PREFIX = 'lectern-'

export async function readDeckLedger(deckName: string): Promise<DeckLedger | null> {
  const file = ledgerStoreFile(deckName)
  try {
    if (!IS_TAURI) {
      const raw = localStorage.getItem(LS_PREFIX + file)
      return raw === null ? null : parseDeckLedger(JSON.parse(raw))
    }
    const store = await load(file, { autoSave: false, defaults: {} })
    return parseDeckLedger(await store.get(STORE_KEY))
  } catch {
    return null
  }
}

export async function writeDeckLedger(ledger: DeckLedger): Promise<void> {
  const file = ledgerStoreFile(ledger.deckName)
  if (!IS_TAURI) {
    localStorage.setItem(LS_PREFIX + file, JSON.stringify(ledger))
    return
  }
  const store = await load(file, { autoSave: false, defaults: {} })
  await store.set(STORE_KEY, ledger)
  await store.save()
}
