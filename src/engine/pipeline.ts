/**
 * The generation pipeline — Lectern's brain.
 *
 * Three phases over one server-side Gemini conversation (Interactions API):
 *   1. mapping     — whole PDF in, global concept map out (thinking: high)
 *   2. generating  — agentic tool loop: the model calls submit_cards, every
 *                    batch is quality-gated and deduped, and the tool result
 *                    feeds back verdicts + a fresh coverage ledger so the
 *                    model plans the next batch itself (thinking: medium)
 *   3. reflecting  — QA pass rewrites weak cards, gated + greedily selected
 *                    for maximum coverage gain (thinking: high)
 *
 * No transport layer: progress is emitted as PipelineEvents via a plain
 * callback, which the UI store consumes directly.
 */

import {
  GEMINI_PRICING,
  GROUNDING_GATE_MIN_QUALITY,
  MAX_GENERATION_ROUNDS,
  MAX_REFLECTION_ROUNDS,
  NON_PROGRESS_MAX_ROUNDS,
  REFLECTION_HARD_CAP_MULTIPLIER,
  REFLECTION_HARD_CAP_PADDING,
  THINKING_BY_PHASE,
} from './config'
import {
  buildCoverageCatalog,
  buildGenerationGapText,
  buildReflectionGapText,
  computeCoverageData,
  isCoverageSufficient,
  selectBestReflectionCards,
} from './coverage'
import { GeminiClient, parseJsonPayload, type FunctionCallStep, type GeminiUsage, type InputPart } from './gemini'
import {
  CONCEPT_MAP_RESPONSE_SCHEMA,
  FINISH_GENERATION_TOOL,
  REFLECTION_RESPONSE_SCHEMA,
  SUBMIT_CARDS_TOOL,
  parseConceptMap,
  parseReflection,
  parseSubmitCardsArgs,
} from './geminiSchemas'
import { buildPacingHint, computeSizingPlan } from './pacing'
import {
  buildSubmitFeedback,
  conceptMapPrompt,
  generationMissionPrompt,
  reflectionPrompt,
  systemInstructions,
  type PromptContext,
} from './prompts'
import { cardKey, evaluateGroundingGate, normalizeCardPayload, scoreCard } from './quality'
import type {
  Card,
  ConceptMap,
  CoverageData,
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

  const sizing = computeSizingPlan(
    reconcilePdfInfo(opts.pdfInfo, conceptMap),
    {
      userTargetCards: opts.userTargetCards,
      forceMode: conceptMap.documentType === 'script' ? 'script' : conceptMap.documentType === 'slides' ? 'slides' : undefined,
    },
  )
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
          pacingHint: buildPacingHint(coverage, sizing, 0),
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
        emit({ type: 'log', level: 'warn', message: 'Model stopped calling tools; ending generation.' })
        break
      }
      response = await client.interact({
        model: opts.model,
        instructions: systemInstructions(ctx),
        previousInteractionId: response.id,
        input: [{ type: 'text', text: 'Continue: call submit_cards with the next batch, or finish_generation if coverage is complete.' }],
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
          emit({ type: 'log', level: 'warn', message: 'Model tried to finish early — coverage gaps remain, continuing.' })
          results.push(functionResult(call, verdict.message))
        }
        continue
      }

      if (call.name !== 'submit_cards') {
        results.push(functionResult(call, `Unknown tool ${call.name}. Use submit_cards or finish_generation.`))
        continue
      }

      const rawCards = parseSubmitCardsArgs(call.arguments)
      const rejected: Array<{ front: string; reasons: string[] }> = []
      let duplicates = 0

      for (const raw of rawCards) {
        const normalized = normalizeCardPayload(raw)
        if (!normalized) {
          rejected.push({ front: '(unparseable card)', reasons: ['invalid_structure'] })
          continue
        }
        const card: Card = {
          uid: crypto.randomUUID(),
          modelName: normalized.modelName,
          fields: normalized.fields,
          slideTopic: normalized.slideTopic,
          slideNumber: normalized.slideNumber,
          sourcePages: normalized.sourcePages ?? [],
          conceptIds: normalized.conceptIds ?? [],
          relationKeys: normalized.relationKeys ?? [],
          rationale: normalized.rationale,
          sourceExcerpt: normalized.sourceExcerpt,
          qualityScore: 0,
          qualityIssues: [],
        }
        const { score, issues } = scoreCard(card, catalog)
        card.qualityScore = score
        card.qualityIssues = issues

        const key = cardKey(card)
        if (seenKeys.has(key)) {
          duplicates++
          continue
        }
        const gate = evaluateGroundingGate(card)
        if (!gate.pass) {
          rejected.push({ front: firstField(card), reasons: gate.failures })
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
            cardsRemaining: capacityLeft,
            gapText: buildGenerationGapText(catalog, coverage),
            pacingHint: buildPacingHint(coverage, sizing, cards.length),
            finishAllowed: isCoverageSufficient(coverage) || capacityLeft <= 0,
          }),
        ),
      )
    }

    if (finished) break

    if (cards.length >= sizing.totalCardCap) {
      terminationReason = 'max_cap_reached'
      break
    }
    nonProgressRounds = acceptedThisRound === 0 ? nonProgressRounds + 1 : 0
    if (nonProgressRounds >= NON_PROGRESS_MAX_ROUNDS) {
      terminationReason = 'non_progress'
      emit({ type: 'log', level: 'warn', message: 'Two rounds without accepted cards — stopping generation.' })
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
    track(response.usage)
  }

  // --- Phase 3: reflection ----------------------------------------------------
  let lastInteractionId = response.id
  if (cards.length > 0) {
    emit({ type: 'phase', phase: 'reflecting' })
    const hardCap = Math.round(sizing.totalCardCap * REFLECTION_HARD_CAP_MULTIPLIER) + REFLECTION_HARD_CAP_PADDING
    const rounds = Math.max(1, Math.min(MAX_REFLECTION_ROUNDS, cards.length))

    for (let round = 1; round <= rounds; round++) {
      throwIfAborted(signal)
      emit({ type: 'log', level: 'info', message: `Quality pass ${round}/${rounds}…` })
      const reflectResult = await client.interact({
        model: opts.model,
        instructions: systemInstructions(ctx),
        previousInteractionId: lastInteractionId,
        input: [
          {
            type: 'text',
            text: reflectionPrompt(ctx, {
              limit: hardCap,
              cardsJson: JSON.stringify(cards.map(toReflectionShape)),
              coverageGaps: buildReflectionGapText(catalog, coverage),
            }),
          },
        ],
        responseSchema: REFLECTION_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        thinkingLevel: THINKING_BY_PHASE.reflecting,
        signal,
      })
      track(reflectResult.usage)
      lastInteractionId = reflectResult.id

      const reflection = parseReflection(parseJsonPayload(reflectResult.outputText))
      const proposed: Card[] = []
      for (const raw of reflection.cards) {
        const normalized = normalizeCardPayload(raw)
        if (!normalized) continue
        const card: Card = {
          uid: crypto.randomUUID(),
          modelName: normalized.modelName,
          fields: normalized.fields,
          slideTopic: normalized.slideTopic,
          slideNumber: normalized.slideNumber,
          sourcePages: normalized.sourcePages ?? [],
          conceptIds: normalized.conceptIds ?? [],
          relationKeys: normalized.relationKeys ?? [],
          rationale: normalized.rationale,
          sourceExcerpt: normalized.sourceExcerpt,
          qualityScore: 0,
          qualityIssues: [],
        }
        const { score, issues } = scoreCard(card, catalog)
        card.qualityScore = score
        card.qualityIssues = issues
        // Replacements must clear the same bar as originals.
        if (card.qualityScore >= GROUNDING_GATE_MIN_QUALITY && evaluateGroundingGate(card).pass) {
          proposed.push(card)
        }
      }

      if (proposed.length > 0) {
        const selected = selectBestReflectionCards(cards, proposed, catalog, hardCap)
        cards.splice(0, cards.length, ...selected)
        coverage = computeCoverageData(catalog, cards)
        emit({ type: 'cards_replaced', cards: [...cards], reflectionNote: reflection.reflection })
        emit({ type: 'coverage', coverage })
      }
      if (reflection.done) break
    }
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

/** Compact card shape handed to the reflection prompt. */
function toReflectionShape(card: Card): Record<string, unknown> {
  return {
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
