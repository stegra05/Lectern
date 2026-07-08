/**
 * The woff2 files the bundled Anki note types reference (see
 * engine/noteTypes.ts FONT_FILES). Loaded through Vite as bundled assets and
 * base64-encoded for AnkiConnect's storeMediaFile — the engine itself stays
 * free of asset imports so it runs under plain vitest.
 */

import monoUrl from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url'
import mono500Url from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?url'
import serifItalicUrl from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-italic.woff2?url'
import serifUrl from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2?url'
import { FONT_FILES, type FontAsset } from '../engine/noteTypes'

const SOURCES: Array<{ filename: string; url: string }> = [
  { filename: FONT_FILES.serif, url: serifUrl },
  { filename: FONT_FILES.serifItalic, url: serifItalicUrl },
  { filename: FONT_FILES.mono, url: monoUrl },
  { filename: FONT_FILES.mono500, url: mono500Url },
]

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Fetches the app's own font assets (~140 KB total). Called lazily by
 *  ensureLecternModels only when a note type is created or restyled. */
export async function loadNoteTypeFonts(): Promise<FontAsset[]> {
  return Promise.all(
    SOURCES.map(async ({ filename, url }) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Could not load bundled font ${filename}`)
      return { filename, dataBase64: toBase64(await response.arrayBuffer()) }
    }),
  )
}
