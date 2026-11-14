import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Design } from '../designs.ts'
import type { DesignsPort } from '../ports.ts'

/** The stylesheet of each design. Two designs were renamed after their files were made. */
const STYLESHEETS: Record<Design, string> = {
  native: 'style-native.css',
  structure: 'style-structure.css',
  lamp: 'style-lamp.css',
  colours: 'style-colours.css',
  afterglow: 'style-night.css',
  vitrine: 'style-object.css',
}

/** A font the stylesheet loads from Anki's media folder: `url("_LampSerif.woff2")`. */
const FONT = /url\("(_[\w-]+\.woff2)"\)/g

/** Card designs from a folder laid out like `design/v3/cards/anki`. */
export function nodeDesigns(dir: string): DesignsPort {
  const text = (name: string) => readFile(join(dir, name), 'utf8')
  return {
    async load(design) {
      const [front, back, clozeFront, clozeBack, css] = await Promise.all(
        ['front.html', 'back.html', 'cloze-front.html', 'cloze-back.html', STYLESHEETS[design]].map(
          text,
        ),
      )
      const names = [...new Set([...css!.matchAll(FONT)].map((match) => match[1]!))]
      const fonts = await Promise.all(
        names.map(async (name) => ({
          name,
          data: (await readFile(join(dir, name))).toString('base64'),
        })),
      )
      return {
        templates: { front: front!, back: back!, clozeFront: clozeFront!, clozeBack: clozeBack! },
        css: css!,
        fonts,
      }
    },
  }
}
