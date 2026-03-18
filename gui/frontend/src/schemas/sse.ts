/**
 * Zod schemas for SSE event validation.
 *
 * These schemas validate the structure of server-sent events from the backend
 * to catch type mismatches early and prevent silent failures.
 */
import { z } from 'zod';
import { CoverageDataSchema } from './api';

// Base schema for all progress events
const BaseProgressEventSchema = z.object({
  type: z.string(),
  message: z.string(),
  data: z.unknown().optional(),
  timestamp: z.number(),
});

// Schema for progress_start event data
export const ProgressStartDataSchema = z.object({
  total: z.number(),
  phase: z.string().optional(),
  label: z.string().optional(),
});

// Schema for progress_update event data
export const ProgressUpdateDataSchema = z.object({
  current: z.number(),
  total: z.number().optional(),
  phase: z.string().optional(),
});

// Schema for card event data — passthrough allows internal metadata (quality_score, etc.)
export const CardDataSchema = z.object({
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
  _uid: z.string().optional(),
}).passthrough();

// Schema for note_created/note_updated/note_recreated event data
export const NoteEventDataSchema = z.object({
  note_id: z.number(),
  index: z.number().optional(),
});

// Schema for session_start event data
export const SessionStartDataSchema = z.object({
  session_id: z.string(),
});

// Schema for step_start/step_end event data
export const StepDataSchema = z.object({
  step: z.string(),
  label: z.string().optional(),
});

// Schema for done event data
export const DoneDataSchema = z.object({
  card_count: z.number().optional(),
  sync_count: z.number().optional(),
  message: z.string().optional(),
}).optional();

// ============================================================================
// Additional event.data schemas used by the orchestrator
// ============================================================================

/** `card` event payload: `{ card: <Card> }` */
export const CardEventDataSchema = z.object({
  card: CardDataSchema,
});
export type CardEventData = z.infer<typeof CardEventDataSchema>;

/** `cards_replaced` payload: `{ cards?: Card[], coverage_data?: CoverageData }` */
export const CardsReplacedDataSchema = z.object({
  cards: z.array(CardDataSchema).optional(),
  coverage_data: CoverageDataSchema.optional(),
}).passthrough();
export type CardsReplacedData = z.infer<typeof CardsReplacedDataSchema>;

/** `step_end` payload: `{ page_count?: number, coverage_data?: CoverageData }` */
export const StepEndDataSchema = z.object({
  page_count: z.number().optional(),
  coverage_data: CoverageDataSchema.optional(),
}).passthrough();
export type StepEndData = z.infer<typeof StepEndDataSchema>;

/** `done` payload: may include totals and coverage. */
export const GenerationDoneDataSchema = z.object({
  total_pages: z.number().optional(),
  coverage_data: CoverageDataSchema.optional(),
}).passthrough();
export type GenerationDoneData = z.infer<typeof GenerationDoneDataSchema>;

/** Sync stream `done` payload: `{ failed?: number, created?: number, cards?: Card[] }` */
export const SyncDoneDataSchema = z.object({
  failed: z.number().optional(),
  created: z.number().optional(),
  cards: z.array(CardDataSchema).optional(),
}).passthrough();
export type SyncDoneData = z.infer<typeof SyncDoneDataSchema>;

/** `control_snapshot` payload. */
export const ControlSnapshotDataSchema = z.object({
  session_id: z.string(),
  timestamp: z.number(),
  status: z.string(),
  progress: z.object({ current: z.number(), total: z.number() }),
  concept_progress: z.object({ current: z.number(), total: z.number() }),
  card_count: z.number(),
  total_pages: z.number(),
  coverage_data: CoverageDataSchema.nullable(),
  is_error: z.boolean(),
  error_message: z.string().nullable(),
}).passthrough();
export type ControlSnapshotData = z.infer<typeof ControlSnapshotDataSchema>;

// Validated event types
export type ProgressStartData = z.infer<typeof ProgressStartDataSchema>;
export type ProgressUpdateData = z.infer<typeof ProgressUpdateDataSchema>;
export type CardData = z.infer<typeof CardDataSchema>;
export type NoteEventData = z.infer<typeof NoteEventDataSchema>;
export type SessionStartData = z.infer<typeof SessionStartDataSchema>;
export type StepData = z.infer<typeof StepDataSchema>;

/**
 * Validate a progress_start event's data field.
 * Returns the validated data or null if validation fails.
 */
export function validateProgressStartData(data: unknown): ProgressStartData | null {
  const result = ProgressStartDataSchema.safeParse(data);
  if (!result.success) {
    console.warn('Invalid progress_start event data:', result.error.message);
    return null;
  }
  return result.data;
}

/**
 * Validate a progress_update event's data field.
 * Returns the validated data or null if validation fails.
 */
export function validateProgressUpdateData(data: unknown): ProgressUpdateData | null {
  const result = ProgressUpdateDataSchema.safeParse(data);
  if (!result.success) {
    console.warn('Invalid progress_update event data:', result.error.message);
    return null;
  }
  return result.data;
}

/**
 * Validate a card event's data field.
 * Returns the validated data or null if validation fails.
 */
export function validateCardData(data: unknown): CardData | null {
  const result = CardDataSchema.safeParse(data);
  if (!result.success) {
    console.warn('Invalid card event data:', result.error.message);
    return null;
  }
  return result.data;
}

export function validateCardEventData(data: unknown): CardEventData | null {
  const result = CardEventDataSchema.safeParse(data);
  if (!result.success) {
    console.warn('Invalid card payload:', result.error.message);
    return null;
  }
  return result.data;
}

export function validateCardsReplacedData(data: unknown): CardsReplacedData | null {
  const result = CardsReplacedDataSchema.safeParse(data);
  if (!result.success) {
    console.warn('Invalid cards_replaced payload:', result.error.message);
    return null;
  }
  return result.data;
}

export function validateStepEndData(data: unknown): StepEndData | null {
  const result = StepEndDataSchema.safeParse(data);
  if (!result.success) {
    console.warn('Invalid step_end payload:', result.error.message);
    return null;
  }
  return result.data;
}

export function validateGenerationDoneData(data: unknown): GenerationDoneData | null {
  const result = GenerationDoneDataSchema.safeParse(data);
  if (!result.success) {
    console.warn('Invalid done payload (generation):', result.error.message);
    return null;
  }
  return result.data;
}

export function validateSyncDoneData(data: unknown): SyncDoneData | null {
  const result = SyncDoneDataSchema.safeParse(data);
  if (!result.success) {
    console.warn('Invalid done payload (sync):', result.error.message);
    return null;
  }
  return result.data;
}

export function validateControlSnapshotData(data: unknown): ControlSnapshotData | null {
  const result = ControlSnapshotDataSchema.safeParse(data);
  if (!result.success) {
    console.warn('Invalid control_snapshot payload:', result.error.message);
    return null;
  }
  return result.data;
}

/**
 * Validate a note event's data field.
 * Returns the validated data or null if validation fails.
 */
export function validateNoteEventData(data: unknown): NoteEventData | null {
  const result = NoteEventDataSchema.safeParse(data);
  if (!result.success) {
    console.warn('Invalid note event data:', result.error.message);
    return null;
  }
  return result.data;
}

/**
 * Validate a session_start event's data field.
 * Returns the validated data or null if validation fails.
 */
export function validateSessionStartData(data: unknown): SessionStartData | null {
  const result = SessionStartDataSchema.safeParse(data);
  if (!result.success) {
    console.warn('Invalid session_start event data:', result.error.message);
    return null;
  }
  return result.data;
}

/**
 * Validate a step event's data field.
 * Returns the validated data or null if validation fails.
 */
export function validateStepData(data: unknown): StepData | null {
  const result = StepDataSchema.safeParse(data);
  if (!result.success) {
    console.warn('Invalid step event data:', result.error.message);
    return null;
  }
  return result.data;
}

/**
 * Check if a raw event has the basic structure of a ProgressEvent.
 * Use this for initial filtering before type-specific validation.
 */
export function isValidProgressEvent(event: unknown): event is { type: string; message: string; timestamp: number } {
  const result = BaseProgressEventSchema.safeParse(event);
  return result.success;
}

/** Known progress event types from backend NDJSON streams */
const ProgressEventTypeSchema = z.enum([
  'session_start', 'session_resumed', 'status', 'info', 'warning', 'error',
  'progress_start', 'progress_update', 'card', 'note', 'note_created', 'note_updated', 'note_recreated',
  'cards_replaced', 'done', 'cancelled', 'step_start', 'step_end', 'control_snapshot',
]);

/**
 * Full schema for NDJSON progress events at the network boundary.
 * Validates structure before events enter the orchestrator.
 */
export const ProgressEventSchema = z.object({
  type: ProgressEventTypeSchema,
  message: z.string(),
  data: z.unknown().optional(),
  timestamp: z.number(),
});
export type ValidatedProgressEvent = z.infer<typeof ProgressEventSchema>;
