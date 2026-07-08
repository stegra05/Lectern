import { describe, expect, it } from 'vitest'

import { AnkiClient } from './anki'
import { NOTE_TYPE_VERSION, noteTypeCss, styleMarker, type FontAsset } from './noteTypes'
import { ensureLecternModels, migrateNotesToLectern } from './noteTypeSync'

// --- Compact mock: dispatch AnkiConnect actions to route functions -------------

interface Call {
  action: string
  params?: Record<string, unknown>
}

function mockAnki(
  table: Record<string, (params: Record<string, unknown> | undefined, nth: number) => unknown>,
) {
  const calls: Call[] = []
  const counts = new Map<string, number>()
  const fetchFn: typeof fetch = async (_input, init) => {
    const env = JSON.parse(String(init?.body)) as Call
    calls.push(env)
    const route = table[env.action]
    if (!route) {
      return new Response(
        JSON.stringify({ result: null, error: `unrouted action in test: ${env.action}` }),
      )
    }
    const nth = counts.get(env.action) ?? 0
    counts.set(env.action, nth + 1)
    try {
      return new Response(JSON.stringify({ result: route(env.params, nth), error: null }))
    } catch (e) {
      return new Response(JSON.stringify({ result: null, error: (e as Error).message }))
    }
  }
  return {
    client: new AnkiClient('http://localhost:8765', fetchFn, { initialRetryDelayMs: 0 }),
    calls,
  }
}

const FONTS: FontAsset[] = [{ filename: '_LecternTest.woff2', dataBase64: 'Zm9udA==' }]
const loadFonts = async () => FONTS

const actionsOf = (calls: Call[]) => calls.map((c) => c.action)

// --- ensureLecternModels ---------------------------------------------------------

describe('ensureLecternModels', () => {
  it('creates both note types (fonts first) when absent', async () => {
    const { client, calls } = mockAnki({
      modelNames: () => ['Basic', 'Cloze'],
      storeMediaFile: () => '_LecternTest.woff2',
      createModel: () => ({}),
    })

    const result = await ensureLecternModels(client, 'paper', loadFonts)

    expect(result).toEqual({
      created: ['Lectern Basic', 'Lectern Cloze'],
      updated: [],
      userOwned: [],
    })
    const actions = actionsOf(calls)
    expect(actions.indexOf('storeMediaFile')).toBeLessThan(actions.indexOf('createModel'))

    const create = calls.find((c) => c.action === 'createModel')?.params as {
      modelName: string
      inOrderFields: string[]
      isCloze: boolean
      css: string
      cardTemplates: Array<{ Name: string }>
    }
    expect(create.modelName).toBe('Lectern Basic')
    expect(create.inOrderFields).toEqual(['Front', 'Back', 'Topic', 'Source', 'Excerpt'])
    expect(create.isCloze).toBe(false)
    expect(create.css).toContain(styleMarker('paper'))
  })

  it('does nothing (not even font uploads) when both are current', async () => {
    const { client, calls } = mockAnki({
      modelNames: () => ['Lectern Basic', 'Lectern Cloze'],
      modelStyling: () => ({ css: noteTypeCss('paper') }),
    })

    const result = await ensureLecternModels(client, 'paper', loadFonts)

    expect(result).toEqual({ created: [], updated: [], userOwned: [] })
    expect(actionsOf(calls)).not.toContain('storeMediaFile')
    expect(actionsOf(calls)).not.toContain('updateModelStyling')
  })

  it('restyles + retemplates when the bundled version is newer', async () => {
    const oldCss = `${styleMarker('paper', NOTE_TYPE_VERSION - 1)}\n.card {}`
    const { client, calls } = mockAnki({
      modelNames: () => ['Lectern Basic', 'Lectern Cloze'],
      modelStyling: () => ({ css: oldCss }),
      storeMediaFile: () => 'ok',
      updateModelStyling: () => ({}),
      updateModelTemplates: () => ({}),
    })

    const result = await ensureLecternModels(client, 'paper', loadFonts)

    expect(result.updated).toEqual(['Lectern Basic', 'Lectern Cloze'])
    expect(actionsOf(calls).filter((a) => a === 'updateModelStyling')).toHaveLength(2)
    expect(actionsOf(calls).filter((a) => a === 'updateModelTemplates')).toHaveLength(2)
    expect(actionsOf(calls)).toContain('storeMediaFile')
  })

  it('switches themes in place', async () => {
    const { client, calls } = mockAnki({
      modelNames: () => ['Lectern Basic', 'Lectern Cloze'],
      modelStyling: () => ({ css: noteTypeCss('paper') }),
      storeMediaFile: () => 'ok',
      updateModelStyling: () => ({}),
      updateModelTemplates: () => ({}),
    })

    const result = await ensureLecternModels(client, 'nord', loadFonts)

    expect(result.updated).toEqual(['Lectern Basic', 'Lectern Cloze'])
    const styling = calls.find((c) => c.action === 'updateModelStyling')?.params as {
      model: { css: string }
    }
    expect(styling.model.css).toContain(styleMarker('nord'))
  })

  it('never touches a note type whose marker is gone (user-owned)', async () => {
    const { client, calls } = mockAnki({
      modelNames: () => ['Lectern Basic', 'Lectern Cloze'],
      modelStyling: (params) =>
        params?.modelName === 'Lectern Basic'
          ? { css: '.card { /* my own thing */ }' }
          : { css: noteTypeCss('paper') },
    })

    const result = await ensureLecternModels(client, 'paper', loadFonts)

    expect(result.userOwned).toEqual(['Lectern Basic'])
    expect(result.updated).toEqual([])
    expect(actionsOf(calls)).not.toContain('updateModelStyling')
  })

  it('leaves note types from a newer app version alone', async () => {
    const newerCss = `${styleMarker('paper', NOTE_TYPE_VERSION + 1)}\n.card {}`
    const { client, calls } = mockAnki({
      modelNames: () => ['Lectern Basic', 'Lectern Cloze'],
      modelStyling: () => ({ css: newerCss }),
    })

    const result = await ensureLecternModels(client, 'paper', loadFonts)

    expect(result).toEqual({ created: [], updated: [], userOwned: [] })
    expect(actionsOf(calls)).not.toContain('updateModelStyling')
  })
})

// --- migrateNotesToLectern ---------------------------------------------------------

const noteInfo = (
  noteId: number,
  modelName: string,
  fields: Record<string, string>,
  tags: string[] = ['lectern'],
) => ({
  noteId,
  modelName,
  tags,
  fields: Object.fromEntries(
    Object.entries(fields).map(([name, value], order) => [name, { value, order }]),
  ),
})

describe('migrateNotesToLectern', () => {
  it('moves Basic and Cloze notes over, preserving tags, and skips Lectern notes', async () => {
    const infos = [
      noteInfo(1, 'Basic', { Front: 'Q1', Back: 'A1' }, ['lectern', 'bio']),
      noteInfo(2, 'Cloze', { Text: '{{c1::X}}', 'Back Extra': 'extra' }),
      noteInfo(3, 'Lectern Basic', { Front: 'done', Back: 'done' }),
    ]
    const updates: unknown[] = []
    const { client, calls } = mockAnki({
      findNotes: () => [1, 2, 3],
      notesInfo: () => infos,
      updateNoteModel: (params) => {
        updates.push(params?.note)
        return {}
      },
    })

    const result = await migrateNotesToLectern(client, 'lectern')

    expect(result).toEqual({ migrated: 2, skipped: 1, failures: [] })
    expect(calls.find((c) => c.action === 'findNotes')?.params).toEqual({
      query: 'tag:lectern',
    })
    expect(updates).toEqual([
      {
        id: 1,
        modelName: 'Lectern Basic',
        fields: { Front: 'Q1', Back: 'A1', Topic: '', Source: '', Excerpt: '' },
        tags: ['lectern', 'bio'],
      },
      {
        id: 2,
        modelName: 'Lectern Cloze',
        fields: {
          Text: '{{c1::X}}',
          'Back Extra': 'extra',
          Topic: '',
          Source: '',
          Excerpt: '',
        },
        tags: ['lectern'],
      },
    ])
  })

  it('maps localized field names (German Vorderseite/Rückseite)', async () => {
    const { client, calls } = mockAnki({
      findNotes: () => [9],
      notesInfo: () => [noteInfo(9, 'Einfach', { Vorderseite: 'F', Rückseite: 'R' })],
      updateNoteModel: () => ({}),
    })

    const result = await migrateNotesToLectern(client, 'lectern')

    expect(result.migrated).toBe(1)
    const note = calls.find((c) => c.action === 'updateNoteModel')?.params?.note as {
      modelName: string
      fields: Record<string, string>
    }
    expect(note.modelName).toBe('Lectern Basic')
    expect(note.fields.Front).toBe('F')
    expect(note.fields.Back).toBe('R')
  })

  it('skips unrecognized shapes and collects per-note failures', async () => {
    const { client } = mockAnki({
      findNotes: () => [1, 2],
      notesInfo: () => [
        noteInfo(1, 'Geographie', { Land: 'DE', Hauptstadt: 'Berlin' }),
        noteInfo(2, 'Basic', { Front: 'Q', Back: 'A' }),
      ],
      updateNoteModel: () => {
        throw new Error('collection is not available')
      },
    })

    const result = await migrateNotesToLectern(client, 'lectern')

    expect(result.migrated).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].noteId).toBe(2)
    expect(result.failures[0].error).toContain('collection is not available')
  })

  it('quotes tags containing spaces and no-ops on an empty tag', async () => {
    const { client, calls } = mockAnki({
      findNotes: () => [],
      notesInfo: () => [],
    })

    await migrateNotesToLectern(client, 'my tag')
    expect(calls.find((c) => c.action === 'findNotes')?.params).toEqual({
      query: '"tag:my tag"',
    })

    calls.length = 0
    await expect(migrateNotesToLectern(client, '  ')).resolves.toEqual({
      migrated: 0,
      skipped: 0,
      failures: [],
    })
    expect(calls).toHaveLength(0)
  })
})
