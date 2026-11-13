/**
 * The app's HTTP channel: Tauri's Rust-side fetch, which is exempt from
 * webview CORS. In plain-browser dev mode it falls back to native fetch
 * (the model APIs allow CORS; AnkiConnect generally does not).
 */
import { fetch as pluginFetch } from '@tauri-apps/plugin-http'
import { IS_TAURI } from './platform'

/**
 * The plugin rejects an aborted request with a plain "Request canceled"
 * error, where standard fetch rejects with an AbortError. The model SDKs
 * abort their own request when its timeout runs out and tell that timeout
 * from a dropped connection by the AbortError.
 */
const abortAwareFetch: typeof fetch = async (input, init) => {
  try {
    return await pluginFetch(input, init)
  } catch (e) {
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    throw e
  }
}

export const tauriFetch: typeof fetch = IS_TAURI ? abortAwareFetch : (...args) => fetch(...args)
