import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { nodeDesigns } from '../src/adapters/node-designs.ts'

/** The card designs that ship, from the folder the app reads them from too. */
export const designs = nodeDesigns(join(import.meta.dirname, '../../../design/cards/anki'))

/** A PDF with one page per slide and one drawn text line per entry. An empty list is a blank slide. */
export async function makePdf(slides: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const lines of slides) {
    const page = doc.addPage([720, 405])
    lines.forEach((line, i) => page.drawText(line, { x: 40, y: 350 - i * 30, size: 18, font }))
  }
  return doc.save()
}

/** A fresh folder that holds one course named `course`. Returns the root for the store. */
export async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lectern-engine-'))
  await mkdir(join(root, 'course', 'slides'), { recursive: true })
  return root
}

export async function addSlides(root: string, file: string, slides: string[][]): Promise<void> {
  await writeFile(join(root, 'course', 'slides', file), await makePdf(slides))
}

/** Every file under `dir` with its bytes, keyed by path relative to `dir`. */
export async function snapshot(dir: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>()
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    out.set(relative(dir, path), await readFile(path))
  }
  return out
}
