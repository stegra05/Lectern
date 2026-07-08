/**
 * The app's HTTP channel: Tauri's Rust-side fetch, which is exempt from
 * webview CORS. In plain-browser dev mode it falls back to native fetch
 * (Gemini allows CORS; AnkiConnect generally does not).
 */
import { fetch as pluginFetch } from '@tauri-apps/plugin-http'
import { IS_TAURI } from './platform'

export const tauriFetch: typeof fetch = IS_TAURI ? pluginFetch : (...args) => fetch(...args)
