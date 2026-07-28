import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { IS_TAURI } from './platform'

export type SaveOutcome = 'saved' | 'cancelled' | 'failed'

/**
 * Save text as a file: OS save dialog in the app, a plain download in browser
 * dev mode (where the Tauri plugins aren't there to call). The browser path
 * has no cancel signal — the download just lands — so it only reports
 * 'saved' or 'failed'.
 */
export async function saveTextFile(defaultName: string, text: string): Promise<SaveOutcome> {
  if (!IS_TAURI) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = defaultName
      anchor.click()
      // Revoking synchronously can abort the download in some browsers;
      // give the navigation a tick to commit first.
      setTimeout(() => URL.revokeObjectURL(url), 0)
      return 'saved'
    } catch {
      return 'failed'
    }
  }

  let path: string | null
  try {
    path = await save({
      defaultPath: defaultName,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
  } catch {
    return 'failed'
  }
  if (path === null) return 'cancelled'

  try {
    await writeTextFile(path, text)
    return 'saved'
  } catch {
    return 'failed'
  }
}
