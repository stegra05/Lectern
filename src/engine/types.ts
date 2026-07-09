/**
 * Shared domain types for the Lectern engine.
 * Single vocabulary — every module (pipeline, coverage, quality, anki, UI store)
 * speaks these types. There is deliberately no second "transport" event model.
 */

export type NoteKind = 'Basic' | 'Cloze'

/** A flashcard as it lives in the app. Fields hold the actual Anki note fields
 *  (Basic: Front/Back — Cloze: Text, optionally "Back Extra"). */
export interface Card {
  uid: string
  modelName: NoteKind
  fields: Record<string, string>
  slideTopic?: string
  slideNumber?: number
  sourcePages: number[]
  conceptIds: string[]
  relationKeys: string[]
  rationale?: string
  sourceExcerpt?: string
  qualityScore: number
  qualityIssues: string[]
  /** The user asked for this card, but the document does not contain it
   *  (follow-up requests only). Rendered as an "outside source" label. */
  outsideSource?: boolean
  /** Kept out of Anki syncs until the user opts it in. */
  syncExcluded?: boolean
  /** Set after a successful Anki sync. */
  ankiNoteId?: number
}

// ---------------------------------------------------------------------------
// Concept map (phase 1 output)
// ---------------------------------------------------------------------------

export type Importance = 'high' | 'medium' | 'low'
export type Difficulty = 'foundational' | 'intermediate' | 'advanced'

export interface Concept {
  id: string
  name: string
  importance: Importance
  difficulty: Difficulty
  pageReferences: number[]
}

export interface Relation {
  source: string
  type: string
  target: string
  pageReferences: number[]
}

export const relationKeyOf = (r: Pick<Relation, 'source' | 'type' | 'target'>): string =>
  `${r.source}|${r.type}|${r.target}`

export type DocumentType = 'slides' | 'script' | 'mixed'

export interface ConceptMap {
  objectives: string[]
  concepts: Concept[]
  relations: Relation[]
  /** ISO 639-1 code detected from the document. */
  language: string
  slideSetName: string
  pageCount: number
  estimatedTextChars: number
  documentType: DocumentType
}

// ---------------------------------------------------------------------------
// Coverage ledger
// ---------------------------------------------------------------------------

export interface CoverageCatalog {
  conceptIds: Set<string>
  highPriorityIds: Set<string>
  relationKeys: Set<string>
  /** page number -> concept ids taught on that page */
  conceptsByPage: Map<number, string[]>
  /** concept id -> pages it appears on */
  pagesByConcept: Map<string, number[]>
  conceptNames: Map<string, string>
  pageCount: number
}

export interface CoverageData {
  pageCount: number
  coveredPages: number[]
  uncoveredPages: number[]
  pageCoveragePercent: number
  /** Concepts explicitly claimed via card.conceptIds */
  coveredConceptIds: string[]
  /** Concepts additionally considered covered via page overlap */
  inferredConceptIds: string[]
  conceptCoveragePercent: number
  effectiveConceptCoveragePercent: number
  coveredRelationKeys: string[]
  relationCoveragePercent: number
  /** High-importance concept ids not yet covered */
  missingHighPriority: string[]
  /** Pages with more than SATURATION_CARDS_PER_PAGE cards */
  saturatedPages: number[]
  cardsPerPage: Record<number, number>
}

// ---------------------------------------------------------------------------
// PDF + sizing
// ---------------------------------------------------------------------------

export interface PdfInfo {
  pageCount: number
  textChars: number
  imageCount: number
}

export type ContentMode = 'slides' | 'script'

export interface SizingPlan {
  contentMode: ContentMode
  /** Hard cap for the whole session. */
  totalCardCap: number
  /** Suggested cards per submit round (guidance given to the model). */
  batchSize: number
}

// ---------------------------------------------------------------------------
// Quality gate
// ---------------------------------------------------------------------------

export interface GateVerdict {
  pass: boolean
  /** Display score: 100 minus a fixed penalty per issue. */
  score: number
  /** Hard requirements not met — any entry rejects the card. */
  failures: string[]
  /** All flags (failures + soft issues), for card annotation. */
  issues: string[]
}

// ---------------------------------------------------------------------------
// Pipeline events — the single event vocabulary of the app
// ---------------------------------------------------------------------------

export type PipelinePhase = 'uploading' | 'mapping' | 'generating' | 'reflecting' | 'complete'

export type PipelineEvent =
  | { type: 'phase'; phase: PipelinePhase }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'concept_map'; conceptMap: ConceptMap; sizing: SizingPlan }
  | { type: 'card_accepted'; card: Card }
  | { type: 'card_rejected'; front: string; reasons: string[] }
  | { type: 'cards_replaced'; cards: Card[]; reflectionNote?: string }
  | { type: 'coverage'; coverage: CoverageData }
  | { type: 'progress'; produced: number; cap: number; round: number }
  | { type: 'usage'; inputTokens: number; outputTokens: number; costUsd: number }
  | { type: 'done'; reason: string; summary: string }
  | { type: 'error'; message: string; fatal: boolean }

export type PipelineSink = (event: PipelineEvent) => void

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface Settings {
  /** Gemini model id, e.g. "gemini-3.5-flash" */
  model: string
  ankiUrl: string
  /** Install and sync to the bundled "Lectern Basic"/"Lectern Cloze" note
   *  types (with Topic/Source/Excerpt provenance fields). Off = plain
   *  Basic/Cloze via the configured model names below. */
  useLecternNoteTypes: boolean
  /** Colorway of the bundled note types. */
  noteTypeTheme: 'paper' | 'nord'
  basicModelName: string
  clozeModelName: string
  /** Template like "{{deck}}::{{slide_set}}::{{topic}}" */
  tagTemplate: string
  defaultTag: string
  enableDefaultTag: boolean
}

// ---------------------------------------------------------------------------
// Anki sync
// ---------------------------------------------------------------------------

export interface SyncPreview {
  toCreate: number
  toUpdate: number
  /** Cards whose first field duplicates an existing Anki note (would be rejected). */
  duplicates: number
}

export interface SyncFailure {
  uid: string
  front: string
  error: string
}

export interface SyncResult {
  created: number
  updated: number
  failures: SyncFailure[]
}

export interface SyncProgress {
  done: number
  total: number
}
