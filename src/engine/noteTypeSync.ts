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
  FONT_FILES,
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
  /** Installed by a newer Lectern than this one; left untouched. */
  newerVersion: string[]
  /** A note type of the same name that is not ours — the provenance fields
   *  it lacks would be dropped by AnkiConnect without a word. */
  fieldMismatch: string[]
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
  const result: EnsureModelsResult = {
    created: [],
    updated: [],
    userOwned: [],
    newerVersion: [],
    fieldMismatch: [],
  }
  const css = noteTypeCss(theme)

  const toCreate = LECTERN_NOTE_TYPES.filter((def) => !existing.has(def.name))
  const toInspect = LECTERN_NOTE_TYPES.filter((def) => existing.has(def.name))

  /** Restyle only, or restyle and rewrite the templates with it. */
  const toUpdate: Array<{ def: (typeof LECTERN_NOTE_TYPES)[number]; templates: boolean }> = []
  for (const def of toInspect) {
    // Name is not identity: another add-on's "Lectern Basic" would take the
    // sync and quietly drop Topic/Source/Excerpt, since AnkiConnect ignores
    // field names a model does not have.
    const fields = new Set(await client.modelFieldNames(def.name).catch(() => def.fields))
    if (def.fields.some((name) => !fields.has(name))) {
      result.fieldMismatch.push(def.name)
      continue
    }
    const marker = parseStyleMarker(await client.modelStyling(def.name))
    if (!marker) {
      result.userOwned.push(def.name)
    } else if (marker.version > NOTE_TYPE_VERSION) {
      // Installed by a newer Lectern (a second machine): downgrades never
      // overwrite, and saying so beats a silent no-op.
      result.newerVersion.push(def.name)
    } else if (marker.version < NOTE_TYPE_VERSION || marker.theme !== theme) {
      // Templates are only rewritten when the bundled version actually
      // changed. A theme switch is a colour change, and rewriting templates
      // for it threw away a {{Tags}} line or a type-in box the user had
      // added — ownership of the CSS was never meant to cover those.
      toUpdate.push({ def, templates: marker.version < NOTE_TYPE_VERSION })
    }
  }

  // Fonts first, so a card never renders against missing font files. They
  // were only ever uploaded alongside a create or a restyle, so a collection
  // that lost them (a media restore, a sync from a machine that never had
  // them) rendered every Lectern card in the fallback serif with nothing
  // saying why.
  if (toCreate.length > 0 || toUpdate.length > 0 || (await fontsMissing(client))) {
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

  for (const { def, templates } of toUpdate) {
    // Templates before styling: the marker in the CSS is what the next run
    // reads to decide the upgrade is done, so it has to be written last. The
    // other order turned one failed call into a permanent half-upgrade.
    if (templates) {
      await client.updateModelTemplates(
        def.name,
        Object.fromEntries(def.templates.map((t) => [t.Name, { Front: t.Front, Back: t.Back }])),
      )
    }
    await client.updateModelStyling(def.name, css)
    result.updated.push(def.name)
  }

  return result
}

/** Is any bundled font absent from the collection's media folder? Unknown
 *  counts as present: a failed probe must not trigger an upload every run. */
async function fontsMissing(client: AnkiClient): Promise<boolean> {
  try {
    const present = new Set(await client.getMediaFilesNames('_Lectern*'))
    return Object.values(FONT_FILES).some((name) => !present.has(name))
  } catch {
    return false
  }
}

// --- Migration of previously synced notes ----------------------------------------

export interface MigrationResult {
  migrated: number
  /** Already on a Lectern note type, or an unrecognized field shape. */
  skipped: number
  failures: Array<{ noteId: number; error: string }>
}

const BACK_EXTRA_FIELD_NAMES = new Set(['back extra', 'extra'])
const CLOZE_DELETION_RE = /\{\{c\d+::/

const fieldValue = (info: AnkiNoteInfo, names: Set<string>): string | undefined => {
  for (const [name, field] of Object.entries(info.fields ?? {})) {
    if (names.has(name.trim().toLowerCase()) && field) return field.value
  }
  return undefined
}

/** Field names the migration maps by itself; everything else is the user's. */
const MAPPED_FIELD_NAMES = new Set([
  ...FRONT_FIELD_NAMES,
  ...BACK_FIELD_NAMES,
  ...TEXT_FIELD_NAMES,
  ...BACK_EXTRA_FIELD_NAMES,
  'topic',
  'source',
  'excerpt',
])

/** Non-empty fields the target note type has nowhere to put. */
const carriedFields = (info: AnkiNoteInfo): Array<[string, string]> =>
  Object.entries(info.fields ?? {})
    .filter(([name, field]) => {
      const value = field?.value?.trim() ?? ''
      return value !== '' && !MAPPED_FIELD_NAMES.has(name.trim().toLowerCase())
    })
    .map(([name, field]) => [name, field?.value ?? ''] as [string, string])

/** Keep a user's own fields visible on the card rather than deleting them. */
const appendCarried = (base: string, carried: Array<[string, string]>): string => {
  if (carried.length === 0) return base
  const block = carried.map(([name, value]) => `<div><b>${name}:</b> ${value}</div>`).join('')
  return base.trim() === '' ? block : `${base}<br>${block}`
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

  /** Templates per source model, so a note whose model makes more cards than
   *  the target never loses one to an ordinal with nothing to render it. */
  const templateCounts = new Map<string, number>()
  const templateCountOf = async (modelName: string): Promise<number> => {
    const cached = templateCounts.get(modelName)
    if (cached !== undefined) return cached
    const count = await client.modelTemplateCount(modelName).catch(() => 1)
    templateCounts.set(modelName, count)
    return count
  }

  for (const info of infos) {
    const noteId = info.noteId
    if (typeof noteId !== 'number' || isLecternModel(info.modelName ?? '')) {
      result.skipped++
      continue
    }

    // A reverse card has no home on a one-template note type: migrating the
    // note would strand it in Anki's Empty Cards list.
    if ((await templateCountOf(info.modelName ?? '')) > 1) {
      result.skipped++
      continue
    }

    const front = fieldValue(info, FRONT_FIELD_NAMES)
    const back = fieldValue(info, BACK_FIELD_NAMES)
    const text = fieldValue(info, TEXT_FIELD_NAMES)
    // Anything the user added in Anki beyond the fields we map — a mnemonic,
    // a source note. Dropping it silently was the worst thing this button did.
    const carried = carriedFields(info)

    let modelName: string
    let fields: Record<string, string>
    if (front !== undefined && back !== undefined) {
      modelName = LECTERN_BASIC_MODEL
      fields = { Front: front, Back: appendCarried(back, carried) }
    } else if (text !== undefined && front === undefined) {
      // A "Text"-shaped field with no deletion is not a cloze note; moving it
      // to the Cloze type would produce a note Anki cannot render at all.
      if (!CLOZE_DELETION_RE.test(text)) {
        result.skipped++
        continue
      }
      modelName = LECTERN_CLOZE_MODEL
      fields = {
        Text: text,
        'Back Extra': appendCarried(fieldValue(info, BACK_EXTRA_FIELD_NAMES) ?? '', carried),
      }
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
