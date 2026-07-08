import { ask } from '@tauri-apps/plugin-dialog'
import { IS_TAURI } from './platform'

/**
 * Yes/no confirmation before discarding work — native dialog in the Tauri
 * shell, window.confirm in plain-browser dev mode. Resolves true to proceed.
 */
export async function confirmDiscard(message: string, title: string): Promise<boolean> {
  if (!IS_TAURI) return window.confirm(message)
  return ask(message, { title, kind: 'warning' })
}
