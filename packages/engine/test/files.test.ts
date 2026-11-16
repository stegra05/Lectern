import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { memoryAnki } from '../src/adapters/memory-anki.ts'
import { nodeStore } from '../src/adapters/node-store.ts'
import { offlineDecisions, offlineModel } from '../src/adapters/offline.ts'
import { pdfjsReader } from '../src/adapters/pdfjs.ts'
import { createEngine, type Event } from '../src/api.ts'
import { fileFailure } from '../src/errors.ts'
import { tempRoot, templates } from './helpers.ts'

describe('a course folder that cannot be written', () => {
  it('says which folder and what to do, in plain words', async () => {
    const root = join(await tempRoot(), 'locked')
    await mkdir(root, { recursive: true })
    await chmod(root, 0o555)
    const events: Event[] = []
    try {
      await createEngine({
        store: nodeStore(root),
        pdf: pdfjsReader,
        model: offlineModel(),
        decisions: offlineDecisions(),
        anki: memoryAnki(),
        templates,
        now: Date.now,
      }).run({ type: 'create', name: 'Risk' }, (event) => events.push(event))
    } finally {
      await chmod(root, 0o755)
    }
    expect(events).toHaveLength(1)
    const failed = events[0]
    if (failed?.type !== 'failed') throw new Error('expected a failure')
    expect(failed.message).toBe(`Lectern is not allowed to change ${join(root, 'risk')}.`)
    expect(failed.fix).toContain('Give yourself access to that folder')
    expect(failed.fix).not.toMatch(/command/i)
  })

  it('words a full disk, a read-only folder and a folder that is gone', () => {
    const fail = (code: string) =>
      fileFailure(Object.assign(new Error(code), { code, path: '/Courses/Risk' }))
    expect(fail('ENOSPC')?.message).toBe(
      'The disk is full, so Lectern could not save to /Courses/Risk.',
    )
    expect(fail('EROFS')?.message).toBe('/Courses/Risk is read-only, so Lectern cannot save to it.')
    expect(fail('ENOENT')?.message).toBe('Lectern cannot find /Courses/Risk.')
    expect(fail('EPERM')?.fix).toContain('move the course to a folder you own')
    expect(fileFailure(Object.assign(new Error('x'), { code: 'EISDIR' }))).toBeUndefined()
  })
})
