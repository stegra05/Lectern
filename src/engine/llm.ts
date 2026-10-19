/**
 * The provider-neutral surface the pipeline talks to. Each provider adapter
 * (gemini.ts, openai.ts, anthropic.ts) maps it onto its own API; the pipeline
 * never sees a wire shape.
 *
 * A conversation is an opaque value threaded from turn to turn. Gemini and
 * OpenAI keep the history server-side and the value is just an id; Claude's
 * API is stateless, so its value carries the transcript itself.
 */

import {
  RATE_LIMIT_MAX_RETRIES,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  type ProviderId,
  type ThinkingLevel,
} from './config'
import type { RetryNotice } from './types'

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

export interface Usage {
  /** Every input token, cached or not. */
  inputTokens: number
  /** The part of inputTokens served from the provider's prompt cache. */
  cachedInputTokens: number
  /** The part of inputTokens written to the prompt cache (Claude bills a
   *  premium for it; the others report none). */
  cacheWriteTokens: number
  /** Output tokens, thinking included: every provider bills it as output. */
  outputTokens: number
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  }
}

export interface ToolCall {
  /** Call id: echoed back in the tool_result that answers it. */
  id: string
  name: string
  arguments: unknown
}

export interface ToolDeclaration {
  name: string
  description: string
  /** JSON Schema, written without `additionalProperties` (Gemini rejects it). */
  parameters: Record<string, unknown>
}

/** An uploaded document, referenced by later turns. */
export interface DocumentRef {
  /** Gemini: the file uri. OpenAI and Claude: the file id. */
  id: string
  mimeType: string
}

export type InputPart =
  | { type: 'text'; text: string }
  | { type: 'document'; document: DocumentRef }
  | { type: 'tool_result'; callId: string; name: string; text: string }

/** Where a conversation stands after a turn. Opaque to the pipeline. */
export type Conversation =
  | { provider: 'gemini'; interactionId: string }
  | { provider: 'openai'; responseId: string }
  | {
      provider: 'anthropic'
      messages: unknown[]
      /** The top-level effort, fixed by the first turn. */
      baseEffort: ThinkingLevel
      /** The effort in force, after any per-message changes. */
      effort: ThinkingLevel
    }

export interface TurnRequest {
  model: string
  /** System prompt. Sent with every turn: not every provider carries it over. */
  instructions?: string
  /** Absent on the first turn of a conversation. */
  conversation?: Conversation
  input: InputPart[]
  /** The conversation's whole tool set, identical on every turn: Claude
   *  binds its reasoning to it, and every provider's prompt cache keys on it. */
  tools?: ToolDeclaration[]
  /** Names of the tools callable this turn; none when absent. */
  activeTools?: readonly string[]
  /** Ask the model to answer with an active tool. Providers that cannot force
   *  one fall back to letting it choose; the loops nudge a prose answer. */
  requireTool?: boolean
  effort?: ThinkingLevel
  /** JSON Schema the text answer must follow. */
  responseSchema?: Record<string, unknown>
  signal?: AbortSignal
}

export interface TurnResult {
  conversation: Conversation
  outputText: string
  toolCalls: ToolCall[]
  usage: Usage
}

export interface LlmClient {
  readonly provider: ProviderId
  uploadPdf(data: Uint8Array, displayName: string, signal?: AbortSignal): Promise<DocumentRef>
  /** Remove an upload from the provider. Gone already counts as done. */
  deleteDocument(document: DocumentRef): Promise<void>
  turn(req: TurnRequest): Promise<TurnResult>
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * What went wrong, in terms the UI can act on. The adapters only classify;
 * the words the student reads live in src/lib/problems.ts.
 */
export type LlmErrorKind =
  /** 401/403, or a 400 that names the key: fix it in Settings. */
  | 'key_rejected'
  /** A per-day quota: waiting will not help today. */
  | 'quota_daily'
  /** Per-minute rate limiting that outlasted every retry. */
  | 'rate_limited'
  /** A spending cap, an empty balance or another billing problem. */
  | 'spending_cap'
  /** 5xx that outlasted every retry. */
  | 'server'
  /** The connection dropped and kept dropping. */
  | 'network'
  /** The model answered, but not in a shape Lectern can use. */
  | 'bad_response'
  /** The provider could not process the uploaded PDF. */
  | 'pdf_rejected'
  /** The provider took too long to process the uploaded PDF. */
  | 'pdf_timeout'
  /** The model declined the request on policy grounds. */
  | 'refused'
  /** Any other refusal; the message carries the provider's own words. */
  | 'request_rejected'

/** Failures that can clear up by themselves, and so are worth a retry. */
const TRANSIENT_KINDS = new Set<LlmErrorKind>([
  'rate_limited',
  'server',
  'network',
  'bad_response',
  'pdf_timeout',
])

export const isTransient = (kind: LlmErrorKind): boolean => TRANSIENT_KINDS.has(kind)

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly kind: LlmErrorKind,
    public readonly provider: ProviderId,
    /** How long the provider asked us to wait, when it said. */
    public readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

/** Quota errors name their window; a daily one will not clear by waiting. */
export const isDailyQuota = (message: string): boolean =>
  /per\s*day|perday|daily/i.test(message) && /quota|limit/i.test(message)

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

export type RetryListener = (notice: RetryNotice) => void

/**
 * Run `attempt` until it succeeds, retrying transient LlmErrors with
 * exponential backoff (or the wait the provider named). `toError` turns
 * whatever the attempt threw into an LlmError; aborts pass straight through.
 * Each wait is announced first: silent retries make a stalled run look like
 * a hung one, and the UI shows these in the activity log.
 */
export async function withRetry<T>(
  attempt: () => Promise<T>,
  toError: (e: unknown) => LlmError,
  onRetry: RetryListener | undefined,
  signal?: AbortSignal,
): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await attempt()
    } catch (e) {
      // SDKs wrap a cancelled request in their own error class; the app
      // knows a cancel by the standard AbortError.
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      if (isAbortError(e)) throw e
      const error = toError(e)
      // A daily quota or a spending cap will not clear in the next few
      // minutes; retrying only made the student wait for the same answer.
      if (!isTransient(error.kind) || n === RATE_LIMIT_MAX_RETRIES) throw error
      const backoff = Math.min(
        RETRY_BASE_DELAY_MS * 2 ** n * (1 + Math.random() * 0.1),
        RETRY_MAX_DELAY_MS,
      )
      const waitMs =
        error.retryAfterMs !== undefined && error.retryAfterMs > 0 ? error.retryAfterMs : backoff
      onRetry?.({
        status: error.status,
        attempt: n + 1,
        maxAttempts: RATE_LIMIT_MAX_RETRIES,
        waitMs,
      })
      await sleep(waitMs, signal)
    }
  }
}

export const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError'

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'))
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Parse a JSON object out of a structured-output text response. */
export function parseJsonPayload(text: string, provider: ProviderId): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // Some models wrap JSON in fences despite instructions — salvage.
    const match = trimmed.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new LlmError('response was not valid JSON', 0, 'bad_response', provider)
  }
}
