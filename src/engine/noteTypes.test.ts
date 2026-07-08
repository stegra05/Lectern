import { describe, expect, it } from 'vitest'

import {
  formatPageRefs,
  isLecternModel,
  LECTERN_NOTE_TYPES,
  NOTE_TYPE_VERSION,
  noteTypeCss,
  parseStyleMarker,
  provenanceFieldValues,
  styleMarker,
} from './noteTypes'

describe('formatPageRefs', () => {
  it('formats singles, ranges, and mixed runs', () => {
    expect(formatPageRefs([])).toBe('')
    expect(formatPageRefs([3])).toBe('p. 3')
    expect(formatPageRefs([3, 4, 5])).toBe('pp. 3–5')
    expect(formatPageRefs([8, 3, 5, 4, 3])).toBe('pp. 3–5, 8')
    expect(formatPageRefs([2, 7])).toBe('pp. 2, 7')
  })
})

describe('provenanceFieldValues', () => {
  it('joins slide set and pages, and escapes plain-text values', () => {
    const values = provenanceFieldValues(
      {
        slideTopic: 'Trees & Graphs <intro>',
        sourcePages: [12, 13],
        sourceExcerpt: 'a < b implies "order"',
      },
      'ML Foundations L04',
    )

    expect(values).toEqual({
      Topic: 'Trees &amp; Graphs &lt;intro&gt;',
      Source: 'ML Foundations L04 · pp. 12–13',
      Excerpt: 'a &lt; b implies &quot;order&quot;',
    })
  })

  it('degrades gracefully when parts are missing', () => {
    expect(provenanceFieldValues({ sourcePages: [3] }, '')).toEqual({
      Topic: '',
      Source: 'p. 3',
      Excerpt: '',
    })
    expect(provenanceFieldValues({ sourcePages: [] }, 'Set')).toEqual({
      Topic: '',
      Source: 'Set',
      Excerpt: '',
    })
  })
})

describe('style marker', () => {
  it('round-trips through the generated CSS', () => {
    expect(parseStyleMarker(noteTypeCss('paper'))).toEqual({
      version: NOTE_TYPE_VERSION,
      theme: 'paper',
    })
    expect(parseStyleMarker(noteTypeCss('nord'))).toEqual({
      version: NOTE_TYPE_VERSION,
      theme: 'nord',
    })
  })

  it('returns null for user-edited styling', () => {
    expect(parseStyleMarker('.card { color: red }')).toBeNull()
    // A mangled marker no longer parses — the user owns the note type.
    expect(parseStyleMarker('/* lectern-notetype v1 theme:paper (mine now) */')).toBeNull()
  })

  it('parses versions other than the current one', () => {
    expect(parseStyleMarker(`${styleMarker('paper', 7)}\n.card {}`)).toEqual({
      version: 7,
      theme: 'paper',
    })
  })
})

describe('note type definitions', () => {
  it('references every field from its templates', () => {
    for (const def of LECTERN_NOTE_TYPES) {
      const html = def.templates.map((t) => t.Front + t.Back).join('')
      for (const field of def.fields) {
        expect(html, `${def.name} should use {{${field}}}`).toContain(`{{`)
        expect(html, `${def.name} should use field ${field}`).toContain(field)
      }
    }
  })

  it('keeps the duplicate-detection key first (Front / Text)', () => {
    const [basic, cloze] = LECTERN_NOTE_TYPES
    expect(basic.fields[0]).toBe('Front')
    expect(cloze.fields[0]).toBe('Text')
    expect(basic.isCloze).toBe(false)
    expect(cloze.isCloze).toBe(true)
  })

  it('ships JavaScript-free templates', () => {
    for (const def of LECTERN_NOTE_TYPES) {
      for (const t of def.templates) {
        expect(t.Front + t.Back).not.toContain('<script')
      }
    }
  })

  it('themes differ only in the palette, not the structure', () => {
    const paper = noteTypeCss('paper')
    const nord = noteTypeCss('nord')
    expect(paper).not.toBe(nord)
    // Same rule skeleton: identical selectors in identical order.
    const selectors = (css: string) => css.match(/^[.a-z#][^{]*\{/gim) ?? []
    expect(selectors(nord)).toEqual(selectors(paper))
  })
})

describe('isLecternModel', () => {
  it('matches exactly the two bundled note types', () => {
    expect(isLecternModel('Lectern Basic')).toBe(true)
    expect(isLecternModel('Lectern Cloze')).toBe(true)
    expect(isLecternModel('Basic')).toBe(false)
    expect(isLecternModel('lectern basic')).toBe(false)
  })
})
