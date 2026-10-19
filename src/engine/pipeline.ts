/**
 * The generation pipeline — Lectern's brain.
 *
 * Three phases over one model conversation (the provider is the model's; see
 * llm.ts for the neutral surface the phases talk to):
 *   1. mapping     — whole PDF in, global concept map out (thinking: high)
 *   2. generating  — agentic tool loop: the model calls submit_cards, every
 *                    batch is quality-gated and deduped, and the tool result
 *                    feeds back verdicts + a fresh coverage ledger so the
 *                    model plans the next batch itself (thinking: low, the
 *                    Flash agentic mode)
 *   3. reflecting  — agentic review loop: the model edits the deck through
 *                    update_card / add_cards / remove_cards, each edit gated
 *                    like generation, until finish_review (thinking: medium)
 *
 * No transport layer: progress is emitted as PipelineEvents via a plain
 * callback, which the UI store consumes directly.
 */

import { createClient } from './clients'
import {
  EARLY_FINISH_ATTEMPTS,
  MAX_GENERATION_ROUNDS,
  MAX_REFLECTION_ROUNDS,
  NON_PROGRESS_MAX_ROUNDS,
  PROVIDERS,
  REFLECTION_MAX_REMOVAL_RATIO,
  effortFor,
  providerOf,
  type EffortPlan,
  type ThinkingLevel,
  type ThinkingPhase,
} from './config'
import { UsageMeter } from './cost'
import {
  budgetShortfall,
  buildCoverageCatalog,
  buildDepthGapText,
  buildGenerationGapText,
  buildReflectionGapText,
  computeCoverageData,
  conceptsWithUntestedFacets,
  isCoverageSufficient,
} from './coverage'
import {
  parseJsonPayload,
  type Conversation,
  type InputPart,
  type LlmClient,
  type ToolCall,
  type TurnResult,
  type Usage,
} from './llm'
import {
  CONCEPT_MAP_RESPONSE_SCHEMA,
  GENERATION_TOOLS,
  REVIEW_TOOLS,
  SESSION_TOOLS,
  parseConceptMap,
  parseRemoveCardsArgs,
  parseSubmitCardsArgs,
  parseUpdateCardArgs,
} from './schemas'
import { looksLikeSameSet } from './ankiImport'
import { allocateBudgets, computeSizingPlan, conceptTarget } from './pacing'
import { count } from './plural'
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
  findNearDuplicate,
  normalizeCardPayload,
  normalizeRelationKey,
  type EvaluateOptions,
  type NormalizedCardPayload,
} from './quality'
import type {
  Card,
  CardDensity,
  ConceptMap,
  CoverageCatalog,
  CoverageData,
  GateVerdict,
  PdfInfo,
  PipelineSink,
  RejectionReason,
} from './types'

export interface PipelineOptions {
  pdfBytes: Uint8Array
  pdfInfo: PdfInfo
  fileName: string
  focusPrompt?: string
  /** How deep the deck goes. The size comes from the concept map's card
   *  budgets at this density; on an extend run, from what the deck lacks. */
  density: CardDensity
  /** Cards already in the target Anki deck (extend runs). They seed the
   *  dedupe set and the coverage ledger so the run fills gaps instead of
   *  repeating work, and are never edited or removed by the model. */
  existingCards?: Card[]
  model: string
  /** Overrides the model's effort per pipeline phase. For evaluation runs;
   *  the app always uses the model's own plan. */
  effort?: Omit<EffortPlan, 'followUp'>
  apiKey: string
  fetchFn: typeof fetch
  emit: PipelineSink
  signal?: AbortSignal
}

/** Handle for continuing the session's conversation after the pipeline
 *  completes (follow-up requests). The model and the focus prompt are the
 *  ones the conversation started on: the provider cannot change mid-way, and
 *  the system prompt built from the focus must not either. `pendingInput`
 *  answers any tool calls the last turn left open; the next request must
 *  lead with them. */
export interface FollowUpSeed {
  model: string
  focusPrompt?: string
  conversation: Conversation
  pendingInput: InputPart[]
}

export interface PipelineOutcome {
  cards: Card[]
  conceptMap: ConceptMap
  coverage: CoverageData
  usage: Usage & { costUsd: number }
  terminationReason: string
  followUp: FollowUpSeed
}

export async function runPipeline(opts: PipelineOptions): Promise<PipelineOutcome> {
  const { emit, signal } = opts
  const client = createClient(providerOf(opts.model), opts.apiKey, opts.fetchFn, (notice) =>
    emit({ type: 'waiting', ...notice }),
  )
  const voice = PROVIDERS[client.provider].voice
  const effort = (phase: Exclude<ThinkingPhase, 'followUp'>): ThinkingLevel =>
    opts.effort?.[phase] ?? effortFor(opts.model, phase)
  const meter = new UsageMeter(opts.model)
  const track = (u: Usage) => meter.add(u)
  // Fixed for the whole conversation, follow-ups included.
  const instructions = systemInstructions(opts.focusPrompt)

  // --- Phase 0: upload ------------------------------------------------------
  emit({ type: 'phase', phase: 'uploading' })
  // Not aborted with the run: a request cut off mid-way can still land on
  // the provider with an id nobody learns. A cancel stops waiting for it;
  // the upload finishes on its own and is reported like any other.
  const upload = client.uploadPdf(opts.pdfBytes, opts.fileName)
  // Reported at once: the upload outlives this run only until the session
  // ends, and whoever ends it has to know what to remove.
  void upload.then(
    (document) => emit({ type: 'document_uploaded', provider: client.provider, document }),
    () => undefined,
  )
  const document = await untilAborted(upload, signal)

  // --- Phase 1: concept map -------------------------------------------------
  emit({ type: 'phase', phase: 'mapping' })

  let ctx: PromptContext = { language: 'en', focusPrompt: opts.focusPrompt }
  const mapResult = await client.turn({
    model: opts.model,
    instructions,
    input: [
      { type: 'document', document },
      { type: 'text', text: conceptMapPrompt(ctx, conceptTarget(opts.pdfInfo)) },
    ],
    tools: SESSION_TOOLS,
    responseSchema: CONCEPT_MAP_RESPONSE_SCHEMA,
    effort: effort('mapping'),
    signal,
  })
  track(mapResult.usage)
  const conceptMap = parseConceptMap(parseJsonPayload(mapResult.outputText, client.provider))
  ctx = { language: conceptMap.language || 'en', focusPrompt: opts.focusPrompt }

  const reconciled = reconcilePdfInfo(opts.pdfInfo, conceptMap)
  // The ledger counts against the pages the file really has, not the page
  // count the model reported for it.
  const budgets = allocateBudgets(conceptMap, opts.density)
  const catalog = buildCoverageCatalog(conceptMap, reconciled.pageCount, budgets)
  // An extend run starts from the deck that is already in Anki: the run's
  // target is what that deck still lacks against the budgets, on top of it.
  const existing = adoptExistingCards(opts.existingCards ?? [], conceptMap.slideSetName)
  const inheritedCount = existing.cards.length
  const budgetSum =
    inheritedCount > 0
      ? budgetShortfall(catalog, computeCoverageData(catalog, existing.cards))
      : [...budgets.values()].reduce((sum, n) => sum + n, 0)
  const sizing = computeSizingPlan(reconciled, {
    density: opts.density,
    budgetSum,
    extending: inheritedCount > 0,
    forceMode:
      conceptMap.documentType === 'script'
        ? 'script'
        : conceptMap.documentType === 'slides'
          ? 'slides'
          : undefined,
  })
  const gateOptions: EvaluateOptions = {
    pageCount: reconciled.pageCount,
    pageTexts: opts.pdfInfo.pageTexts,
  }
  emit({ type: 'concept_map', conceptMap, sizing })
  emit({
    type: 'log',
    level: 'info',
    message:
      `Found ${count(conceptMap.concepts.length, 'concept')} and ` +
      `${count(conceptMap.relations.length, 'link')} between them. ` +
      `Aiming for ${count(sizing.totalCardCap, 'card')}.`,
  })

  // --- Phase 2: agentic generation loop -------------------------------------
  emit({ type: 'phase', phase: 'generating' })
  const cards: Card[] = [...existing.cards]
  const seenKeys = new Set<string>(existing.cards.map((card) => cardKey(card)))
  const cardCap = sizing.totalCardCap + inheritedCount
  let coverage = computeCoverageData(catalog, cards)
  if (inheritedCount > 0) {
    emit({ type: 'coverage', coverage })
    emit({
      type: 'log',
      level: 'info',
      message:
        `The ${count(inheritedCount, 'card')} already in the deck cover ` +
        `${Math.round(coverage.pageCoveragePercent)}% of the pages. This run starts from there.`,
    })
    if (existing.otherDocuments > 0) {
      emit({
        type: 'log',
        level: 'info',
        message:
          `${existing.otherDocuments} of them come from other material in this deck. ` +
          "They still prevent repeats, but don't count toward this lecture's pages.",
      })
    }
  }
  let terminationReason = 'max_rounds_reached'
  let nonProgressRounds = 0
  let finished = false
  /** Tool results built but not yet sent when the loop exits — the review
   *  phase leads with them so no function call is left unanswered. */
  let pendingResults: InputPart[] = []

  // Extending a deck that already covers the document leaves nothing to go
  // outward to, so the run's budget buys depth instead. Recomputed each round:
  // a run can start on breadth and cross into depth once the gaps close.
  const inDepthMode = (): boolean => inheritedCount > 0 && isCoverageSufficient(coverage)
  /** How many times the model has asked to stop while short of budget. */
  let earlyFinishAttempts = 0
  const finishVerdict = () =>
    handleFinishRequest(
      catalog,
      coverage,
      cards.length,
      cardCap,
      earlyFinishAttempts,
      inDepthMode(),
    )
  const ledgerText = () =>
    inDepthMode()
      ? buildDepthGapText(catalog, coverage)
      : buildGenerationGapText(catalog, coverage, cards)

  const generationTurn = (conversation: Conversation, input: InputPart[]) =>
    client.turn({
      model: opts.model,
      instructions,
      conversation,
      input,
      tools: SESSION_TOOLS,
      activeTools: GENERATION_TOOLS,
      requireTool: true,
      effort: effort('generating'),
      signal,
    })
  let response = await generationTurn(mapResult.conversation, [
    {
      type: 'text',
      text: generationMissionPrompt(ctx, {
        totalCardCap: sizing.totalCardCap,
        batchSize: sizing.batchSize,
        gapText: ledgerText(),
        existingDeck: summarizeExistingDeck(existing.cards),
        depthMode: inDepthMode(),
      }),
    },
  ])
  track(response.usage)

  for (let round = 1; round <= MAX_GENERATION_ROUNDS && !finished; round++) {
    throwIfAborted(signal)

    if (response.toolCalls.length === 0) {
      // Model answered in prose despite tool_choice — nudge once, then bail.
      nonProgressRounds++
      if (nonProgressRounds >= NON_PROGRESS_MAX_ROUNDS) {
        terminationReason = 'model_stalled'
        emit({
          type: 'log',
          level: 'warn',
          message: `${voice} stopped producing cards, so generation ends here.`,
        })
        break
      }
      response = await generationTurn(response.conversation, [
        {
          type: 'text',
          text: 'Continue: call submit_cards with the next batch, or finish_generation if coverage is complete.',
        },
      ])
      track(response.usage)
      continue
    }

    const results: InputPart[] = []
    let acceptedThisRound = 0

    for (const call of response.toolCalls) {
      if (call.name === 'finish_generation') {
        const verdict = finishVerdict()
        if (!verdict.allowed) earlyFinishAttempts++
        if (verdict.allowed) {
          finished = true
          terminationReason = 'coverage_sufficient_model_done'
          const args = (call.arguments ?? {}) as Record<string, unknown>
          const assessment =
            typeof args.coverage_assessment === 'string' ? args.coverage_assessment.trim() : ''
          if (assessment) {
            emit({ type: 'log', level: 'info', message: `${voice} on coverage`, quote: assessment })
          }
          results.push(functionResult(call, 'Accepted. Generation complete.'))
        } else {
          emit({
            type: 'log',
            level: 'warn',
            message: `${voice} wanted to stop, but key concepts still have no card. Continuing.`,
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
      const rejected: Array<{ front: string; reasons: RejectionReason[] }> = []
      const duplicateFronts: string[] = []
      let unknownMetadataDropped = 0

      for (const raw of rawCards) {
        const normalized = normalizeCardPayload(raw)
        if (!normalized) {
          rejected.push({ front: '(unparseable card)', reasons: ['invalid_structure'] })
          continue
        }
        const { card, verdict, unknownMetadata } = buildCard(
          normalized,
          catalog,
          false,
          gateOptions,
        )
        unknownMetadataDropped += unknownMetadata

        const key = cardKey(card)
        if (seenKeys.has(key) || findNearDuplicate(key, seenKeys) !== null) {
          duplicateFronts.push(firstField(card))
          continue
        }
        if (!verdict.pass) {
          rejected.push({ front: firstField(card), reasons: verdict.failures })
          continue
        }
        if (cards.length >= cardCap) {
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
      // Progress counts what this run made, not the inherited deck.
      emit({
        type: 'progress',
        produced: cards.length - inheritedCount,
        cap: sizing.totalCardCap,
        round,
      })

      const capacityLeft = cardCap - cards.length
      results.push(
        functionResult(
          call,
          buildSubmitFeedback({
            acceptedCount: acceptedThisRound,
            rejected,
            duplicateFronts,
            unknownMetadataDropped,
            cardsRemaining: capacityLeft,
            gapText: ledgerText(),
            finishAllowed: capacityLeft <= 0 || finishVerdict().allowed,
          }),
        ),
      )
    }

    pendingResults = results
    if (finished) break

    if (cards.length >= cardCap) {
      terminationReason = 'max_cap_reached'
      break
    }
    nonProgressRounds = acceptedThisRound === 0 ? nonProgressRounds + 1 : 0
    if (nonProgressRounds >= NON_PROGRESS_MAX_ROUNDS) {
      terminationReason = 'non_progress'
      emit({
        type: 'log',
        level: 'warn',
        message: 'Two batches in a row gave no usable cards, so generation stops here.',
      })
      break
    }

    response = await generationTurn(response.conversation, results)
    pendingResults = []
    track(response.usage)
  }

  // The loop may exit with function calls it never answered (round budget
  // exhausted); close them so the chain continues from a clean state.
  pendingResults = closeUnansweredCalls(response, pendingResults)
  let followUpSeed: FollowUpSeed = {
    model: opts.model,
    focusPrompt: opts.focusPrompt,
    conversation: response.conversation,
    pendingInput: pendingResults,
  }

  // --- Phase 3: agentic review loop over the deck -----------------------------
  if (cards.length > inheritedCount) {
    throwIfAborted(signal)
    emit({ type: 'phase', phase: 'reflecting' })
    const review = await runReviewLoop({
      client,
      model: opts.model,
      effort: effort('reflecting'),
      instructions,
      ctx,
      conversation: response.conversation,
      pendingInput: pendingResults,
      cards,
      seenKeys,
      catalog,
      cardCap,
      inheritedCount,
      gateOptions,
      emit,
      signal,
      track,
    })
    followUpSeed = {
      model: opts.model,
      focusPrompt: opts.focusPrompt,
      conversation: review.conversation,
      pendingInput: review.pendingInput,
    }
    coverage = computeCoverageData(catalog, cards)
    emit({
      type: 'log',
      level: 'info',
      message: reviewSummary(review),
      quote: review.note,
    })
    emit({ type: 'cards_replaced', cards: [...cards] })
    emit({ type: 'coverage', coverage })
  }

  // --- Complete ----------------------------------------------------------------
  const { usage, costUsd } = meter
  emit({ type: 'usage', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd })
  emit({ type: 'phase', phase: 'complete' })
  const summary = summarize(
    voice,
    terminationReason,
    cards.length - inheritedCount,
    coverage,
    inheritedCount,
  )
  emit({ type: 'done', reason: terminationReason, summary })

  return {
    cards,
    conceptMap,
    coverage,
    usage: { ...usage, costUsd },
    terminationReason,
    followUp: followUpSeed,
  }
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
  catalog: CoverageCatalog,
  coverage: CoverageData,
  produced: number,
  cardCap: number,
  /** Times the model has already asked to stop while short of budget. */
  attempts: number,
  /** Extend runs past breadth: the deck already covered the material. */
  depthMode: boolean,
): { allowed: boolean; message: string } {
  if (produced >= cardCap) return { allowed: true, message: 'ok' }

  if (!isCoverageSufficient(coverage)) {
    const missing = coverage.missingHighPriority.length
    return {
      allowed: false,
      message:
        `Rejected: coverage is not sufficient yet (${count(missing, 'high-importance concept')} uncovered, ` +
        `page coverage ${Math.round(coverage.pageCoveragePercent)}%). ` +
        'Continue with submit_cards targeting the remaining ledger gaps.',
    }
  }

  // A concept with fewer cards than facets has named facts no card tests
  // yet. The run is sent back for them once. Once, because the brief invites
  // an honest short deck: a second request means the model looked and found
  // nothing worth a card there, and the budgets stay a ceiling, never a
  // quota. Thorough's depth slots past the facets never hold a run back.
  const short = conceptsWithUntestedFacets(catalog, coverage)
  if (short.length > 0 && attempts < EARLY_FINISH_ATTEMPTS) {
    const names = short
      .slice(0, 8)
      .map((id) => {
        const facets = catalog.facetsByConcept.get(id) ?? []
        const name = catalog.conceptNames.get(id) ?? id
        return facets.length > 0 ? `${name} (${facets.join('; ')})` : name
      })
      .join(', ')
    return {
      allowed: false,
      message:
        (depthMode
          ? 'Rejected: the deck already covers this material, so this run is for depth. '
          : 'Rejected: ') +
        `${count(short.length, 'concept')} still ${short.length === 1 ? 'has' : 'have'} facets from your concept map that no card tests: ${names}. ` +
        'Give each untested facet its card, without re-asking a fact a card already tests. If, after looking, a card would only rephrase one the deck already has, call finish_generation again and say so; it will be accepted.',
    }
  }

  return { allowed: true, message: 'ok' }
}

/**
 * Materialize a normalized model payload into a Card: concept ids and
 * relation keys are validated against the concept-map catalog (unknown ones
 * are dropped so the coverage ledger stays truthful), then the card is
 * annotated with its gate verdict.
 */
export function buildCard(
  normalized: NormalizedCardPayload,
  catalog: CoverageCatalog,
  /** Follow-up requests only: honor the payload's in_source=false declaration.
   *  Everywhere else the declaration is ignored so it cannot dodge the gate. */
  allowOutsideSource = false,
  /** Document facts the gate checks citations against. */
  gateOptions: EvaluateOptions = {},
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
  if (allowOutsideSource && normalized.inSource === false) card.outsideSource = true
  const verdict = evaluateCard(card, gateOptions)
  card.qualityScore = verdict.score
  card.qualityIssues = verdict.issues
  return { card, verdict, unknownMetadata }
}

export function functionResult(call: ToolCall, text: string): InputPart {
  return { type: 'tool_result', callId: call.id, name: call.name, text }
}

export function firstField(card: Card): string {
  const first = card.fields.Front ?? card.fields.Text ?? Object.values(card.fields)[0] ?? ''
  return first.replace(/<[^>]+>/g, '').slice(0, 120)
}

/**
 * Answer any function calls of `response` that `built` does not already
 * answer. A loop can exit with calls it never processed (round budget
 * exhausted). Every provider requires each call answered before the
 * conversation can continue, so the next phase or follow-up leads with these.
 */
export function closeUnansweredCalls(response: TurnResult, built: InputPart[]): InputPart[] {
  const answered = new Set(
    built.flatMap((part) => (part.type === 'tool_result' ? [part.callId] : [])),
  )
  const closures = response.toolCalls
    .filter((call) => !answered.has(call.id))
    .map((call) =>
      functionResult(
        call,
        'The round budget ran out before this call was processed. The deck stands as accepted.',
      ),
    )
  return [...built, ...closures]
}

// ---------------------------------------------------------------------------
// Phase 3 — agentic review loop
// ---------------------------------------------------------------------------

interface ReviewLoopOptions {
  client: LlmClient
  model: string
  effort: ThinkingLevel
  instructions: string
  ctx: PromptContext
  conversation: Conversation
  /** Unanswered function results from the generation loop, sent first. */
  pendingInput: InputPart[]
  /** The deck — edited in place. */
  cards: Card[]
  /** Dedupe keys of the deck — kept in sync with edits. */
  seenKeys: Set<string>
  catalog: CoverageCatalog
  /** The sizing cap — add_cards only fills slots below it. */
  cardCap: number
  /** Cards inherited from Anki. They sit in `cards` for coverage and dedupe
   *  but are withheld from the review: the model must not rewrite or delete
   *  cards the user has already been studying. */
  inheritedCount: number
  /** Document facts the gate checks citations against. */
  gateOptions: EvaluateOptions
  emit: PipelineSink
  signal?: AbortSignal
  track: (u: Usage) => void
}

interface ReviewOutcome {
  note?: string
  updated: number
  added: number
  removed: number
  /** Where the conversation ends; follow-up requests continue here. */
  conversation: Conversation
  pendingInput: InputPart[]
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
  // Only this run's cards are put up for review; inherited ones are not
  // listed, so no card_id resolves to them and no tool can touch them.
  const reviewable = cards.filter((card) => card.fromAnki !== true)
  const deckListing = reviewable
    .map((card) => JSON.stringify(toReviewShape(assignId(card.uid), card)))
    .join('\n')

  const removalBudget = Math.floor(reviewable.length * REFLECTION_MAX_REMOVAL_RATIO)
  const counts = { updated: 0, added: 0, removed: 0 }
  let note: string | undefined
  let coverage = computeCoverageData(catalog, cards)
  let finished = false
  let idleRounds = 0
  /** Tool results built but not yet sent when the loop exits. */
  let pendingResults: InputPart[] = []

  const indexOfId = (cardId: string): number => {
    const uid = idToUid.get(cardId)
    return uid === undefined ? -1 : cards.findIndex((c) => c.uid === uid)
  }

  const reviewTurn = (conversation: Conversation, input: InputPart[]) =>
    client.turn({
      model: opts.model,
      instructions: opts.instructions,
      conversation,
      input,
      tools: SESSION_TOOLS,
      activeTools: REVIEW_TOOLS,
      requireTool: true,
      effort: opts.effort,
      signal,
    })
  let response = await reviewTurn(opts.conversation, [
    ...opts.pendingInput,
    {
      type: 'text',
      text: reviewMissionPrompt(opts.ctx, {
        deckListing,
        coverageGaps: buildReflectionGapText(catalog, coverage),
        cardCap: opts.cardCap,
        freeSlots: Math.max(0, opts.cardCap - cards.length),
        inheritedCount: opts.inheritedCount,
      }),
    },
  ])
  opts.track(response.usage)

  for (let round = 1; round <= MAX_REFLECTION_ROUNDS && !finished; round++) {
    throwIfAborted(signal)
    if (response.toolCalls.length === 0) break // prose instead of tools: accept the deck

    const results: InputPart[] = []
    let editsThisRound = 0

    for (const call of response.toolCalls) {
      if (call.name === 'finish_review') {
        finished = true
        const args = (call.arguments ?? {}) as Record<string, unknown>
        note = typeof args.summary === 'string' ? args.summary : undefined
        results.push(functionResult(call, 'Review complete.'))
        continue
      }

      const applied: string[] = []
      const rejected: Array<{ ref: string; reasons: string[] }> = []
      let unknownMetadataDropped = 0

      if (call.name === 'update_card') {
        const { cardId, card: rawCard } = parseUpdateCardArgs(call.arguments)
        const index = indexOfId(cardId)
        const normalized = index === -1 ? null : normalizeCardPayload(rawCard)
        if (index === -1) {
          rejected.push({ ref: cardId || 'update_card', reasons: ['unknown_card_id'] })
        } else if (!normalized) {
          rejected.push({ ref: cardId, reasons: ['invalid_structure'] })
        } else {
          const { card, verdict, unknownMetadata } = buildCard(
            normalized,
            catalog,
            false,
            opts.gateOptions,
          )
          unknownMetadataDropped += unknownMetadata
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
            counts.updated++
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
          const { card, verdict, unknownMetadata } = buildCard(
            normalized,
            catalog,
            false,
            opts.gateOptions,
          )
          unknownMetadataDropped += unknownMetadata
          if (!verdict.pass) {
            rejected.push({ ref: firstField(card), reasons: verdict.failures })
            continue
          }
          const key = cardKey(card)
          if (seenKeys.has(key) || findNearDuplicate(key, seenKeys) !== null) {
            rejected.push({ ref: firstField(card), reasons: ['duplicate'] })
            continue
          }
          if (cards.length >= opts.cardCap) {
            rejected.push({ ref: firstField(card), reasons: ['budget_exhausted'] })
            continue
          }
          seenKeys.add(key)
          cards.push(card)
          counts.added++
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
          if (counts.removed >= removalBudget) {
            rejected.push({ ref: cardId, reasons: ['removal_budget_exhausted'] })
            continue
          }
          seenKeys.delete(cardKey(cards[index]))
          cards.splice(index, 1)
          idToUid.delete(cardId)
          counts.removed++
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
            unknownMetadataDropped,
            gapText: buildReflectionGapText(catalog, coverage),
          }),
        ),
      )
    }

    pendingResults = results
    if (finished) break
    idleRounds = editsThisRound === 0 ? idleRounds + 1 : 0
    if (idleRounds >= NON_PROGRESS_MAX_ROUNDS) {
      emit({
        type: 'log',
        level: 'warn',
        message: 'The quality pass stalled, so the deck stays as it is.',
      })
      break
    }

    response = await reviewTurn(response.conversation, results)
    pendingResults = []
    opts.track(response.usage)
  }

  return {
    note,
    ...counts,
    conversation: response.conversation,
    pendingInput: closeUnansweredCalls(response, pendingResults),
  }
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
    // What the gate already noticed about this card. Without it the review
    // has to re-derive by eye what the app measured on the way in.
    quality_issues: card.qualityIssues.length > 0 ? card.qualityIssues : undefined,
  }
}

function summarize(
  voice: string,
  reason: string,
  cardCount: number,
  coverage: CoverageData,
  inheritedCount: number,
): string {
  // Only an early stop is worth a second sentence; reaching the deck size or
  // full coverage is what the first one already reports.
  const earlyStop: Record<string, string> = {
    non_progress: ` ${voice} stopped finding new cards before the deck size was reached.`,
    model_stalled: ` ${voice} stopped finding new cards before the deck size was reached.`,
    max_rounds_reached: ' Generation reached its round limit before the deck size.',
  }
  // An extend run reports what it added and what the deck now holds; the
  // coverage percentages always describe the whole deck.
  const cardText =
    inheritedCount > 0
      ? `${count(cardCount, 'new card')} (${cardCount + inheritedCount} in the deck)`
      : count(cardCount, 'card')
  return (
    `${cardText} ready, covering ${Math.round(coverage.pageCoveragePercent)}% of the pages ` +
    `and ${Math.round(coverage.effectiveConceptCoveragePercent)}% of the concepts.` +
    (earlyStop[reason] ?? '')
  )
}

/** "Quality pass: 2 cards rewritten, 1 removed." or "no changes needed". */
function reviewSummary(review: { updated: number; added: number; removed: number }): string {
  const changes = [
    review.updated > 0 ? `${count(review.updated, 'card')} rewritten` : '',
    review.added > 0 ? `${review.added} added` : '',
    review.removed > 0 ? `${review.removed} removed` : '',
  ].filter(Boolean)
  return changes.length === 0
    ? 'Quality pass: no changes needed.'
    : `Quality pass: ${changes.join(', ')}.`
}

export interface AdoptedDeck {
  cards: Card[]
  /** Cards that came from other material sharing this deck. */
  otherDocuments: number
}

/**
 * Decide what the deck's existing cards are allowed to say about *this*
 * document.
 *
 * A deck can hold several lectures. Page numbers are only meaningful next to
 * the document they were written from, so a card from lecture 2 claiming
 * pages 12–14 must not mark pages 12–14 of lecture 4 as covered — that would
 * silently steer the run away from material nobody has made cards for. Such
 * cards keep their place in the dedupe set (an identical card is still an
 * identical card) but surrender their page references, and with them their
 * slide links in the UI, which pointed at the wrong slides anyway.
 */
export function adoptExistingCards(existing: Card[], slideSetName: string): AdoptedDeck {
  let otherDocuments = 0
  const cards = existing.map((card) => {
    // A card with no recorded document is given the benefit of the doubt: it
    // is far more often this deck's own earlier work than a stranger's.
    if (card.sourceSetName === undefined || looksLikeSameSet(card.sourceSetName, slideSetName)) {
      return card
    }
    otherDocuments++
    return { ...card, sourcePages: [], slideNumber: undefined }
  })
  return { cards, otherDocuments }
}

/** Entries listed in the "already covered" brief; the cap is announced. */
const EXISTING_TOPIC_LIMIT = 25

/**
 * What the deck already teaches, as topics rather than card fronts: it is the
 * question the user actually asks ("which topics have been done?"), and it
 * costs a fraction of the context a full card listing would. Exact repeats are
 * caught by the dedupe set anyway, and the feedback payload names them.
 */
export function summarizeExistingDeck(
  existing: Card[],
): { count: number; topics: string[]; truncated: number } | undefined {
  if (existing.length === 0) return undefined

  const byTopic = new Map<string, number>()
  let untopiced = 0
  for (const card of existing) {
    const topic = card.slideTopic?.trim()
    if (topic === undefined || topic === '') untopiced++
    else byTopic.set(topic, (byTopic.get(topic) ?? 0) + 1)
  }

  const ranked = [...byTopic.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const topics = ranked
    .slice(0, EXISTING_TOPIC_LIMIT)
    .map(([topic, count]) => `${topic} (${count})`)
  if (untopiced > 0) topics.push(`untagged (${untopiced})`)

  return {
    count: existing.length,
    topics,
    truncated: Math.max(0, ranked.length - EXISTING_TOPIC_LIMIT),
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError')
}

/** Wait for `task`, or stop waiting with an AbortError when the run is
 *  cancelled. The task itself keeps going. */
function untilAborted<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Generation cancelled', 'AbortError'))
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}
