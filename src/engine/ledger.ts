/**
 * Deck ledger — the session artifacts that outlive the session.
 *
 * A session lives in memory and Anki only keeps the rendered fields, so the
 * card → concept mapping dies with the window. The ledger writes it down:
 * after every successful sync, one record per deck holds the concept map(s)
 * and each synced card's provenance, keyed by the note id Anki assigned —
 * the one identity that is stable across sessions. Everything longitudinal
 * (retention insights, leech rescue, course-level maps) joins against this.
 *
 * A deck can hold several lectures, so the ledger is a list of lecture
 * entries matched by slide-set name — the same `looksLikeSameSet` matching
 * the extend run uses, so "ML Lecture 2" and "Machine Learning Lecture 2"
 * land in one entry rather than two.
 *
 * Pure functions + zod schema — no UI imports, no storage. Reading and
 * writing live in `src/lib/ledgerStore.ts`.
 */

import { z } from 'zod'
import { looksLikeSameSet } from './ankiImport'
import type { Card, ConceptMap } from './types'

export const LEDGER_VERSION = 1

// --- Schema -------------------------------------------------------------------

const conceptSchema = z.object({
  id: z.string(),
  name: z.string(),
  importance: z.enum(['high', 'medium', 'low']),
  difficulty: z.enum(['foundational', 'intermediate', 'advanced']),
  pageReferences: z.array(z.number()),
})

const relationSchema = z.object({
  source: z.string(),
  type: z.string(),
  target: z.string(),
  pageReferences: z.array(z.number()),
})

const conceptMapSchema = z.object({
  objectives: z.array(z.string()),
  concepts: z.array(conceptSchema),
  relations: z.array(relationSchema),
  language: z.string(),
  slideSetName: z.string(),
  pageCount: z.number(),
  estimatedTextChars: z.number(),
  documentType: z.enum(['slides', 'script', 'mixed']),
})

/** One synced card's provenance. The Anki note id is the identity — the
 *  session `uid` is minted fresh every run and would never join. */
const ledgerCardSchema = z.object({
  ankiNoteId: z.number(),
  conceptIds: z.array(z.string()),
  relationKeys: z.array(z.string()),
  sourcePages: z.array(z.number()),
  sourceExcerpt: z.string().optional(),
})

const ledgerLectureSchema = z.object({
  slideSetName: z.string(),
  /** Where the PDF lived at sync time; null when it arrived as bytes only
   *  (browser mode). The file may have moved since — verify via the hash. */
  pdfPath: z.string().nullable(),
  pdfSha256: z.string().nullable(),
  conceptMap: conceptMapSchema,
  cards: z.array(ledgerCardSchema),
  /** ISO timestamp of the sync that wrote this entry. */
  syncedAt: z.string(),
})

export const deckLedgerSchema = z.object({
  version: z.literal(LEDGER_VERSION),
  deckName: z.string(),
  updatedAt: z.string(),
  lectures: z.array(ledgerLectureSchema),
})

export type LedgerCard = z.infer<typeof ledgerCardSchema>
export type LedgerLecture = z.infer<typeof ledgerLectureSchema>
export type DeckLedger = z.infer<typeof deckLedgerSchema>

/** Validate a stored value. Anything that does not parse — corruption, a
 *  future version — reads as "no ledger": v1 has nothing to migrate, and
 *  overwriting beats guessing. */
export function parseDeckLedger(value: unknown): DeckLedger | null {
  const result = deckLedgerSchema.safeParse(value)
  return result.success ? result.data : null
}

// --- Building an entry from a session -----------------------------------------

export interface LectureSnapshot {
  conceptMap: ConceptMap
  /** The session's cards after the sync stamped note ids. */
  cards: Card[]
  /** Canonical set name (the store reconciles the model's fresh spelling
   *  against what the deck already uses). */
  slideSetName: string
  pdfPath: string | null
  pdfSha256: string | null
  syncedAt: string
}

/**
 * The lecture entry a sync should record. Three kinds of card stay out:
 * - cards with no note id — they never reached Anki;
 * - cards inherited from a *different* lecture sharing the deck — they belong
 *   to that lecture's entry, and this run knows nothing true about them;
 * - cards imported back from Anki (`fromAnki`) — the import cannot recover
 *   concept ids, and merging their empty records would overwrite the full
 *   provenance the original session wrote.
 */
export function buildLedgerLecture(snapshot: LectureSnapshot): LedgerLecture {
  const cards: LedgerCard[] = []
  for (const card of snapshot.cards) {
    if (typeof card.ankiNoteId !== 'number') continue
    if (card.fromAnki === true) continue
    if (
      card.sourceSetName !== undefined &&
      !looksLikeSameSet(card.sourceSetName, snapshot.slideSetName)
    ) {
      continue
    }
    cards.push({
      ankiNoteId: card.ankiNoteId,
      conceptIds: [...card.conceptIds],
      relationKeys: [...card.relationKeys],
      sourcePages: [...card.sourcePages],
      ...(card.sourceExcerpt !== undefined ? { sourceExcerpt: card.sourceExcerpt } : {}),
    })
  }
  return {
    slideSetName: snapshot.slideSetName,
    pdfPath: snapshot.pdfPath,
    pdfSha256: snapshot.pdfSha256,
    conceptMap: snapshot.conceptMap,
    cards,
    syncedAt: snapshot.syncedAt,
  }
}

// --- Merge --------------------------------------------------------------------

/**
 * Fold a fresh lecture entry into the deck's ledger. A re-run of the same
 * lecture replaces its entry — new concept map, new document facts — but
 * cards merge by note id so provenance for cards this session did not touch
 * survives. The prior spelling of the set name wins, mirroring how the tags
 * inherit it. Cards since deleted in Anki linger until a consumer reconciles
 * against the live collection; the ledger itself never hears about deletions.
 */
export function mergeLedger(
  existing: DeckLedger | null,
  deckName: string,
  lecture: LedgerLecture,
): DeckLedger {
  const lectures = existing === null ? [] : [...existing.lectures]
  const index = lectures.findIndex((l) => looksLikeSameSet(l.slideSetName, lecture.slideSetName))
  if (index === -1) {
    lectures.push(lecture)
  } else {
    const prior = lectures[index]
    const byNoteId = new Map(prior.cards.map((card) => [card.ankiNoteId, card]))
    for (const card of lecture.cards) byNoteId.set(card.ankiNoteId, card)
    lectures[index] = {
      ...lecture,
      slideSetName: prior.slideSetName,
      cards: [...byNoteId.values()],
    }
  }
  return { version: LEDGER_VERSION, deckName, updatedAt: lecture.syncedAt, lectures }
}

// --- Names + hashing ----------------------------------------------------------

/**
 * The store file for a deck: a readable slug plus an FNV-1a hash of the exact
 * name, so "Statistik: Woche 2" and "Statistik Woche 2" (same slug) still get
 * distinct files.
 */
export function ledgerStoreFile(deckName: string): string {
  const slug = deckName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  let hash = 0x811c9dc5
  for (const char of deckName) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `deck-${slug === '' ? 'deck' : slug}-${hash.toString(16).padStart(8, '0')}.json`
}

/** SHA-256 of the document bytes, hex-encoded, via WebCrypto. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
