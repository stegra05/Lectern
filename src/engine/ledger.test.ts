import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  buildLedgerLecture,
  isNewerLedgerVersion,
  LEDGER_VERSION,
  ledgerStoreFile,
  mergeLedger,
  parseDeckLedger,
  sha256Hex,
  type LedgerLecture,
} from './ledger'
import type { Card, ConceptMap } from './types'

const map: ConceptMap = {
  objectives: ['Understand gradient descent'],
  concepts: [
    {
      id: 'gd',
      name: 'Gradient Descent',
      importance: 'high',
      difficulty: 'foundational',
      pageReferences: [12, 13],
    },
  ],
  relations: [{ source: 'gd', type: 'depends_on', target: 'lr', pageReferences: [14] }],
  language: 'en',
  slideSetName: 'ML Lecture 2',
  pageCount: 30,
  estimatedTextChars: 12000,
  documentType: 'slides',
}

const card = (uid: string, extra: Partial<Card> = {}): Card => ({
  uid,
  modelName: 'Basic',
  fields: { Front: `Q ${uid}`, Back: `A ${uid}` },
  sourcePages: [12],
  conceptIds: ['gd'],
  relationKeys: [],
  qualityScore: 100,
  qualityIssues: [],
  ...extra,
})

const snapshot = (cards: Card[]) => ({
  conceptMap: map,
  cards,
  slideSetName: 'ML Lecture 2',
  pdfPath: '/lectures/ml2.pdf',
  pdfSha256: 'abc123',
  syncedAt: '2026-07-28T12:00:00.000Z',
})

describe('buildLedgerLecture', () => {
  it('records synced cards with their provenance', () => {
    const lecture = buildLedgerLecture(
      snapshot([card('a', { ankiNoteId: 11, sourceExcerpt: 'the slope' })]),
    )
    expect(lecture.cards).toEqual([
      {
        ankiNoteId: 11,
        conceptIds: ['gd'],
        relationKeys: [],
        sourcePages: [12],
        sourceExcerpt: 'the slope',
      },
    ])
    expect(lecture.pdfPath).toBe('/lectures/ml2.pdf')
  })

  it('skips cards that never reached Anki', () => {
    const lecture = buildLedgerLecture(snapshot([card('a')]))
    expect(lecture.cards).toEqual([])
  })

  it('skips cards inherited from another lecture in the deck', () => {
    const other = card('a', { ankiNoteId: 11, sourceSetName: 'Statistics Week 1' })
    expect(buildLedgerLecture(snapshot([other])).cards).toEqual([])
  })

  it('keeps cards whose set name is a spelling variant of this run', () => {
    const variant = card('a', { ankiNoteId: 11, sourceSetName: 'Machine Learning Lecture 2' })
    expect(buildLedgerLecture(snapshot([variant])).cards).toHaveLength(1)
  })

  it('skips cards imported back from Anki, whose concept ids are lost', () => {
    // Their empty records must not overwrite the original session's entry.
    const imported = card('a', { ankiNoteId: 11, fromAnki: true, conceptIds: [] })
    expect(buildLedgerLecture(snapshot([imported])).cards).toEqual([])
  })
})

describe('mergeLedger', () => {
  const lecture = (over: Partial<LedgerLecture> = {}): LedgerLecture => ({
    slideSetName: 'ML Lecture 2',
    pdfPath: '/lectures/ml2.pdf',
    pdfSha256: 'abc123',
    conceptMap: map,
    cards: [{ ankiNoteId: 11, conceptIds: ['gd'], relationKeys: [], sourcePages: [12] }],
    syncedAt: '2026-07-28T12:00:00.000Z',
    ...over,
  })

  it('starts a ledger from nothing', () => {
    const merged = mergeLedger(null, 'ML', lecture())
    expect(merged.version).toBe(LEDGER_VERSION)
    expect(merged.deckName).toBe('ML')
    expect(merged.lectures).toHaveLength(1)
  })

  it('appends a genuinely new lecture', () => {
    const first = mergeLedger(null, 'ML', lecture())
    const merged = mergeLedger(first, 'ML', lecture({ slideSetName: 'ML Lecture 3' }))
    expect(merged.lectures.map((l) => l.slideSetName)).toEqual(['ML Lecture 2', 'ML Lecture 3'])
  })

  it('folds a re-run into its lecture, keeping untouched cards and the prior spelling', () => {
    const first = mergeLedger(null, 'ML', lecture())
    const rerun = lecture({
      slideSetName: 'Machine Learning Lecture 2',
      cards: [{ ankiNoteId: 12, conceptIds: ['gd'], relationKeys: [], sourcePages: [13] }],
      syncedAt: '2026-07-29T12:00:00.000Z',
    })
    const merged = mergeLedger(first, 'ML', rerun)
    expect(merged.lectures).toHaveLength(1)
    expect(merged.lectures[0].slideSetName).toBe('ML Lecture 2')
    expect(merged.lectures[0].cards.map((c) => c.ankiNoteId).sort()).toEqual([11, 12])
    expect(merged.updatedAt).toBe('2026-07-29T12:00:00.000Z')
  })

  it('lets a re-synced card replace its own record', () => {
    const first = mergeLedger(null, 'ML', lecture())
    const rerun = lecture({
      cards: [{ ankiNoteId: 11, conceptIds: ['gd', 'lr'], relationKeys: [], sourcePages: [12] }],
    })
    const merged = mergeLedger(first, 'ML', rerun)
    expect(merged.lectures[0].cards).toHaveLength(1)
    expect(merged.lectures[0].cards[0].conceptIds).toEqual(['gd', 'lr'])
  })
})

describe('parseDeckLedger', () => {
  it('round-trips what mergeLedger builds', () => {
    const ledger = mergeLedger(
      null,
      'ML',
      buildLedgerLecture(snapshot([card('a', { ankiNoteId: 11 })])),
    )
    const parsed = parseDeckLedger(JSON.parse(JSON.stringify(ledger)))
    expect(parsed).toEqual(ledger)
  })

  it('rejects other versions and garbage', () => {
    const ledger = mergeLedger(null, 'ML', buildLedgerLecture(snapshot([])))
    expect(parseDeckLedger({ ...ledger, version: 2 })).toBeNull()
    expect(parseDeckLedger('not a ledger')).toBeNull()
    expect(parseDeckLedger(null)).toBeNull()
    expect(parseDeckLedger({ ...ledger, lectures: [{}] })).toBeNull()
  })

  it('persists exactly the ConceptMap shape — schema drift fails this file at typecheck', () => {
    expectTypeOf<LedgerLecture['conceptMap']>().toEqualTypeOf<ConceptMap>()
  })
})

describe('isNewerLedgerVersion', () => {
  it('flags only values claiming a version beyond this build', () => {
    const ledger = mergeLedger(null, 'ML', buildLedgerLecture(snapshot([])))
    expect(isNewerLedgerVersion({ ...ledger, version: LEDGER_VERSION + 1 })).toBe(true)
    expect(isNewerLedgerVersion(ledger)).toBe(false)
    expect(isNewerLedgerVersion(null)).toBe(false)
    expect(isNewerLedgerVersion('not a ledger')).toBe(false)
    expect(isNewerLedgerVersion({ version: 'later' })).toBe(false)
  })
})

describe('ledgerStoreFile', () => {
  it('slugs the deck name into a readable file', () => {
    expect(ledgerStoreFile('ML Lecture 2')).toMatch(/^deck-ml-lecture-2-[0-9a-f]{8}\.json$/)
  })

  it('keeps decks distinct when their slugs collide', () => {
    expect(ledgerStoreFile('Statistik: Woche 2')).not.toBe(ledgerStoreFile('Statistik Woche 2'))
  })

  it('survives a name with no usable characters', () => {
    expect(ledgerStoreFile('!!!')).toMatch(/^deck-deck-[0-9a-f]{8}\.json$/)
  })

  it('does not leave a dangling dash when truncation cuts at a word break', () => {
    expect(ledgerStoreFile('a'.repeat(39) + ' tail')).toMatch(/^deck-a{39}-[0-9a-f]{8}\.json$/)
  })
})

describe('sha256Hex', () => {
  it('matches the known vector for "abc"', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('abc'))
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
