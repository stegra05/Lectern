/**
 * Zod schemas for REST API response validation.
 *
 * These schemas validate responses from the FastAPI backend to catch
 * type mismatches early and prevent silent failures in the frontend.
 */
import { z } from 'zod';

// ============================================================================
// Health & Status Schemas
// ============================================================================

export const HealthStatusSchema = z.object({
  status: z.string(),
  anki_connected: z.boolean(),
  gemini_configured: z.boolean(),
  backend_ready: z.boolean().optional(),
  anki_version: z.string().optional(),
  gemini_model: z.string().optional(),
});
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const AnkiStatusSchema = z.object({
  status: z.string(),
  connected: z.boolean(),
  version: z.string().nullable(),
  version_ok: z.boolean(),
  error: z.string().optional(),
});
export type AnkiStatus = z.infer<typeof AnkiStatusSchema>;

export const VersionSchema = z.object({
  current: z.string(),
  latest: z.string().nullable(),
  update_available: z.boolean(),
  release_url: z.string(),
});
export type Version = z.infer<typeof VersionSchema>;

// ============================================================================
// Configuration Schemas
// ============================================================================

export const ConfigSchema = z.object({
  anki_url: z.string().optional(),
  basic_model: z.string().optional(),
  cloze_model: z.string().optional(),
  gemini_model: z.string().optional(),
  tag_template: z.string().optional(),
  gemini_api_key_set: z.boolean().optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

// ============================================================================
// Deck Schemas
// ============================================================================

export const DecksResponseSchema = z.object({
  decks: z.array(z.string()),
});
export type DecksResponse = z.infer<typeof DecksResponseSchema>;

export const CreateDeckResponseSchema = z.object({
  status: z.literal('created'),
  deck: z.string(),
});
export type CreateDeckResponse = z.infer<typeof CreateDeckResponseSchema>;

// ============================================================================
// Estimation Schema
// ============================================================================

export const EstimationSchema = z.object({
  tokens: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  input_cost: z.number(),
  output_cost: z.number(),
  cost: z.number(),
  pages: z.number(),
  text_chars: z.number().optional(),
  model: z.string(),
  suggested_card_count: z.number().optional(),
  image_count: z.number().optional(),
  document_type: z.string().optional(),
});
export type Estimation = z.infer<typeof EstimationSchema>;

// ============================================================================
// Card Schema
// ============================================================================

export const CardSchema = z.object({
  front: z.string().optional(),
  back: z.string().optional(),
  text: z.string().optional(),
  anki_note_id: z.number().optional(),
  fields: z.record(z.string(), z.string()).optional(),
  model_name: z.string().optional(),
  slide_number: z.number().optional(),
  source_pages: z.array(z.number()).optional(),
  concept_ids: z.array(z.string()).optional(),
  relation_keys: z.array(z.string()).optional(),
  slide_topic: z.string().optional(),
  rationale: z.string().optional(),
  source_excerpt: z.string().optional(),
  tag: z.string().optional(),
  uid: z.string().optional(),
  _uid: z.string().optional(),
}).passthrough();
export type Card = z.infer<typeof CardSchema>;

// ============================================================================
// Coverage Schemas
// ============================================================================

export const CoverageConceptSchema = z.object({
  id: z.string(),
  name: z.string(),
  importance: z.string(),
  difficulty: z.string().optional(),
  page_references: z.array(z.number()).optional(),
});
export type CoverageConcept = z.infer<typeof CoverageConceptSchema>;

export const CoverageDataSchema = z.object({
  total_pages: z.number(),
  document_type: z.string().nullable().optional(),
  concept_catalog: z.array(CoverageConceptSchema).optional(),
  relation_catalog: z.array(z.record(z.string(), z.unknown())).optional(),
  covered_pages: z.array(z.number()).optional(),
  uncovered_pages: z.array(z.number()).optional(),
  covered_page_count: z.number().optional(),
  page_coverage_pct: z.number().optional(),
  saturated_pages: z.array(z.number()).optional(),
  explicit_concept_count: z.number().optional(),
  explicit_concept_coverage_pct: z.number().optional(),
  covered_concept_ids: z.array(z.string()).optional(),
  covered_concept_count: z.number().optional(),
  total_concepts: z.number().optional(),
  concept_coverage_pct: z.number().optional(),
  explicit_relation_count: z.number().optional(),
  covered_relation_count: z.number().optional(),
  total_relations: z.number().optional(),
  relation_coverage_pct: z.number().optional(),
  high_priority_total: z.number().optional(),
  high_priority_covered: z.number().optional(),
  missing_high_priority: z.array(CoverageConceptSchema).optional(),
  uncovered_concepts: z.array(CoverageConceptSchema).optional(),
  uncovered_relations: z.array(z.record(z.string(), z.unknown())).optional(),
});
export type CoverageData = z.infer<typeof CoverageDataSchema>;

// ============================================================================
// Session Data Schema
// ============================================================================

// ============================================================================
// Session response schema used by /session/{session_id}
// ============================================================================

/**
 * Minimal log event schema persisted for sessions.
 * Matches the frontend ProgressEvent shape used throughout the UI.
 */
const SessionLogEventTypeSchema = z.enum([
  'session_start',
  'status',
  'info',
  'warning',
  'error',
  'progress_start',
  'progress_update',
  'card',
  'note_created',
  'note_updated',
  'note_recreated',
  'cards_replaced',
  'done',
  'cancelled',
  'step_start',
  'step_end',
  'control_snapshot',
]);

const SessionLogEventSchema = z.object({
  type: SessionLogEventTypeSchema,
  message: z.string(),
  timestamp: z.number(),
  data: z.unknown().optional(),
});

const SessionNotFoundSchema = z.object({
  session_id: z.string(),
  not_found: z.literal(true),
  cards: z.array(CardSchema).default([]),
}).strict();

const SessionEntryStatusSchema = z.enum([
  'draft',
  'completed',
  'error',
  'cancelled',
]);

const SessionEntrySchema = z.object({
  // Core identifiers
  id: z.string(),
  session_id: z.string(),
  not_found: z.literal(false).optional(),

  // Metadata (history row)
  filename: z.string().optional(),
  full_path: z.string().optional(),
  deck: z.string().optional(),
  deck_name: z.string().optional(),
  date: z.string().optional(),
  last_modified: z.string().nullable().optional(),
  slide_set_name: z.string().optional(),
  model_name: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),

  // State
  status: SessionEntryStatusSchema,
  card_count: z.number().optional(),

  // Payload
  cards: z.array(CardSchema),
  logs: z.array(SessionLogEventSchema).optional(),
  total_pages: z.number().nullable().optional(),
  coverage_data: CoverageDataSchema.nullable().optional(),
}).strict();

/**
 * `/session/{session_id}` can return either a full DB entry or a not-found sentinel payload.
 * Validate both explicitly so downstream orchestration never relies on untyped passthrough fields.
 */
export const SessionResponseSchema = z.union([SessionNotFoundSchema, SessionEntrySchema]);
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

// Backward-compatible names used throughout the frontend codebase.
export const SessionDataSchema = SessionResponseSchema;
export type SessionData = SessionResponse;

// ============================================================================
// History Schema
// ============================================================================

export const HistoryEntrySchema = z.object({
  id: z.string(),
  session_id: z.string(),
  filename: z.string(),
  full_path: z.string(),
  deck: z.string(),
  date: z.string(),
  card_count: z.number(),
  status: z.enum(['draft', 'completed', 'error', 'cancelled']),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const HistoryResponseSchema = z.array(HistoryEntrySchema);
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

// ============================================================================
// Generic Response Schemas
// ============================================================================

export const GenericSuccessSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});
export type GenericSuccess = z.infer<typeof GenericSuccessSchema>;

export const StopResponseSchema = z.object({
  stopped: z.boolean(),
  session_id: z.string().optional(),
  message: z.string().optional(),
});
export type StopResponse = z.infer<typeof StopResponseSchema>;

// ============================================================================
// Write Operation Response Schemas
// ============================================================================

export const SaveConfigResponseSchema = z.object({
  success: z.boolean().optional(),
  gemini_api_key_set: z.boolean().optional(),
}).passthrough();
export type SaveConfigResponse = z.infer<typeof SaveConfigResponseSchema>;

export const DeleteResponseSchema = z.object({
  success: z.boolean(),
  deleted: z.number().optional(),
});
export type DeleteResponse = z.infer<typeof DeleteResponseSchema>;

/** Backend history endpoints return status-based responses (not success/deleted) */
export const HistoryClearResponseSchema = z.object({
  status: z.literal('cleared'),
});
export type HistoryClearResponse = z.infer<typeof HistoryClearResponseSchema>;

export const HistoryDeleteResponseSchema = z.object({
  status: z.literal('deleted'),
});
export type HistoryDeleteResponse = z.infer<typeof HistoryDeleteResponseSchema>;

export const HistoryBatchDeleteResponseSchema = z.object({
  status: z.literal('deleted'),
  count: z.number(),
});
export type HistoryBatchDeleteResponse = z.infer<typeof HistoryBatchDeleteResponseSchema>;

const AnkiDeleteResponseSchema = z.object({
  status: z.literal('deleted'),
  count: z.number(),
});

const AnkiUpdateResponseSchema = z.object({
  status: z.literal('updated'),
  note_id: z.number(),
});

export const AnkiNoteResponseSchema = z.union([
  AnkiDeleteResponseSchema,
  AnkiUpdateResponseSchema,
]);
export type AnkiNoteResponse = z.infer<typeof AnkiNoteResponseSchema>;
