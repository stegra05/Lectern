/**
 * Calibration-log persistence: one Tauri store file in the app data dir
 * (same plugin and location as settings.json), localStorage in plain-browser
 * dev mode. Same tolerant pattern as ledgerStore: a missing or corrupt file
 * is simply no history, and writes replace the whole record.
 */

import { load } from '@tauri-apps/plugin-store'
import { parseCalibrationLog, type CalibrationLog } from '../engine/calibration'
import { IS_TAURI } from './platform'

const FILE = 'calibration.json'
const STORE_KEY = 'calibration'
const LS_KEY = 'lectern-calibration'

export async function readCalibrationLog(): Promise<CalibrationLog | null> {
  try {
    let value: unknown
    if (!IS_TAURI) {
      const raw = localStorage.getItem(LS_KEY)
      value = raw === null ? null : JSON.parse(raw)
    } else {
      const store = await load(FILE, { autoSave: false, defaults: {} })
      value = await store.get(STORE_KEY)
    }
    return parseCalibrationLog(value)
  } catch {
    return null
  }
}

export async function writeCalibrationLog(log: CalibrationLog): Promise<void> {
  if (!IS_TAURI) {
    localStorage.setItem(LS_KEY, JSON.stringify(log))
    return
  }
  const store = await load(FILE, { autoSave: false, defaults: {} })
  await store.set(STORE_KEY, log)
  await store.save()
}
