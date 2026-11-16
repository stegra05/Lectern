import { describe, expect, it } from 'vitest'
import { fromDrop } from './picked.ts'

/** A file entry of a drop, as the browser hands it over. */
const file = (fullPath: string) => ({
  isFile: true,
  isDirectory: false,
  fullPath,
  file: (resolve: (f: File) => void) => resolve(new File(['%PDF'], fullPath.split('/').at(-1)!)),
})

/** A folder entry whose reader hands its children over one batch at a time, then an empty one. */
const folder = (fullPath: string, ...batches: object[][]) => ({
  isFile: false,
  isDirectory: true,
  fullPath,
  createReader: () => {
    const left = [...batches]
    return { readEntries: (resolve: (entries: object[]) => void) => resolve(left.shift() ?? []) }
  },
})

const drop = (...entries: object[]) =>
  ({
    items: entries.map((entry) => ({
      kind: 'file',
      webkitGetAsEntry: () => entry,
      getAsFile: () => null,
    })),
  }) as unknown as DataTransfer

describe('a drop', () => {
  it('holds every file of a dropped folder and its subfolders, with its path', async () => {
    const picked = await fromDrop(
      drop(
        folder(
          '/Course',
          [file('/Course/01 Risk.pdf')],
          [folder('/Course/Week 2', [file('/Course/Week 2/slides.pdf')])],
        ),
        file('/Exam.pdf'),
      ),
    )
    expect(picked.map(({ path, file }) => [path, file.name])).toEqual([
      ['Course/01 Risk.pdf', '01 Risk.pdf'],
      ['Course/Week 2/slides.pdf', 'slides.pdf'],
      ['Exam.pdf', 'Exam.pdf'],
    ])
  })
})
