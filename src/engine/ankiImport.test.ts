/**
 * Reading a deck back out of Anki: page references must survive the round
 * trip through the Source field, and the Basic/Cloze split must be decided by
 * the note's own fields so localized collections import correctly.
 */

import { describe, expect, it } from 'vitest'

import { AnkiClient, type AnkiNoteInfo } from './anki'
import {
  ankiDeckQuery,
  fetchDeckCards,
  looksLikeSameSet,
  noteToCard,
  parsePageRefs,
  parseSourceSetName,
} from './ankiImport'
import { formatPageRefs } from './noteTypes'

const BASE_URL = 'http://localhost:8765'

interface Envelope {
  action: string
  params?: Record<string, unknown>
}

function makeFetch(
  table: Record<string, (params: Record<string, unknown> | undefined) => unknown>,
): { fetchFn: typeof fetch; calls: Envelope[] } {
  const calls: Envelope[] = []
  const fetchFn: typeof fetch = async (_input, init) => {
    const envelope = JSON.parse(String(init?.body)) as Envelope
    calls.push(envelope)
    const route = table[envelope.action]
    if (!route) {
      return new Response(JSON.stringify({ result: null, error: `unrouted: ${envelope.action}` }))
    }
    return new Response(JSON.stringify({ result: route(envelope.params), error: null }))
  }
  return { fetchFn, calls }
}

const field = (value: string, order: number) => ({ value, order })

const lecternNote = (
  noteId: number,
  overrides: Partial<Record<string, { value: string; order: number }>> = {},
  modelName = 'Lectern Basic',
): AnkiNoteInfo => ({
  noteId,
  modelName,
  tags: ['lectern'],
  fields: {
    Front: field('What is gradient descent?', 0),
    Back: field('An iterative optimizer.', 1),
    Topic: field('Optimization', 2),
    Source: field('ML Lecture 2 · pp. 12–14, 18', 3),
    Excerpt: field('The slide defines the update rule.', 4),
    ...overrides,
  },
})

describe('ankiDeckQuery', () => {
  it('quotes the deck name', () => {
    expect(ankiDeckQuery('Machine Learning::L2')).toBe('deck:"Machine Learning::L2"')
  })

  it('escapes the characters Anki reads as operators', () => {
    expect(ankiDeckQuery('Stats_2 "final" *')).toBe('deck:"Stats\\_2 \\"final\\" \\*"')
  })
})

describe('parsePageRefs', () => {
  it('round-trips whatever formatPageRefs writes', () => {
    for (const pages of [[3], [3, 4, 5, 8], [1, 2, 3], [7, 9, 11]]) {
      expect(parsePageRefs(`Deck Name · ${formatPageRefs(pages)}`)).toEqual(pages)
    }
  })

  it('expands runs written with any dash', () => {
    expect(parsePageRefs('pp. 3–5')).toEqual([3, 4, 5])
    expect(parsePageRefs('pp. 3-5')).toEqual([3, 4, 5])
    expect(parsePageRefs('pp. 3—5')).toEqual([3, 4, 5])
  })

  it('reads through HTML and entities left by Anki', () => {
    expect(parsePageRefs('<i>Lecture&nbsp;2</i> · pp.&nbsp;4, 6')).toEqual([4, 6])
  })

  it('returns nothing when the field carries no page reference', () => {
    expect(parsePageRefs('')).toEqual([])
    expect(parsePageRefs('Some hand-written source')).toEqual([])
  })

  it('refuses an absurd run rather than inventing hundreds of pages', () => {
    expect(parsePageRefs('pp. 1–99999')).toEqual([])
  })

  it('ignores a reversed run', () => {
    expect(parsePageRefs('pp. 9–3')).toEqual([])
  })
})

describe('parseSourceSetName', () => {
  it('reads the document name back out of a Source field', () => {
    expect(parseSourceSetName('ML Lecture 2 · pp. 12–14')).toBe('ML Lecture 2')
  })

  it('copes with a source that carries no page refs', () => {
    expect(parseSourceSetName('ML Lecture 2')).toBe('ML Lecture 2')
  })

  it('copes with page refs and no document name', () => {
    expect(parseSourceSetName('pp. 12–14')).toBeUndefined()
    expect(parseSourceSetName('')).toBeUndefined()
  })
})

describe('looksLikeSameSet', () => {
  it('matches a name the model rephrased between runs', () => {
    expect(
      looksLikeSameSet('Machine Learning Lecture 2', 'Machine Learning Lecture 2 Basics'),
    ).toBe(true)
  })

  it('sees through an abbreviation of the same title', () => {
    expect(looksLikeSameSet('ML Lecture 2', 'Machine Learning Lecture 2')).toBe(true)
  })

  it('does not fuse two courses that share a lecture number', () => {
    expect(looksLikeSameSet('ML Lecture 2', 'Organic Chemistry Lecture 2')).toBe(false)
    // "Lecture" alone must never be the word that makes two names match.
    expect(looksLikeSameSet('Databases Lecture 3', 'Compilers Lecture 3')).toBe(false)
  })

  it('falls back to words when neither name carries a number', () => {
    expect(looksLikeSameSet('Cell Structure', 'Genetics')).toBe(false)
    expect(looksLikeSameSet('Organic Chemistry', 'Organic Chemistry Basics')).toBe(true)
  })

  it('is case- and punctuation-insensitive', () => {
    expect(looksLikeSameSet('ML Lecture 2', 'ml-lecture-2')).toBe(true)
  })

  it('keeps different lectures of the same course apart', () => {
    // The words are 3-for-4 identical; only the number distinguishes them.
    expect(looksLikeSameSet('Machine Learning Lecture 2', 'Machine Learning Lecture 4')).toBe(false)
    expect(looksLikeSameSet('Lecture 2', 'Lecture 4')).toBe(false)
    expect(looksLikeSameSet('Stats Week 10', 'Stats Week 11')).toBe(false)
  })

  it('reads a number embedded in a word', () => {
    expect(looksLikeSameSet('Machine Learning L2', 'Machine Learning Lecture 2')).toBe(true)
    expect(looksLikeSameSet('Machine Learning L2', 'Machine Learning Lecture 3')).toBe(false)
  })

  it('never matches on a missing name', () => {
    expect(looksLikeSameSet(undefined, 'Machine Learning')).toBe(false)
    expect(looksLikeSameSet('Machine Learning', undefined)).toBe(false)
  })
})

describe('noteToCard', () => {
  it('rebuilds a Lectern Basic note, provenance included', () => {
    const card = noteToCard(lecternNote(1))
    expect(card).toMatchObject({
      modelName: 'Basic',
      fields: { Front: 'What is gradient descent?', Back: 'An iterative optimizer.' },
      slideTopic: 'Optimization',
      sourcePages: [12, 13, 14, 18],
      sourceExcerpt: 'The slide defines the update rule.',
      ankiNoteId: 1,
      fromAnki: true,
    })
  })

  it('drops the previous run’s concept ids, which mean nothing to a new map', () => {
    const card = noteToCard(lecternNote(1))
    expect(card?.conceptIds).toEqual([])
    expect(card?.relationKeys).toEqual([])
  })

  it('detects Cloze from the field signature, not the model name', () => {
    const note: AnkiNoteInfo = {
      noteId: 2,
      modelName: 'My Custom Type',
      fields: {
        Text: field('The derivative of {{c1::x^n}} is n·x^(n-1).', 0),
        'Back Extra': field('Power rule.', 1),
      },
    }
    const card = noteToCard(note)
    expect(card?.modelName).toBe('Cloze')
    expect(card?.fields.Text).toContain('{{c1::x^n}}')
    expect(card?.fields['Back Extra']).toBe('Power rule.')
  })

  it('imports a localized Basic note', () => {
    const note: AnkiNoteInfo = {
      noteId: 3,
      modelName: 'Einfach',
      fields: {
        Vorderseite: field('Was ist Entropie?', 0),
        Rückseite: field('Ein Maß für Unordnung.', 1),
      },
    }
    const card = noteToCard(note)
    expect(card?.modelName).toBe('Basic')
    expect(card?.fields.Front).toBe('Was ist Entropie?')
    expect(card?.fields.Back).toBe('Ein Maß für Unordnung.')
  })

  it('keeps a plain note without provenance, minus its page coverage', () => {
    const note: AnkiNoteInfo = {
      noteId: 4,
      modelName: 'Basic',
      fields: { Front: field('Hand-written question', 0), Back: field('Answer', 1) },
    }
    const card = noteToCard(note)
    expect(card?.sourcePages).toEqual([])
    expect(card?.slideTopic).toBeUndefined()
  })

  it('rejects notes with no readable content', () => {
    expect(noteToCard({ noteId: 5, fields: {} })).toBeNull()
    expect(noteToCard({ modelName: 'Basic', fields: { Front: field('x', 0) } })).toBeNull()
    expect(
      noteToCard({ noteId: 6, fields: { Front: field('<br>', 0), Back: field('y', 1) } }),
    ).toBeNull()
  })
})

describe('fetchDeckCards', () => {
  it('searches the named deck and returns its cards', async () => {
    const { fetchFn, calls } = makeFetch({
      findNotes: () => [1, 2],
      notesInfo: () => [lecternNote(1), lecternNote(2)],
    })
    const result = await fetchDeckCards(new AnkiClient(BASE_URL, fetchFn), 'ML::L2')

    expect(calls[0].params).toEqual({ query: 'deck:"ML::L2"' })
    expect(result.cards).toHaveLength(2)
    expect(result.totalNotes).toBe(2)
    expect(result.truncated).toBe(false)
  })

  it('reports unreadable notes by returning fewer cards than notes', async () => {
    const { fetchFn } = makeFetch({
      findNotes: () => [1, 2],
      notesInfo: () => [lecternNote(1), { noteId: 2, fields: {} }],
    })
    const result = await fetchDeckCards(new AnkiClient(BASE_URL, fetchFn), 'ML::L2')
    expect(result.cards).toHaveLength(1)
    expect(result.totalNotes).toBe(2)
  })

  it('does not call Anki for an empty deck name', async () => {
    const { fetchFn, calls } = makeFetch({ findNotes: () => [] })
    const result = await fetchDeckCards(new AnkiClient(BASE_URL, fetchFn), '   ')
    expect(calls).toHaveLength(0)
    expect(result.cards).toEqual([])
  })

  it('gives every imported card a distinct uid, so dedupe keys stay honest', async () => {
    const { fetchFn } = makeFetch({
      findNotes: () => [1, 2, 3],
      notesInfo: () => [lecternNote(1), lecternNote(2), lecternNote(3)],
    })
    const result = await fetchDeckCards(new AnkiClient(BASE_URL, fetchFn), 'ML::L2')
    expect(new Set(result.cards.map((c) => c.uid)).size).toBe(3)
  })
})
