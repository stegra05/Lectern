import { z } from 'zod';

import type { components } from '../generated/api';

export type HealthStatus = Omit<components['schemas']['HealthResponse'], 'backend_ready'> & {
  backend_ready?: boolean;
  anki_version?: string;
  gemini_model?: string;
};
export type AnkiStatus = components['schemas']['AnkiStatusResponse'];
export type Version = Omit<components['schemas']['VersionResponse'], 'latest'> & {
  latest: string | null;
};

export type Config = Omit<components['schemas']['ConfigResponse'], 'gemini_configured'> & {
  gemini_configured?: boolean;
};

export type DecksResponse = components['schemas']['DeckListResponse'];
export type CreateDeckResponse = components['schemas']['DeckCreateResponse'];

export interface Estimation {
  tokens: number;
  input_tokens: number;
  output_tokens: number;
  input_cost: number;
  output_cost: number;
  cost: number;
  pages: number;
  text_chars?: number;
  model: string;
  suggested_card_count?: number;
  estimated_card_count?: number;
  image_count?: number;
  document_type?: string;
}

export interface Card {
  front?: string;
  back?: string;
  text?: string;
  anki_note_id?: number;
  fields?: Record<string, string>;
  model_name?: string;
  slide_number?: number;
  source_pages?: number[];
  concept_ids?: string[];
  relation_keys?: string[];
  slide_topic?: string;
  rationale?: string;
  source_excerpt?: string;
  tag?: string;
  uid?: string;
  _uid?: string;
  [key: string]: unknown;
}

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

export interface SessionData {
  id?: string;
  session_id: string;
  not_found?: boolean;
  status?: string;
  cards: Card[];
  deck?: string;
  deck_name?: string;
  logs?: Array<{
    type: string;
    message: string;
    timestamp: number;
    data?: unknown;
  }>;
  total_pages?: number | null;
  coverage_data?: CoverageData | null;
  filename?: string;
  full_path?: string;
  date?: string;
  card_count?: number;
  slide_set_name?: string;
  model_name?: string | null;
  tags?: string[];
}

export interface HistoryEntry {
  id: string;
  session_id: string;
  filename: string;
  full_path: string;
  deck: string;
  date: string;
  card_count: number;
  status: string;
}
export type HistoryResponse = HistoryEntry[];

export type StopResponse = Omit<components['schemas']['StopResponse'], 'session_id'> & {
  session_id?: string;
};

export type SaveConfigPayload = components['schemas']['ConfigUpdate'];
export type SaveConfigResponse =
  | components['schemas']['ConfigUpdatedResponse']
  | components['schemas']['ConfigNoChangeResponse']
  | { success?: boolean; gemini_api_key_set?: boolean };

export type HistoryClearResponse = components['schemas']['HistoryClearResponse'];
export type HistoryDeleteResponse = components['schemas']['HistoryDeleteResponse'];
export type HistoryBatchDeleteResponse =
  components['schemas']['HistoryBatchDeleteResponse'];

export type AnkiNoteResponse =
  | components['schemas']['AnkiDeleteResponse']
  | components['schemas']['AnkiUpdateResponse'];
