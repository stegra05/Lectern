import { z } from 'zod';

export const ApiEventV2TypeSchema = z.enum([
  'session_started',
  'phase_started',
  'progress_updated',
  'card_emitted',
  'cards_replaced',
  'warning_emitted',
  'error_emitted',
  'phase_completed',
  'session_completed',
  'session_cancelled',
]);

export const ApiEventV2Schema = z.object({
  event_version: z.literal(2),
  session_id: z.string(),
  sequence_no: z.number().int().nonnegative(),
  type: ApiEventV2TypeSchema,
  message: z.string(),
  timestamp: z.number(),
  data: z.unknown(),
});

export type ApiEventV2 = z.infer<typeof ApiEventV2Schema>;

