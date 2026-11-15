import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type { Store } from '../ports.ts'

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

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
    async write(path, text) {
      await mkdir(dirname(at(path)), { recursive: true })
      await writeFile(at(path), text)
    },
    async writeBytes(path, data) {
      await mkdir(dirname(at(path)), { recursive: true })
      await writeFile(at(path), data)
    },
    async list(dir) {
      try {
        return await readdir(at(dir))
      } catch (error) {
        if (missing(error)) return []
        throw error
      }
    },
  }
}
