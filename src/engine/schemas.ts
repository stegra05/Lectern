/**
 * JSON Schemas sent to the model (tool parameters + structured output) and
 * the tolerant zod parsers for what comes back.
 *
 * Two hard-won conventions carried over from the original app:
 *  - Card fields are a LIST of {name, value} pairs, not a map: structured
 *    output is far more reliable with this shape.
 *  - Never write `additionalProperties`: Gemini rejects it. Adapters whose
 *    provider wants it (Claude's structured output) add it on the way out.
 */

import { z } from 'zod'
import { CONCEPT_CARD_BUDGET_MAX } from './config'
import type { ConceptMap } from './types'

// ---------------------------------------------------------------------------
// Schemas sent to the model
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
    facet_ids: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Ids of the concept-map facets this card tests, from the facet catalog, e.g. c-a#2.',
    },
    relation_keys: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
    source_excerpt: { type: 'string' },
  },
  required: ['model_name', 'fields', 'source_pages', 'rationale', 'source_excerpt'],
} as const

export const SUBMIT_CARDS_TOOL = {
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
  name: 'finish_generation',
  description:
    'Declare card generation complete. Only call when the coverage ledger shows no important gaps remain or the card budget is spent.',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string' },
      coverage_assessment: {
        type: 'string',
        description:
          'One-paragraph assessment of what the deck covers and what was deliberately left out.',
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
          facets: {
            type: 'array',
            items: { type: 'string' },
            description:
              'The distinct facts the material gives this concept to test, each a 2-6 word label (e.g. "HPV 16/18 high-risk types", "E6/E7 inactivate p53/pRb"). One card tests one facet. Most concepts have one; list another only when the material holds a separate fact worth its own card, at most four.',
          },
        },
        required: ['id', 'name', 'importance', 'difficulty', 'page_references', 'facets'],
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

// --- Review-phase tools (agentic edit loop over the generated deck) ---------

export const UPDATE_CARD_TOOL = {
  name: 'update_card',
  description:
    'Replace the content of one existing card, identified by its card_id from the deck listing. The replacement passes the same quality gate as new cards.',
  parameters: {
    type: 'object',
    properties: {
      card_id: { type: 'string' },
      card: CARD_JSON_SCHEMA,
    },
    required: ['card_id', 'card'],
  },
}

export const ADD_CARDS_TOOL = {
  name: 'add_cards',
  description:
    'Add new cards to the deck, e.g. to close coverage gaps or replace a merged pair. Same schema and quality gate as generation.',
  parameters: {
    type: 'object',
    properties: {
      cards: { type: 'array', items: CARD_JSON_SCHEMA },
    },
    required: ['cards'],
  },
}

export const REMOVE_CARDS_TOOL = {
  name: 'remove_cards',
  description: 'Delete cards from the deck by card_id: redundant, ungrounded, or low-value cards.',
  parameters: {
    type: 'object',
    properties: {
      card_ids: { type: 'array', items: { type: 'string' } },
      reason: { type: 'string' },
    },
    required: ['card_ids', 'reason'],
  },
}

// --- Follow-up request tools (post-completion "more cards" chat) ------------

/** Follow-up card schema: the base card plus an explicit grounding
 *  declaration. Kept out of the generation/review schemas so the main
 *  pipeline cannot use it to dodge the grounding gate. */
const FOLLOWUP_CARD_JSON_SCHEMA = {
  ...CARD_JSON_SCHEMA,
  properties: {
    ...CARD_JSON_SCHEMA.properties,
    in_source: {
      type: 'boolean',
      description:
        'False when the card content is not present in the uploaded document. Such cards keep source_pages empty and are labeled "outside source" in the app.',
    },
  },
} as const

export const ADD_REQUESTED_CARDS_TOOL = {
  name: 'add_requested_cards',
  description:
    'Add new cards fulfilling the user request. Same schema and quality gate as generation; declare in_source=false on any card whose content the document does not contain.',
  parameters: {
    type: 'object',
    properties: {
      cards: { type: 'array', items: FOLLOWUP_CARD_JSON_SCHEMA },
    },
    required: ['cards'],
  },
}

export const FINISH_REQUEST_TOOL = {
  name: 'finish_request',
  description:
    'Declare the user request handled. Call once the requested cards are added, or immediately when the request needs no new cards.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          'One or two sentences addressed to the user: what was added, what was left out and why. Markdown is rendered.',
      },
    },
    required: ['summary'],
  },
}

export const FINISH_REVIEW_TOOL = {
  name: 'finish_review',
  description:
    'Declare the quality review complete. Call once the deck is sound: no redundant, vague, or ungrounded cards remain and coverage gaps are closed or explicitly accepted.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          'One-paragraph assessment of the final deck quality, for the student. State coverage as the latest ledger reports it and name what is left out; never claim every concept is covered unless the ledger shows no gaps. Markdown is rendered: **bold**, *italic*, `code`, and "- " bullet lists.',
      },
    },
    required: ['summary'],
  },
}

// --- The session's tool set -----------------------------------------------
// Declared whole on every turn of a conversation: Claude binds its reasoning
// to the exact tool set and every provider's prompt cache keys on it. Each
// phase names the subset it may call.

export const SESSION_TOOLS = [
  SUBMIT_CARDS_TOOL,
  FINISH_GENERATION_TOOL,
  UPDATE_CARD_TOOL,
  ADD_CARDS_TOOL,
  REMOVE_CARDS_TOOL,
  FINISH_REVIEW_TOOL,
  ADD_REQUESTED_CARDS_TOOL,
  FINISH_REQUEST_TOOL,
]

const namesOf = (...tools: Array<{ name: string }>): string[] => tools.map((tool) => tool.name)

export const GENERATION_TOOLS = namesOf(SUBMIT_CARDS_TOOL, FINISH_GENERATION_TOOL)
export const REVIEW_TOOLS = namesOf(
  UPDATE_CARD_TOOL,
  ADD_CARDS_TOOL,
  REMOVE_CARDS_TOOL,
  FINISH_REVIEW_TOOL,
)
export const FOLLOWUP_TOOLS = namesOf(ADD_REQUESTED_CARDS_TOOL, FINISH_REQUEST_TOOL)

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
  facets: z.array(z.string()).catch([]),
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

const cleanFacets = (raw: string[]): string[] =>
  raw
    .map((facet) => facet.trim())
    .filter((facet) => facet !== '')
    .slice(0, CONCEPT_CARD_BUDGET_MAX)

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
      facets: cleanFacets(c.facets),
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

const updateCardArgsZ = z.object({
  card_id: z.string().catch(''),
  card: z.unknown(),
})

/** Extract {cardId, card} from update_card tool-call arguments. */
export function parseUpdateCardArgs(raw: unknown): { cardId: string; card: unknown } {
  const result = updateCardArgsZ.safeParse(raw)
  return result.success
    ? { cardId: result.data.card_id, card: result.data.card }
    : { cardId: '', card: undefined }
}

const removeCardsArgsZ = z.object({
  card_ids: z.array(z.string()).catch([]),
  reason: z.string().catch(''),
})

/** Extract {cardIds, reason} from remove_cards tool-call arguments. */
export function parseRemoveCardsArgs(raw: unknown): { cardIds: string[]; reason: string } {
  const result = removeCardsArgsZ.safeParse(raw)
  return result.success
    ? { cardIds: result.data.card_ids, reason: result.data.reason }
    : { cardIds: [], reason: '' }
}
