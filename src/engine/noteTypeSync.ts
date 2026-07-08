/**
 * Installs, upgrades, and migrates to the bundled Lectern note types over
 * AnkiConnect (definitions in noteTypes.ts).
 *
 * Ownership policy: the app manages a note type only while its CSS carries
 * the exact style marker. A user who edits the styling in Anki removes the
 * marker (or changes the CSS around it) and owns the note type from then on;
 * ensureLecternModels reports it as userOwned and never writes to it again.
 */

import {
  BACK_FIELD_NAMES,
  FRONT_FIELD_NAMES,
  TEXT_FIELD_NAMES,
  type AnkiClient,
  type AnkiNoteInfo,
} from './anki'
import {
  LECTERN_BASIC_MODEL,
  LECTERN_CLOZE_MODEL,
  LECTERN_NOTE_TYPES,
  NOTE_TYPE_VERSION,
  isLecternModel,
  noteTypeCss,
  parseStyleMarker,
  type FontAsset,
  type NoteTypeTheme,
} from './noteTypes'

// --- Install / upgrade ---------------------------------------------------------

export interface EnsureModelsResult {
  created: string[]
  updated: string[]
  /** Marker missing — the user edited the styling; left untouched. */
  userOwned: string[]
}

/**
 * Make the Lectern note types exist and match the bundled version + theme.
 * Fonts are uploaded lazily (only when something is created or restyled);
 * `loadFonts` lets the app layer keep the woff2 bytes out of the engine.
 */
export async function ensureLecternModels(
  client: AnkiClient,
  theme: NoteTypeTheme,
  loadFonts: () => Promise<FontAsset[]>,
): Promise<EnsureModelsResult> {
  const existing = new Set(await client.modelNames())
  const result: EnsureModelsResult = { created: [], updated: [], userOwned: [] }
  const css = noteTypeCss(theme)

  const toCreate = LECTERN_NOTE_TYPES.filter((def) => !existing.has(def.name))
  const toInspect = LECTERN_NOTE_TYPES.filter((def) => existing.has(def.name))

  const toUpdate: typeof LECTERN_NOTE_TYPES = []
  for (const def of toInspect) {
    const marker = parseStyleMarker(await client.modelStyling(def.name))
    if (!marker) {
      result.userOwned.push(def.name)
    } else if (marker.version < NOTE_TYPE_VERSION || marker.theme !== theme) {
      // Older bundled version or theme switch. A marker from a NEWER app
      // version is left alone (downgrades never overwrite).
      if (marker.version <= NOTE_TYPE_VERSION) toUpdate.push(def)
    }
  }

  if (toCreate.length > 0 || toUpdate.length > 0) {
    // Fonts first, so a card never renders against missing font files.
    for (const font of await loadFonts()) {
      await client.storeMediaFile(font.filename, font.dataBase64)
    }
  }

  for (const def of toCreate) {
    await client.createModel({
      modelName: def.name,
      inOrderFields: def.fields,
      css,
      isCloze: def.isCloze,
      cardTemplates: def.templates,
    })
    result.created.push(def.name)
  }

  for (const def of toUpdate) {
    await client.updateModelStyling(def.name, css)
    await client.updateModelTemplates(
      def.name,
      Object.fromEntries(def.templates.map((t) => [t.Name, { Front: t.Front, Back: t.Back }])),
    )
    result.updated.push(def.name)
  }

  return result
}

/** True when both bundled note types exist in the collection. */
export async function lecternModelsInstalled(client: AnkiClient): Promise<boolean> {
  const models = new Set(await client.modelNames())
  return models.has(LECTERN_BASIC_MODEL) && models.has(LECTERN_CLOZE_MODEL)
}

// --- Migration of previously synced notes ----------------------------------------

export interface MigrationResult {
  migrated: number
  /** Already on a Lectern note type, or an unrecognized field shape. */
  skipped: number
  failures: Array<{ noteId: number; error: string }>
}

const BACK_EXTRA_FIELD_NAMES = new Set(['back extra', 'extra'])

const fieldValue = (info: AnkiNoteInfo, names: Set<string>): string | undefined => {
  for (const [name, field] of Object.entries(info.fields ?? {})) {
    if (names.has(name.trim().toLowerCase()) && field) return field.value
  }
  return undefined
}

/**
 * Move notes from earlier Lectern syncs (found via the default tag) onto the
 * bundled note types, keeping note ids and scheduling. Field mapping uses the
 * same localized front/back/text signatures as model detection, so German
 * Vorderseite/Rückseite collections migrate too. Topic/Source/Excerpt start
 * empty for migrated notes — the data only exists for cards synced after the
 * note types were introduced.
 */
export async function migrateNotesToLectern(
  client: AnkiClient,
  tag: string,
): Promise<MigrationResult> {
  const trimmed = tag.trim()
  if (!trimmed) return { migrated: 0, skipped: 0, failures: [] }

  const query = /\s/.test(trimmed) ? `"tag:${trimmed}"` : `tag:${trimmed}`
  const ids = await client.findNotes(query)
  const infos = await client.notesInfo(ids)

  const result: MigrationResult = { migrated: 0, skipped: 0, failures: [] }

  for (const info of infos) {
    const noteId = info.noteId
    if (typeof noteId !== 'number' || isLecternModel(info.modelName ?? '')) {
      result.skipped++
      continue
    }

    const front = fieldValue(info, FRONT_FIELD_NAMES)
    const back = fieldValue(info, BACK_FIELD_NAMES)
    const text = fieldValue(info, TEXT_FIELD_NAMES)

    let modelName: string
    let fields: Record<string, string>
    if (front !== undefined && back !== undefined) {
      modelName = LECTERN_BASIC_MODEL
      fields = { Front: front, Back: back }
    } else if (text !== undefined && front === undefined) {
      modelName = LECTERN_CLOZE_MODEL
      fields = { Text: text, 'Back Extra': fieldValue(info, BACK_EXTRA_FIELD_NAMES) ?? '' }
    } else {
      result.skipped++
      continue
    }

    try {
      await client.updateNoteModel({
        id: noteId,
        modelName,
        fields: { ...fields, Topic: '', Source: '', Excerpt: '' },
        // updateNoteModel REPLACES tags; pass the existing ones through.
        tags: info.tags ?? [],
      })
      result.migrated++
    } catch (err) {
      result.failures.push({
        noteId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}
