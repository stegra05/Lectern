/**
 * The generation pipeline — Lectern's brain.
 *
 * Three phases over one server-side Gemini conversation (Interactions API):
 *   1. mapping     — whole PDF in, global concept map out (thinking: high)
 *   2. generating  — agentic tool loop: the model calls submit_cards, every
 *                    batch is quality-gated and deduped, and the tool result
 *                    feeds back verdicts + a fresh coverage ledger so the
 *                    model plans the next batch itself (thinking: low, the
 *                    3.5-Flash agentic mode)
 *   3. reflecting  — agentic review loop: the model edits the deck through
 *                    update_card / add_cards / remove_cards, each edit gated
 *                    like generation, until finish_review (thinking: medium)
 *
 * No transport layer: progress is emitted as PipelineEvents via a plain
 * callback, which the UI store consumes directly.
 */

import {
  GEMINI_PRICING,
  MAX_GENERATION_ROUNDS,
  MAX_REFLECTION_ROUNDS,
  NON_PROGRESS_MAX_ROUNDS,
  REFLECTION_MAX_REMOVAL_RATIO,
  THINKING_BY_PHASE,
} from './config'
import {
  buildCoverageCatalog,
  buildGenerationGapText,
  buildReflectionGapText,
  computeCoverageData,
  isCoverageSufficient,
} from './coverage'
import {
  GeminiClient,
  parseJsonPayload,
  type FunctionCallStep,
  type GeminiUsage,
  type InputPart,
} from './gemini'
import {
  ADD_CARDS_TOOL,
  CONCEPT_MAP_RESPONSE_SCHEMA,
  FINISH_GENERATION_TOOL,
  FINISH_REVIEW_TOOL,
  REMOVE_CARDS_TOOL,
  SUBMIT_CARDS_TOOL,
  UPDATE_CARD_TOOL,
  parseConceptMap,
  parseRemoveCardsArgs,
  parseSubmitCardsArgs,
  parseUpdateCardArgs,
} from './geminiSchemas'
import { computeSizingPlan } from './pacing'
import {
  buildReviewFeedback,
  buildSubmitFeedback,
  conceptMapPrompt,
  generationMissionPrompt,
  reviewMissionPrompt,
  systemInstructions,
  type PromptContext,
} from './prompts'
import {
  cardKey,
  evaluateCard,
  normalizeCardPayload,
  normalizeRelationKey,
  type NormalizedCardPayload,
} from './quality'
import type {
  Card,
  ConceptMap,
  CoverageCatalog,
  CoverageData,
  GateVerdict,
  PdfInfo,
  PipelineSink,
  SizingPlan,
} from './types'

export interface PipelineOptions {
  pdfBytes: Uint8Array
  pdfInfo: PdfInfo
  fileName: string
  focusPrompt?: string
  /** User override for total deck size; otherwise sized from the document. */
  userTargetCards?: number
  model: string
  apiKey: string
  fetchFn: typeof fetch
  emit: PipelineSink
  signal?: AbortSignal
}

export interface PipelineOutcome {
  cards: Card[]
  conceptMap: ConceptMap
  coverage: CoverageData
  usage: GeminiUsage & { costUsd: number }
  terminationReason: string
}

export async function runPipeline(opts: PipelineOptions): Promise<PipelineOutcome> {
  const { emit, signal } = opts
  const client = new GeminiClient(opts.apiKey, opts.fetchFn)
  const usage: GeminiUsage = { inputTokens: 0, outputTokens: 0 }
  const track = (u: GeminiUsage) => {
    usage.inputTokens += u.inputTokens
    usage.outputTokens += u.outputTokens
  }

  // --- Phase 0: upload ------------------------------------------------------
  emit({ type: 'phase', phase: 'uploading' })
  emit({ type: 'log', level: 'info', message: `Uploading ${opts.fileName} to Gemini…` })
  const file = await client.uploadPdf(opts.pdfBytes, opts.fileName, signal)
  throwIfAborted(signal)

  // --- Phase 1: concept map -------------------------------------------------
  emit({ type: 'phase', phase: 'mapping' })
  emit({ type: 'log', level: 'info', message: 'Building the global concept map…' })

  let ctx: PromptContext = { language: 'en', focusPrompt: opts.focusPrompt }
  const mapResult = await client.interact({
    model: opts.model,
    instructions: systemInstructions(ctx),
    input: [
      { type: 'document', uri: file.uri, mime_type: file.mimeType },
      { type: 'text', text: conceptMapPrompt(ctx) },
    ],
    responseSchema: CONCEPT_MAP_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    thinkingLevel: THINKING_BY_PHASE.mapping,
    signal,
  })
  track(mapResult.usage)
  const conceptMap = parseConceptMap(parseJsonPayload(mapResult.outputText))
  ctx = { language: conceptMap.language || 'en', focusPrompt: opts.focusPrompt }

  const sizing = computeSizingPlan(reconcilePdfInfo(opts.pdfInfo, conceptMap), {
    userTargetCards: opts.userTargetCards,
    forceMode:
      conceptMap.documentType === 'script'
        ? 'script'
        : conceptMap.documentType === 'slides'
          ? 'slides'
          : undefined,
  })
  const catalog = buildCoverageCatalog(conceptMap)
  emit({ type: 'concept_map', conceptMap, sizing })
  emit({
    type: 'log',
    level: 'info',
    message: `Mapped ${conceptMap.concepts.length} concepts, ${conceptMap.relations.length} relations · target ${sizing.totalCardCap} cards`,
  })

  // --- Phase 2: agentic generation loop -------------------------------------
  emit({ type: 'phase', phase: 'generating' })
  const cards: Card[] = []
  const seenKeys = new Set<string>()
  let coverage = computeCoverageData(catalog, cards)
  let terminationReason = 'max_rounds_reached'
  let nonProgressRounds = 0
  let finished = false
  /** Tool results built but not yet sent when the loop exits — the review
   *  phase leads with them so no function call is left unanswered. */
  let pendingResults: InputPart[] = []

  const tools = [SUBMIT_CARDS_TOOL, FINISH_GENERATION_TOOL]
  let response = await client.interact({
    model: opts.model,
    instructions: systemInstructions(ctx),
    previousInteractionId: mapResult.id,
    input: [
      {
        type: 'text',
        text: generationMissionPrompt(ctx, {
          totalCardCap: sizing.totalCardCap,
          batchSize: sizing.batchSize,
          gapText: buildGenerationGapText(catalog, coverage),
        }),
      },
    ],
    tools,
    toolChoice: 'any',
    thinkingLevel: THINKING_BY_PHASE.generating,
    signal,
  })
  track(response.usage)

  for (let round = 1; round <= MAX_GENERATION_ROUNDS && !finished; round++) {
    throwIfAborted(signal)

    if (response.functionCalls.length === 0) {
      // Model answered in prose despite tool_choice — nudge once, then bail.
      nonProgressRounds++
      if (nonProgressRounds >= NON_PROGRESS_MAX_ROUNDS) {
        terminationReason = 'model_stalled'
        emit({
          type: 'log',
          level: 'warn',
          message: 'Model stopped calling tools; ending generation.',
        })
        break
      }
      response = await client.interact({
        model: opts.model,
        instructions: systemInstructions(ctx),
        previousInteractionId: response.id,
        input: [
          {
            type: 'text',
            text: 'Continue: call submit_cards with the next batch, or finish_generation if coverage is complete.',
          },
        ],
        tools,
        toolChoice: 'any',
        thinkingLevel: THINKING_BY_PHASE.generating,
        signal,
      })
      track(response.usage)
      continue
    }

    const results: InputPart[] = []
    let acceptedThisRound = 0

    for (const call of response.functionCalls) {
      if (call.name === 'finish_generation') {
        const verdict = handleFinishRequest(coverage, cards.length, sizing)
        if (verdict.allowed) {
          finished = true
          terminationReason = 'coverage_sufficient_model_done'
          results.push(functionResult(call, 'Accepted. Generation complete.'))
        } else {
          emit({
            type: 'log',
            level: 'warn',
            message: 'Model tried to finish early — coverage gaps remain, continuing.',
          })
          results.push(functionResult(call, verdict.message))
        }
        continue
      }

      if (call.name !== 'submit_cards') {
        results.push(
          functionResult(call, `Unknown tool ${call.name}. Use submit_cards or finish_generation.`),
        )
        continue
      }

      const rawCards = parseSubmitCardsArgs(call.arguments)
      const rejected: Array<{ front: string; reasons: string[] }> = []
      let duplicates = 0
      let unknownMetadataDropped = 0

      for (const raw of rawCards) {
        const normalized = normalizeCardPayload(raw)
        if (!normalized) {
          rejected.push({ front: '(unparseable card)', reasons: ['invalid_structure'] })
          continue
        }
        const { card, verdict, unknownMetadata } = buildCard(normalized, catalog)
        unknownMetadataDropped += unknownMetadata

        const key = cardKey(card)
        if (seenKeys.has(key)) {
          duplicates++
          continue
        }
        if (!verdict.pass) {
          rejected.push({ front: firstField(card), reasons: verdict.failures })
          continue
        }
        if (cards.length >= sizing.totalCardCap) {
          rejected.push({ front: firstField(card), reasons: ['budget_exhausted'] })
          continue
        }
        seenKeys.add(key)
        cards.push(card)
        acceptedThisRound++
        emit({ type: 'card_accepted', card })
      }

      for (const r of rejected) emit({ type: 'card_rejected', front: r.front, reasons: r.reasons })

      coverage = computeCoverageData(catalog, cards)
      emit({ type: 'coverage', coverage })
      emit({ type: 'progress', produced: cards.length, cap: sizing.totalCardCap, round })

      const capacityLeft = sizing.totalCardCap - cards.length
      results.push(
        functionResult(
          call,
          buildSubmitFeedback({
            acceptedCount: acceptedThisRound,
            rejected,
            duplicates,
            unknownMetadataDropped,
            cardsRemaining: capacityLeft,
            gapText: buildGenerationGapText(catalog, coverage),
            finishAllowed: isCoverageSufficient(coverage) || capacityLeft <= 0,
          }),
        ),
      )
    }

    pendingResults = results
    if (finished) break

    if (cards.length >= sizing.totalCardCap) {
      terminationReason = 'max_cap_reached'
      break
    }
    nonProgressRounds = acceptedThisRound === 0 ? nonProgressRounds + 1 : 0
    if (nonProgressRounds >= NON_PROGRESS_MAX_ROUNDS) {
      terminationReason = 'non_progress'
      emit({
        type: 'log',
        level: 'warn',
        message: 'Two rounds without accepted cards — stopping generation.',
      })
      break
    }

    response = await client.interact({
      model: opts.model,
      instructions: systemInstructions(ctx),
      previousInteractionId: response.id,
      input: results,
      tools,
      toolChoice: 'any',
      thinkingLevel: THINKING_BY_PHASE.generating,
      signal,
    })
    pendingResults = []
    track(response.usage)
  }

  // --- Phase 3: agentic review loop over the deck -----------------------------
  if (cards.length > 0) {
    throwIfAborted(signal)
    emit({ type: 'phase', phase: 'reflecting' })
    emit({ type: 'log', level: 'info', message: 'Reviewing the deck for quality and coverage…' })
    const review = await runReviewLoop({
      client,
      model: opts.model,
      ctx,
      previousInteractionId: response.id,
      pendingInput: pendingResults,
      cards,
      seenKeys,
      catalog,
      cardCap: sizing.totalCardCap,
      emit,
      signal,
      track,
    })
    coverage = computeCoverageData(catalog, cards)
    emit({
      type: 'log',
      level: 'info',
      message: `Review: ${review.updated} updated, ${review.added} added, ${review.removed} removed.`,
    })
    emit({ type: 'cards_replaced', cards: [...cards], reflectionNote: review.note })
    emit({ type: 'coverage', coverage })
  }

  // --- Complete ----------------------------------------------------------------
  const [inPrice, outPrice] = GEMINI_PRICING[opts.model] ?? GEMINI_PRICING.default
  const costUsd = (usage.inputTokens * inPrice + usage.outputTokens * outPrice) / 1_000_000
  emit({ type: 'usage', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd })
  emit({ type: 'phase', phase: 'complete' })
  const summary = summarize(terminationReason, cards.length, coverage)
  emit({ type: 'done', reason: terminationReason, summary })

  return { cards, conceptMap, coverage, usage: { ...usage, costUsd }, terminationReason }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reconcilePdfInfo(pdfInfo: PdfInfo, conceptMap: ConceptMap): PdfInfo {
  return {
    pageCount: pdfInfo.pageCount || conceptMap.pageCount,
    textChars: Math.max(pdfInfo.textChars, conceptMap.estimatedTextChars),
    imageCount: pdfInfo.imageCount,
  }
}

function handleFinishRequest(
  coverage: CoverageData,
  produced: number,
  sizing: SizingPlan,
): { allowed: boolean; message: string } {
  if (produced >= sizing.totalCardCap || isCoverageSufficient(coverage)) {
    return { allowed: true, message: 'ok' }
  }
  const missing = coverage.missingHighPriority.length
  return {
    allowed: false,
    message:
      `Rejected: coverage is not sufficient yet (${missing} high-importance concept(s) uncovered, ` +
      `page coverage ${Math.round(coverage.pageCoveragePercent)}%). ` +
      'Continue with submit_cards targeting the remaining ledger gaps.',
  }
}

/**
 * Materialize a normalized model payload into a Card: concept ids and
 * relation keys are validated against the concept-map catalog (unknown ones
 * are dropped so the coverage ledger stays truthful), then the card is
 * annotated with its gate verdict.
 */
function buildCard(
  normalized: NormalizedCardPayload,
  catalog: CoverageCatalog,
): { card: Card; verdict: GateVerdict; unknownMetadata: number } {
  const conceptIds = normalized.conceptIds.filter((id) => catalog.conceptIds.has(id))
  const relationKeys = normalized.relationKeys
    .map((key) => normalizeRelationKey(key))
    .filter((key) => key !== '' && catalog.relationKeys.has(key))
  const unknownMetadata =
    normalized.conceptIds.length -
    conceptIds.length +
    (normalized.relationKeys.length - relationKeys.length)

  const card: Card = {
    uid: crypto.randomUUID(),
    modelName: normalized.modelName,
    fields: normalized.fields,
    slideTopic: normalized.slideTopic,
    slideNumber: normalized.slideNumber,
    sourcePages: normalized.sourcePages,
    conceptIds,
    relationKeys,
    rationale: normalized.rationale,
    sourceExcerpt: normalized.sourceExcerpt,
    qualityScore: 0,
    qualityIssues: [],
  }
  const verdict = evaluateCard(card)
  card.qualityScore = verdict.score
  card.qualityIssues = verdict.issues
  return { card, verdict, unknownMetadata }
}

function functionResult(call: FunctionCallStep, text: string): InputPart {
  return {
    type: 'function_result',
    name: call.name,
    call_id: call.id,
    result: [{ type: 'text', text }],
  }
}

function firstField(card: Card): string {
  const first = card.fields.Front ?? card.fields.Text ?? Object.values(card.fields)[0] ?? ''
  return first.replace(/<[^>]+>/g, '').slice(0, 120)
}

// ---------------------------------------------------------------------------
// Phase 3 — agentic review loop
// ---------------------------------------------------------------------------

const REVIEW_TOOLS = [UPDATE_CARD_TOOL, ADD_CARDS_TOOL, REMOVE_CARDS_TOOL, FINISH_REVIEW_TOOL]

interface ReviewLoopOptions {
  client: GeminiClient
  model: string
  ctx: PromptContext
  previousInteractionId: string
  /** Unanswered function results from the generation loop, sent first. */
  pendingInput: InputPart[]
  /** The deck — edited in place. */
  cards: Card[]
  /** Dedupe keys of the deck — kept in sync with edits. */
  seenKeys: Set<string>
  catalog: CoverageCatalog
  /** The sizing cap — add_cards only fills slots below it. */
  cardCap: number
  emit: PipelineSink
  signal?: AbortSignal
  track: (u: GeminiUsage) => void
}

interface ReviewOutcome {
  note?: string
  updated: number
  added: number
  removed: number
}

/**
 * The model edits the deck through targeted tools; every edit clears the same
 * gate as generation, is applied immediately, and the tool result carries the
 * verdict plus a fresh coverage ledger. Cards keep their uid across updates
 * so downstream identity (UI, Anki sync) is stable.
 */
async function runReviewLoop(opts: ReviewLoopOptions): Promise<ReviewOutcome> {
  const { client, cards, seenKeys, catalog, emit, signal } = opts

  // Short stable handles for the prompt: card_id -> uid.
  const idToUid = new Map<string, string>()
  let nextId = 0
  const assignId = (uid: string): string => {
    const id = `c${++nextId}`
    idToUid.set(id, uid)
    return id
  }
  const deckListing = cards
    .map((card) => JSON.stringify(toReviewShape(assignId(card.uid), card)))
    .join('\n')

  const removalBudget = Math.floor(cards.length * REFLECTION_MAX_REMOVAL_RATIO)
  const outcome: ReviewOutcome = { updated: 0, added: 0, removed: 0 }
  let coverage = computeCoverageData(catalog, cards)
  let finished = false
  let idleRounds = 0

  const indexOfId = (cardId: string): number => {
    const uid = idToUid.get(cardId)
    return uid === undefined ? -1 : cards.findIndex((c) => c.uid === uid)
  }

  let response = await client.interact({
    model: opts.model,
    instructions: systemInstructions(opts.ctx),
    previousInteractionId: opts.previousInteractionId,
    input: [
      ...opts.pendingInput,
      {
        type: 'text',
        text: reviewMissionPrompt(opts.ctx, {
          deckListing,
          coverageGaps: buildReflectionGapText(catalog, coverage),
          cardCap: opts.cardCap,
          freeSlots: Math.max(0, opts.cardCap - cards.length),
        }),
      },
    ],
    tools: REVIEW_TOOLS,
    toolChoice: 'any',
    thinkingLevel: THINKING_BY_PHASE.reflecting,
    signal,
  })
  opts.track(response.usage)

  for (let round = 1; round <= MAX_REFLECTION_ROUNDS && !finished; round++) {
    throwIfAborted(signal)
    if (response.functionCalls.length === 0) break // prose instead of tools — accept the deck

    const results: InputPart[] = []
    let editsThisRound = 0

    for (const call of response.functionCalls) {
      if (call.name === 'finish_review') {
        finished = true
        const args = (call.arguments ?? {}) as Record<string, unknown>
        outcome.note = typeof args.summary === 'string' ? args.summary : undefined
        results.push(functionResult(call, 'Review complete.'))
        continue
      }

      const applied: string[] = []
      const rejected: Array<{ ref: string; reasons: string[] }> = []

      if (call.name === 'update_card') {
        const { cardId, card: rawCard } = parseUpdateCardArgs(call.arguments)
        const index = indexOfId(cardId)
        const normalized = index === -1 ? null : normalizeCardPayload(rawCard)
        if (index === -1) {
          rejected.push({ ref: cardId || 'update_card', reasons: ['unknown_card_id'] })
        } else if (!normalized) {
          rejected.push({ ref: cardId, reasons: ['invalid_structure'] })
        } else {
          const { card, verdict } = buildCard(normalized, catalog)
          const oldKey = cardKey(cards[index])
          const newKey = cardKey(card)
          if (!verdict.pass) {
            rejected.push({ ref: cardId, reasons: verdict.failures })
          } else if (newKey !== oldKey && seenKeys.has(newKey)) {
            rejected.push({ ref: cardId, reasons: ['duplicate'] })
          } else {
            card.uid = cards[index].uid
            seenKeys.delete(oldKey)
            seenKeys.add(newKey)
            cards[index] = card
            outcome.updated++
            editsThisRound++
            applied.push(`updated ${cardId}`)
          }
        }
      } else if (call.name === 'add_cards') {
        for (const raw of parseSubmitCardsArgs(call.arguments)) {
          const normalized = normalizeCardPayload(raw)
          if (!normalized) {
            rejected.push({ ref: '(new card)', reasons: ['invalid_structure'] })
            continue
          }
          const { card, verdict } = buildCard(normalized, catalog)
          if (!verdict.pass) {
            rejected.push({ ref: firstField(card), reasons: verdict.failures })
            continue
          }
          const key = cardKey(card)
          if (seenKeys.has(key)) {
            rejected.push({ ref: firstField(card), reasons: ['duplicate'] })
            continue
          }
          if (cards.length >= opts.cardCap) {
            rejected.push({ ref: firstField(card), reasons: ['budget_exhausted'] })
            continue
          }
          seenKeys.add(key)
          cards.push(card)
          outcome.added++
          editsThisRound++
          applied.push(`added ${assignId(card.uid)}`)
        }
      } else if (call.name === 'remove_cards') {
        const { cardIds } = parseRemoveCardsArgs(call.arguments)
        for (const cardId of cardIds) {
          const index = indexOfId(cardId)
          if (index === -1) {
            rejected.push({ ref: cardId, reasons: ['unknown_card_id'] })
            continue
          }
          if (outcome.removed >= removalBudget) {
            rejected.push({ ref: cardId, reasons: ['removal_budget_exhausted'] })
            continue
          }
          seenKeys.delete(cardKey(cards[index]))
          cards.splice(index, 1)
          idToUid.delete(cardId)
          outcome.removed++
          editsThisRound++
          applied.push(`removed ${cardId}`)
        }
      } else {
        results.push(
          functionResult(
            call,
            `Unknown tool ${call.name}. Use update_card, add_cards, remove_cards, or finish_review.`,
          ),
        )
        continue
      }

      coverage = computeCoverageData(catalog, cards)
      emit({ type: 'coverage', coverage })
      results.push(
        functionResult(
          call,
          buildReviewFeedback({
            applied,
            rejected,
            gapText: buildReflectionGapText(catalog, coverage),
          }),
        ),
      )
    }

    if (finished) break
    idleRounds = editsThisRound === 0 ? idleRounds + 1 : 0
    if (idleRounds >= NON_PROGRESS_MAX_ROUNDS) {
      emit({ type: 'log', level: 'warn', message: 'Review made no progress — accepting the deck.' })
      break
    }

    response = await client.interact({
      model: opts.model,
      instructions: systemInstructions(opts.ctx),
      previousInteractionId: response.id,
      input: results,
      tools: REVIEW_TOOLS,
      toolChoice: 'any',
      thinkingLevel: THINKING_BY_PHASE.reflecting,
      signal,
    })
    opts.track(response.usage)
  }

  return outcome
}

/** Compact card shape listed in the review mission prompt. */
function toReviewShape(cardId: string, card: Card): Record<string, unknown> {
  return {
    card_id: cardId,
    model_name: card.modelName,
    fields: Object.entries(card.fields).map(([name, value]) => ({ name, value })),
    slide_topic: card.slideTopic,
    slide_number: card.slideNumber,
    source_pages: card.sourcePages,
    concept_ids: card.conceptIds,
    relation_keys: card.relationKeys,
    rationale: card.rationale,
    source_excerpt: card.sourceExcerpt,
  }
}

function summarize(reason: string, cardCount: number, coverage: CoverageData): string {
  const reasonText: Record<string, string> = {
    coverage_sufficient_model_done: 'Coverage complete',
    max_cap_reached: 'Card budget reached',
    non_progress: 'Stopped after repeated empty rounds',
    model_stalled: 'Model stopped producing cards',
    max_rounds_reached: 'Round limit reached',
  }
  return (
    `${reasonText[reason] ?? reason} — ${cardCount} cards, ` +
    `${Math.round(coverage.pageCoveragePercent)}% page coverage, ` +
    `${Math.round(coverage.effectiveConceptCoveragePercent)}% concept coverage.`
  )
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError')
}
