/**
 * Follow-up requests — the post-completion chat in the activity log.
 *
 * After the pipeline completes, the user can ask for additional cards in
 * natural language ("add cards on X", "emphasize Y"). The request continues
 * the same server-side Gemini conversation — the model still holds the
 * document, the concept map, and the review history — as a small agentic
 * loop: add_cards batches pass the same quality gate as generation and are
 * deduped against the existing deck. Additions only; existing cards are
 * never touched.
 *
 * Cards the model declares outside the document (in_source=false) pass a
 * relaxed gate, carry the outside_source flag, and start excluded from the
 * Anki sync until the user opts them in.
 */

import {
  FOLLOWUP_CARD_CAP,
  GEMINI_PRICING,
  MAX_FOLLOWUP_ROUNDS,
  NON_PROGRESS_MAX_ROUNDS,
  THINKING_BY_PHASE,
} from './config'
import { buildCoverageCatalog, buildGenerationGapText, computeCoverageData } from './coverage'
import { GeminiClient, type GeminiUsage, type InputPart } from './gemini'
import { FINISH_REQUEST_TOOL, FOLLOWUP_ADD_CARDS_TOOL, parseSubmitCardsArgs } from './geminiSchemas'
import {
  buildCard,
  closeUnansweredCalls,
  firstField,
  functionResult,
  type FollowUpSeed,
} from './pipeline'
import {
  buildFollowUpFeedback,
  followUpRequestPrompt,
  MAX_REQUEST_PROMPT_LEN,
  sanitizeFocusPrompt,
  systemInstructions,
  type PromptContext,
} from './prompts'
import { cardKey, normalizeCardPayload } from './quality'
import type { Card, ConceptMap, PipelineSink } from './types'

export interface FollowUpOptions {
  /** The user's free-text request from the activity-log composer. */
  request: string
  /** Current deck snapshot — used for dedupe and the prompt listing only,
   *  never mutated. Additions arrive as card_accepted events. */
  deck: Card[]
  conceptMap: ConceptMap
  seed: FollowUpSeed
  focusPrompt?: string
  model: string
  apiKey: string
  fetchFn: typeof fetch
  emit: PipelineSink
  signal?: AbortSignal
}

export interface FollowUpOutcome {
  added: Card[]
  outsideSourceCount: number
  /** The model's closing summary from finish_request, when given. */
  note?: string
  /** Continuation handle for the next request. */
  seed: FollowUpSeed
  usage: GeminiUsage & { costUsd: number }
}

export async function runFollowUp(opts: FollowUpOptions): Promise<FollowUpOutcome> {
  const { emit, signal } = opts
  const client = new GeminiClient(opts.apiKey, opts.fetchFn)
  const usage: GeminiUsage = { inputTokens: 0, outputTokens: 0 }
  const track = (u: GeminiUsage) => {
    usage.inputTokens += u.inputTokens
    usage.outputTokens += u.outputTokens
  }

  const ctx: PromptContext = {
    language: opts.conceptMap.language || 'en',
    focusPrompt: opts.focusPrompt,
  }
  const request = sanitizeFocusPrompt(opts.request, MAX_REQUEST_PROMPT_LEN)
  const catalog = buildCoverageCatalog(opts.conceptMap)
  const seenKeys = new Set(opts.deck.map(cardKey).filter((key) => key !== ''))
  const added: Card[] = []
  let coverage = computeCoverageData(catalog, opts.deck)
  let note: string | undefined
  let finished = false
  let idleRounds = 0
  let pendingResults: InputPart[] = []

  const tools = [FOLLOWUP_ADD_CARDS_TOOL, FINISH_REQUEST_TOOL]
  let response = await client.interact({
    model: opts.model,
    instructions: systemInstructions(ctx),
    previousInteractionId: opts.seed.interactionId,
    input: [
      ...opts.seed.pendingInput,
      {
        type: 'text',
        text: followUpRequestPrompt(ctx, {
          request,
          deckFronts: opts.deck.map((card) => firstField(card)).filter((front) => front !== ''),
          cardBudget: FOLLOWUP_CARD_CAP,
          gapText: buildGenerationGapText(catalog, coverage),
        }),
      },
    ],
    tools,
    toolChoice: 'any',
    thinkingLevel: THINKING_BY_PHASE.followUp,
    signal,
  })
  track(response.usage)

  for (let round = 1; round <= MAX_FOLLOWUP_ROUNDS && !finished; round++) {
    throwIfAborted(signal)

    if (response.functionCalls.length === 0) {
      idleRounds++
      if (idleRounds >= NON_PROGRESS_MAX_ROUNDS) break
      response = await client.interact({
        model: opts.model,
        instructions: systemInstructions(ctx),
        previousInteractionId: response.id,
        input: [
          {
            type: 'text',
            text: 'Continue: call add_cards with the remaining cards, or finish_request if the request is served.',
          },
        ],
        tools,
        toolChoice: 'any',
        thinkingLevel: THINKING_BY_PHASE.followUp,
        signal,
      })
      track(response.usage)
      continue
    }

    const results: InputPart[] = []
    let acceptedThisRound = 0

    for (const call of response.functionCalls) {
      if (call.name === 'finish_request') {
        finished = true
        const args = (call.arguments ?? {}) as Record<string, unknown>
        note = typeof args.summary === 'string' ? args.summary : undefined
        results.push(functionResult(call, 'Request closed.'))
        continue
      }

      if (call.name !== 'add_cards') {
        results.push(
          functionResult(call, `Unknown tool ${call.name}. Use add_cards or finish_request.`),
        )
        continue
      }

      const rejected: Array<{ front: string; reasons: string[] }> = []
      let duplicates = 0

      for (const raw of parseSubmitCardsArgs(call.arguments)) {
        const normalized = normalizeCardPayload(raw)
        if (!normalized) {
          rejected.push({ front: '(unparseable card)', reasons: ['invalid_structure'] })
          continue
        }
        const { card, verdict } = buildCard(normalized, catalog, true)
        if (card.outsideSource) card.syncExcluded = true

        const key = cardKey(card)
        if (seenKeys.has(key)) {
          duplicates++
          continue
        }
        if (!verdict.pass) {
          rejected.push({ front: firstField(card), reasons: verdict.failures })
          continue
        }
        if (added.length >= FOLLOWUP_CARD_CAP) {
          rejected.push({ front: firstField(card), reasons: ['budget_exhausted'] })
          continue
        }
        seenKeys.add(key)
        added.push(card)
        acceptedThisRound++
        emit({ type: 'card_accepted', card })
      }

      for (const r of rejected) emit({ type: 'card_rejected', front: r.front, reasons: r.reasons })

      coverage = computeCoverageData(catalog, [...opts.deck, ...added])
      emit({ type: 'coverage', coverage })
      results.push(
        functionResult(
          call,
          buildFollowUpFeedback({
            acceptedCount: acceptedThisRound,
            rejected,
            duplicates,
            cardsRemaining: FOLLOWUP_CARD_CAP - added.length,
          }),
        ),
      )
    }

    pendingResults = results
    if (finished) break
    if (added.length >= FOLLOWUP_CARD_CAP) break
    idleRounds = acceptedThisRound === 0 ? idleRounds + 1 : 0
    if (idleRounds >= NON_PROGRESS_MAX_ROUNDS) break

    response = await client.interact({
      model: opts.model,
      instructions: systemInstructions(ctx),
      previousInteractionId: response.id,
      input: results,
      tools,
      toolChoice: 'any',
      thinkingLevel: THINKING_BY_PHASE.followUp,
      signal,
    })
    pendingResults = []
    track(response.usage)
  }

  const [inPrice, outPrice] = GEMINI_PRICING[opts.model] ?? GEMINI_PRICING.default
  const costUsd = (usage.inputTokens * inPrice + usage.outputTokens * outPrice) / 1_000_000

  return {
    added,
    outsideSourceCount: added.filter((card) => card.outsideSource).length,
    note,
    seed: {
      interactionId: response.id,
      pendingInput: closeUnansweredCalls(response, pendingResults),
    },
    usage: { ...usage, costUsd },
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
}
