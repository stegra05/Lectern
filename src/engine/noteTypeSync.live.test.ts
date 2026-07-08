/**
 * Live test against a real running Anki with AnkiConnect: installs the
 * bundled Lectern note types, syncs one card with provenance fields, verifies
 * the stored note, exercises a theme switch and the user-owned guard, and
 * cleans up the test note + deck. The note types themselves stay installed —
 * that is the feature.
 *
 *   LECTERN_ANKI_LIVE=1 pnpm vitest run src/engine/noteTypeSync.live.test.ts
 */

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { AnkiClient, checkConnection, syncCards } from './anki'
import { DEFAULT_SETTINGS } from './config'
import {
  FONT_FILES,
  LECTERN_BASIC_MODEL,
  LECTERN_CLOZE_MODEL,
  NOTE_TYPE_VERSION,
  parseStyleMarker,
  provenanceFieldValues,
  type FontAsset,
} from './noteTypes'
import { ensureLecternModels } from './noteTypeSync'
import type { Card, Settings } from './types'

const enabled = process.env.LECTERN_ANKI_LIVE === '1'
const LIVE_DECK = 'Lectern NoteType E2E'

const FONT_DIR = new URL('../../node_modules/', import.meta.url)
const FONT_PATHS: Record<string, string> = {
  [FONT_FILES.serif]:
    '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2',
  [FONT_FILES.serifItalic]:
    '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-italic.woff2',
  [FONT_FILES.mono]: '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
  [FONT_FILES.mono500]: '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2',
}

async function loadFontsFromDisk(): Promise<FontAsset[]> {
  return Promise.all(
    Object.entries(FONT_PATHS).map(async ([filename, rel]) => ({
      filename,
      dataBase64: (await readFile(new URL(rel, FONT_DIR))).toString('base64'),
    })),
  )
}

describe.skipIf(!enabled)('note type sync live', () => {
  it('installs, syncs with provenance, restyles, and respects user edits', async () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, useLecternNoteTypes: true }
    const client = new AnkiClient(settings.ankiUrl, fetch)
    const status = await checkConnection(client)
    expect(status.ok, `Anki not reachable: ${status.error}`).toBe(true)

    // Install (idempotent: created on first run, no-op after).
    await ensureLecternModels(client, 'paper', loadFontsFromDisk)
    const models = await client.modelNames()
    expect(models).toContain(LECTERN_BASIC_MODEL)
    expect(models).toContain(LECTERN_CLOZE_MODEL)
    expect(await client.modelFieldNames(LECTERN_BASIC_MODEL)).toEqual([
      'Front',
      'Back',
      'Topic',
      'Source',
      'Excerpt',
    ])

    // Idempotence: a second ensure changes nothing.
    const second = await ensureLecternModels(client, 'paper', loadFontsFromDisk)
    expect(second.created).toEqual([])

    // Sync one card carrying provenance.
    const card: Card = {
      uid: 'live-1',
      modelName: 'Basic',
      fields: {
        Front: 'LECTERN LIVE TEST — why does the lamp rule appear on the back only?',
        Back: 'Amber marks the <b>answer moment</b>.',
      },
      slideTopic: 'Design System',
      sourcePages: [3, 4, 5, 9],
      sourceExcerpt: 'Amber is spent only on coverage & the answer.',
      conceptIds: [],
      relationKeys: [],
      qualityScore: 100,
      qualityIssues: [],
    }
    const result = await syncCards(
      client,
      [card],
      LIVE_DECK,
      settings,
      () => ['lectern-e2e'],
      () => {},
      (c) => provenanceFieldValues(c, 'Live Slides L01'),
    )
    expect(result.failures).toEqual([])
    const noteId = result.noteIds.get('live-1')
    expect(noteId).toBeTypeOf('number')

    try {
      const [info] = await client.notesInfo([noteId as number])
      expect(info.modelName).toBe(LECTERN_BASIC_MODEL)
      expect(info.fields?.Topic?.value).toBe('Design System')
      expect(info.fields?.Source?.value).toBe('Live Slides L01 · pp. 3–5, 9')
      expect(info.fields?.Excerpt?.value).toBe('Amber is spent only on coverage &amp; the answer.')

      // Theme switch restyles in place and back.
      const toNord = await ensureLecternModels(client, 'nord', loadFontsFromDisk)
      expect(toNord.updated).toContain(LECTERN_BASIC_MODEL)
      expect(parseStyleMarker(await client.modelStyling(LECTERN_BASIC_MODEL))).toEqual({
        version: NOTE_TYPE_VERSION,
        theme: 'nord',
      })
      await ensureLecternModels(client, 'paper', loadFontsFromDisk)

      // User-owned guard: mangle the cloze styling, ensure must leave it alone,
      // then restore it.
      const original = await client.modelStyling(LECTERN_CLOZE_MODEL)
      await client.updateModelStyling(LECTERN_CLOZE_MODEL, '.card { color: red }')
      const guarded = await ensureLecternModels(client, 'paper', loadFontsFromDisk)
      expect(guarded.userOwned).toEqual([LECTERN_CLOZE_MODEL])
      expect(await client.modelStyling(LECTERN_CLOZE_MODEL)).toBe('.card { color: red }')
      await client.updateModelStyling(LECTERN_CLOZE_MODEL, original)
    } finally {
      // Clean up the test note and deck; the note types stay.
      await client.deleteNotes([noteId as number])
      // Raw action — deleting decks is not part of the app's API surface.
      await fetch(settings.ankiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deleteDecks',
          version: 6,
          params: { decks: [LIVE_DECK], cardsToo: true },
        }),
      })
    }
  }, 60_000)
})
