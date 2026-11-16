import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type { Store } from '../ports.ts'

/** No such file, or a file where a folder was expected, as `.DS_Store/course.json`. */
const missing = (error: unknown) =>
  ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')

/** Where a write goes before it replaces its target. Never listed. */
const PART = '.part'

/**
 * Writes beside the target and renames over it, so a crash, a quit or a full disk leaves the
 * old file or the new one, never a file cut short.
 */
async function writeWhole(full: string, data: string | Uint8Array) {
  await mkdir(dirname(full), { recursive: true })
  const part = `${full}.${randomUUID()}${PART}`
  try {
    await writeFile(part, data, { flush: true })
    await rename(part, full)
  } catch (error) {
    await rm(part, { force: true })
    throw error
  }
}

/** Plain files under `root`. A path that leaves the root is refused. */
export function nodeStore(root: string): Store {
  const base = resolve(root)
  const at = (path: string) => {
    const full = resolve(base, path)
    if (full !== base && !full.startsWith(base + sep))
      throw new Error(`Path outside the course library: ${path}`)
    return full
  }
  return {
    async read(path) {
      try {
        return await readFile(at(path), 'utf8')
      } catch (error) {
        if (missing(error)) return null
        throw error
      }
    },
    readBytes: async (path) => new Uint8Array(await readFile(at(path))),
    write: (path, text) => writeWhole(at(path), text),
    writeBytes: (path, data) => writeWhole(at(path), data),
    async move(from, to) {
      await mkdir(dirname(at(to)), { recursive: true })
      await rename(at(from), at(to))
    },
    async remove(path) {
      const full = at(path)
      if (full === base) throw new Error('The course library itself cannot be deleted.')
      await rm(full, { recursive: true })
    },
    async list(dir) {
      try {
        return (await readdir(at(dir))).filter((name) => !name.endsWith(PART))
      } catch (error) {
        if (missing(error)) return []
        throw error
      }
    },
  }
}
