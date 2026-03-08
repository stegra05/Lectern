/**
 * Zod schemas for SSE event validation.
 *
 * These schemas validate the structure of server-sent events from the backend
 * to catch type mismatches early and prevent silent failures.
 */
import { z } from 'zod';

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

// Schema for card event data
// Note: Using strict() to catch typos in field names - extra fields will cause validation to fail
export const CardDataSchema = z.object({
  front: z.string().optional(),
  back: z.string().optional(),
  text: z.string().optional(),
  anki_note_id: z.number().optional(),
  fields: z.record(z.string()).optional(),
  model_name: z.string().optional(),
  slide_number: z.number().optional(),
  source_pages: z.array(z.number()).optional(),
  concept_ids: z.array(z.string()).optional(),
  relation_keys: z.array(z.string()).optional(),
  slide_topic: z.string().optional(),
  rationale: z.string().optional(),
  source_excerpt: z.string().optional(),
  quality_score: z.number().optional(),
  quality_flags: z.array(z.string()).optional(),
  tag: z.string().optional(),
  _uid: z.string().optional(),
}).strict();

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
