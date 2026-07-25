/**
 * Desktop notification for the end of a run.
 *
 * A deck takes minutes, so people leave the window. The rule is one
 * notification per finished run, and only when the window is not in front —
 * if you are watching the cards land, you already know.
 *
 * Every failure path here is silent: a missing permission or an unavailable
 * notification service must never disturb a finished generation.
 */

import { IS_TAURI } from './platform'

/** Whether the Lectern window is the one the user is currently looking at. */
async function windowIsFocused(): Promise<boolean> {
  if (!IS_TAURI) return document.hasFocus()
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    return await getCurrentWindow().isFocused()
  } catch {
    // Fall back to the DOM's view, which is right often enough.
    return document.hasFocus()
  }
}

/** Ask once, and only when we actually have something to say. */
async function ensurePermission(): Promise<boolean> {
  const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification')
  if (await isPermissionGranted()) return true
  return (await requestPermission()) === 'granted'
}

/** Bounce the dock icon / flash the taskbar entry, where the OS supports it. */
async function requestAttention(): Promise<void> {
  if (!IS_TAURI) return
  try {
    const { getCurrentWindow, UserAttentionType } = await import('@tauri-apps/api/window')
    await getCurrentWindow().requestUserAttention(UserAttentionType.Informational)
  } catch {
    // Unsupported platform — the notification alone will do.
  }
}

/**
 * Announce a finished run. No-ops when the window is focused, when the user
 * turned notifications off, or when anything at all goes wrong.
 */
export async function notifyRunFinished(opts: {
  enabled: boolean
  title: string
  body: string
}): Promise<void> {
  if (!opts.enabled) return
  try {
    if (await windowIsFocused()) return

    if (!IS_TAURI) {
      // Browser dev mode: use the web API when it is already permitted.
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(opts.title, { body: opts.body })
      }
      return
    }

    if (!(await ensurePermission())) return
    const { sendNotification } = await import('@tauri-apps/plugin-notification')
    sendNotification({ title: opts.title, body: opts.body })
    await requestAttention()
  } catch {
    // Notifications are a courtesy; never let one surface as an error.
  }
}
