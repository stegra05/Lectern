import { ask } from '@tauri-apps/plugin-dialog'
import type { Card } from '../engine/types'
import { IS_TAURI } from './platform'

/**
 * Yes/no confirmation before discarding work: native dialog in the Tauri
 * shell, window.confirm in plain-browser dev mode. Resolves true to proceed.
 */
export async function confirmDiscard(message: string, title: string): Promise<boolean> {
  if (!IS_TAURI) return window.confirm(message)
  return ask(message, { title, kind: 'warning' })
}

/**
 * Ask before throwing away cards that never reached Anki. Resolves true
 * straight away when there are none. `consequence` finishes the sentence,
 * e.g. "Leaving discards them."
 */
export async function confirmUnsentDiscard(
  cards: Card[],
  consequence: string,
  title: string,
): Promise<boolean> {
  const unsent = cards.filter((c) => !c.ankiNoteId).length
  if (unsent === 0) return true
  const counted = unsent === 1 ? "1 card hasn't" : `${unsent} cards haven't`
  return confirmDiscard(`${counted} been sent to Anki. ${consequence}`, title)
}
