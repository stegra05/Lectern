/**
 * Deck-ledger persistence: one Tauri store file per deck in the app data dir
 * (same plugin and location as settings.json, so no extra fs permissions),
 * localStorage in plain-browser dev mode.
 *
 * Reads are tolerant — a missing or corrupt file is simply no ledger — with
 * one exception: a file written by a *newer* app version throws, so a
 * downgraded build can never overwrite data it does not understand. Writes
 * replace the whole record; merging happened in the engine.
 */

import { load } from '@tauri-apps/plugin-store'
import {
  isNewerLedgerVersion,
  ledgerStoreFile,
  parseDeckLedger,
  type DeckLedger,
} from '../engine/ledger'
import { IS_TAURI } from './platform'

const STORE_KEY = 'ledger'
const LS_PREFIX = 'lectern-'

export async function readDeckLedger(deckName: string): Promise<DeckLedger | null> {
  const file = ledgerStoreFile(deckName)
  let value: unknown
  try {
    if (!IS_TAURI) {
      const raw = localStorage.getItem(LS_PREFIX + file)
      value = raw === null ? null : JSON.parse(raw)
    } else {
      const store = await load(file, { autoSave: false, defaults: {} })
      value = await store.get(STORE_KEY)
    }
  } catch {
    return null
  }
  if (isNewerLedgerVersion(value)) {
    throw new Error('this deck’s ledger was written by a newer version of Lectern — left untouched')
  }
  return parseDeckLedger(value)
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
