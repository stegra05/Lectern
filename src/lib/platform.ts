/** True when running inside the Tauri shell; false in a plain browser (dev). */
export const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
