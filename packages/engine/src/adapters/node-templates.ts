import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TemplatesPort } from '../ports.ts'

/** The four templates and the Native stylesheet, from a folder laid out like `packages/engine/anki`. */
export function nodeTemplates(dir: string): TemplatesPort {
  const text = (name: string) => readFile(join(dir, name), 'utf8')
  return {
    async load() {
      const [front, back, clozeFront, clozeBack, css] = await Promise.all(
        ['front.html', 'back.html', 'cloze-front.html', 'cloze-back.html', 'style-native.css'].map(
          text,
        ),
      )
      return {
        templates: { front: front!, back: back!, clozeFront: clozeFront!, clozeBack: clozeBack! },
        css: css!,
      }
    },
  }
}
