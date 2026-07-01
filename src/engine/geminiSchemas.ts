/**
 * JSON Schemas sent to Gemini (tool parameters + response_format) and the
 * tolerant zod parsers for what comes back.
 *
 * Two hard-won conventions carried over from the original app:
 *  - Card fields are a LIST of {name, value} pairs, not a map — Gemini's
 *    structured output is far more reliable with this shape.
 *  - Never send `additionalProperties` — Gemini rejects it, so schemas are
 *    written by hand without it.
 */

import { z } from 'zod'
import type { ConceptMap } from './types'

// ---------------------------------------------------------------------------
// Schemas sent to Gemini
// ---------------------------------------------------------------------------

const CARD_JSON_SCHEMA = {
  type: 'object',
  properties: {
    model_name: { type: 'string', enum: ['Basic', 'Cloze'] },
    fields: {
      type: 'array',
      description: 'Anki note fields. Basic: Front, Back. Cloze: Text.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'string' },
        },
        required: ['name', 'value'],
      },
    },
    slide_topic: { type: 'string' },
    slide_number: { type: 'integer' },
    source_pages: { type: 'array', items: { type: 'integer' } },
    concept_ids: { type: 'array', items: { type: 'string' } },
    relation_keys: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
    source_excerpt: { type: 'string' },
  },
  required: ['model_name', 'fields', 'source_pages', 'rationale', 'source_excerpt'],
} as const

export const SUBMIT_CARDS_TOOL = {
  type: 'function' as const,
  name: 'submit_cards',
  description:
    'Submit a batch of flashcards for review. Returns accepted/rejected verdicts with reasons and an updated coverage ledger to plan the next batch.',
  parameters: {
    type: 'object',
    properties: {
      cards: { type: 'array', items: CARD_JSON_SCHEMA },
    },
    required: ['cards'],
  },
}

export const FINISH_GENERATION_TOOL = {
  type: 'function' as const,
  name: 'finish_generation',
  description:
    'Declare card generation complete. Only call when the coverage ledger shows no important gaps remain or the card budget is spent.',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string' },
      coverage_assessment: {
        type: 'string',
        description: 'One-paragraph assessment of what the deck covers and what was deliberately left out.',
      },
    },
    required: ['reason'],
  },
}

export const CONCEPT_MAP_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    objectives: { type: 'array', items: { type: 'string' } },
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          importance: { type: 'string', enum: ['high', 'medium', 'low'] },
          difficulty: {
            type: 'string',
            enum: ['foundational', 'intermediate', 'advanced'],
          },
          page_references: { type: 'array', items: { type: 'integer' } },
        },
        required: ['id', 'name', 'importance', 'difficulty', 'page_references'],
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          type: { type: 'string' },
          target: { type: 'string' },
          page_references: { type: 'array', items: { type: 'integer' } },
        },
        required: ['source', 'type', 'target'],
      },
    },
    language: { type: 'string' },
    slide_set_name: { type: 'string' },
    page_count: { type: 'integer' },
    estimated_text_chars: { type: 'integer' },
    document_type: { type: 'string', enum: ['slides', 'script', 'mixed'] },
  },
  required: [
    'objectives',
    'concepts',
    'relations',
    'language',
    'slide_set_name',
    'page_count',
    'estimated_text_chars',
    'document_type',
  ],
} as const

export const REFLECTION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reflection: { type: 'string' },
    cards: { type: 'array', items: CARD_JSON_SCHEMA },
    done: { type: 'boolean' },
  },
  required: ['reflection', 'cards', 'done'],
} as const

// ---------------------------------------------------------------------------
// Tolerant zod parsers for model output
// ---------------------------------------------------------------------------

const int = z.coerce.number().int()

const conceptZ = z.object({
  id: z.string(),
  name: z.string(),
  importance: z.enum(['high', 'medium', 'low']).catch('medium'),
  difficulty: z.enum(['foundational', 'intermediate', 'advanced']).catch('intermediate'),
  page_references: z.array(int).catch([]),
})

const relationZ = z.object({
  source: z.string(),
  type: z.string(),
  target: z.string(),
  page_references: z.array(int).catch([]).default([]),
})

const conceptMapZ = z.object({
  objectives: z.array(z.string()).catch([]),
  concepts: z.array(conceptZ),
  relations: z.array(relationZ).catch([]),
  language: z.string().catch('en'),
  slide_set_name: z.string().catch('Untitled Slide Set'),
  page_count: int.catch(0),
  estimated_text_chars: int.catch(0),
  document_type: z.enum(['slides', 'script', 'mixed']).catch('slides'),
})

export function parseConceptMap(raw: unknown): ConceptMap {
  const data = conceptMapZ.parse(raw)
  return {
    objectives: data.objectives,
    concepts: data.concepts.map((c) => ({
      id: c.id,
      name: c.name,
      importance: c.importance,
      difficulty: c.difficulty,
      pageReferences: c.page_references,
    })),
    relations: data.relations.map((r) => ({
      source: r.source,
      type: r.type,
      target: r.target,
      pageReferences: r.page_references,
    })),
    language: data.language,
    slideSetName: data.slide_set_name,
    pageCount: data.page_count,
    estimatedTextChars: data.estimated_text_chars,
    documentType: data.document_type,
  }
}

const submitCardsArgsZ = z.object({
  cards: z.array(z.unknown()).catch([]),
})

/** Extract the raw card list from submit_cards tool-call arguments. */
export function parseSubmitCardsArgs(raw: unknown): unknown[] {
  const result = submitCardsArgsZ.safeParse(raw)
  return result.success ? result.data.cards : []
}

const reflectionZ = z.object({
  reflection: z.string().catch(''),
  cards: z.array(z.unknown()).catch([]),
  done: z.boolean().catch(true),
})

export function parseReflection(raw: unknown): {
  reflection: string
  cards: unknown[]
  done: boolean
} {
  const result = reflectionZ.safeParse(raw)
  return result.success ? result.data : { reflection: '', cards: [], done: true }
}
