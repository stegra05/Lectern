/**
 * Thin client for the Gemini Interactions API (v1beta) — the agentic surface
 * introduced for Gemini 3.5. Server-side conversation state via
 * `previous_interaction_id` replaces the old app's hand-rolled chat history,
 * pruning, and thought-signature bookkeeping.
 *
 * All HTTP goes through an injected `fetchFn` so the app can pass Tauri's
 * CORS-free fetch while tests pass Node's fetch or mocks.
 */

import {
  FILE_ACTIVE_TIMEOUT_MS,
  GEMINI_API_REVISION,
  GEMINI_BASE_URL,
  RATE_LIMIT_MAX_RETRIES,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  UPLOAD_MAX_RETRIES,
  type ThinkingLevel,
} from './config'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GeminiUsage {
  inputTokens: number
  outputTokens: number
}

export interface FunctionCallStep {
  /** Call id — must be echoed back in the function_result. */
  id: string
  name: string
  arguments: unknown
}

export interface InteractionResult {
  id: string
  outputText: string
  functionCalls: FunctionCallStep[]
  usage: GeminiUsage
}

export interface ToolDeclaration {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type InputPart =
  | { type: 'text'; text: string }
  | { type: 'document'; uri: string; mime_type: string }
  | {
      type: 'function_result'
      name: string
      call_id: string
      result: Array<{ type: 'text'; text: string }>
    }

export interface InteractionRequest {
  model: string
  input: InputPart[] | string
  /** System prompt for the conversation. */
  instructions?: string
  previousInteractionId?: string
  tools?: ToolDeclaration[]
  toolChoice?: 'auto' | 'any' | 'none'
  thinkingLevel?: ThinkingLevel
  responseSchema?: Record<string, unknown>
  signal?: AbortSignal
}

export interface UploadedFile {
  name: string
  uri: string
  mimeType: string
}

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** A short, user-presentable explanation. */
    public readonly userMessage: string,
  ) {
    super(message)
    this.name = 'GeminiError'
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class GeminiClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch,
    private readonly baseUrl: string = GEMINI_BASE_URL,
  ) {}

  /** Create one interaction turn, with rate-limit-aware retry. */
  async interact(req: InteractionRequest): Promise<InteractionResult> {
    const body: Record<string, unknown> = {
      model: req.model,
      input: req.input,
    }
    if (req.instructions) body.system_instruction = req.instructions
    if (req.previousInteractionId) body.previous_interaction_id = req.previousInteractionId
    if (req.tools) body.tools = req.tools
    const generationConfig: Record<string, unknown> = {}
    if (req.toolChoice) generationConfig.tool_choice = req.toolChoice
    if (req.thinkingLevel) generationConfig.thinking_level = req.thinkingLevel
    if (Object.keys(generationConfig).length > 0) body.generation_config = generationConfig
    if (req.responseSchema) {
      body.response_format = {
        type: 'text',
        mime_type: 'application/json',
        schema: req.responseSchema,
      }
    }

    const raw = await this.postWithRetry(`${this.baseUrl}/v1beta/interactions`, body, req.signal)
    return parseInteraction(raw)
  }

  /** Upload a PDF via the resumable Files API and wait until it is ACTIVE. */
  async uploadPdf(
    data: Uint8Array,
    displayName: string,
    signal?: AbortSignal,
  ): Promise<UploadedFile> {
    let lastError: unknown
    for (let attempt = 0; attempt < UPLOAD_MAX_RETRIES; attempt++) {
      try {
        return await this.uploadPdfOnce(data, displayName, signal)
      } catch (e) {
        lastError = e
        if (signal?.aborted || isAbortError(e)) throw e
        // Client errors other than rate limiting (e.g. a rejected API key)
        // will not fix themselves — surface them instead of retrying.
        if (e instanceof GeminiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
          throw e
        }
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1), signal)
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new GeminiError('upload failed', 0, 'Uploading the PDF to Gemini failed.')
  }

  private async uploadPdfOnce(
    data: Uint8Array,
    displayName: string,
    signal?: AbortSignal,
  ): Promise<UploadedFile> {
    // Step 1: start a resumable upload, receive the upload URL in a header.
    const startRes = await this.fetchFn(`${this.baseUrl}/upload/v1beta/files`, {
      method: 'POST',
      signal,
      headers: {
        'x-goog-api-key': this.apiKey,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(data.byteLength),
        'X-Goog-Upload-Header-Content-Type': 'application/pdf',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    })
    if (!startRes.ok) throw await toGeminiError(startRes)
    const uploadUrl = startRes.headers.get('x-goog-upload-url')
    if (!uploadUrl) {
      throw new GeminiError(
        'missing x-goog-upload-url header',
        startRes.status,
        'Gemini did not accept the upload request.',
      )
    }

    // Step 2: send the bytes and finalize.
    const uploadRes = await this.fetchFn(uploadUrl, {
      method: 'POST',
      signal,
      headers: {
        'Content-Length': String(data.byteLength),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: data,
    })
    if (!uploadRes.ok) throw await toGeminiError(uploadRes)
    const uploaded = (await uploadRes.json()) as {
      file?: { name?: string; uri?: string; mime_type?: string; mimeType?: string; state?: string }
    }
    const file = uploaded.file
    if (!file?.uri || !file.name) {
      throw new GeminiError(
        'upload response missing file uri',
        uploadRes.status,
        'Gemini returned an unexpected upload response.',
      )
    }

    // Step 3: poll until the file is processed.
    const deadline = Date.now() + FILE_ACTIVE_TIMEOUT_MS
    let state = file.state ?? 'PROCESSING'
    while (state === 'PROCESSING') {
      if (Date.now() > deadline) {
        throw new GeminiError(
          'file processing timeout',
          0,
          'Gemini took too long to process the PDF. Try again.',
        )
      }
      await sleep(1500, signal)
      const pollRes = await this.fetchFn(`${this.baseUrl}/v1beta/${file.name}`, {
        headers: { 'x-goog-api-key': this.apiKey },
        signal,
      })
      if (!pollRes.ok) throw await toGeminiError(pollRes)
      const polled = (await pollRes.json()) as { state?: string }
      state = polled.state ?? 'ACTIVE'
    }
    if (state === 'FAILED') {
      throw new GeminiError(
        'file processing failed',
        0,
        'Gemini could not process this PDF. It may be corrupted or unsupported.',
      )
    }
    return {
      name: file.name,
      uri: file.uri,
      mimeType: file.mime_type ?? file.mimeType ?? 'application/pdf',
    }
  }

  private async postWithRetry(
    url: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let lastError: GeminiError | undefined
    for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
      const backoff = Math.min(
        RETRY_BASE_DELAY_MS * 2 ** attempt * (1 + Math.random() * 0.1),
        RETRY_MAX_DELAY_MS,
      )

      let res: Response
      try {
        res = await this.fetchFn(url, {
          method: 'POST',
          signal,
          headers: {
            'x-goog-api-key': this.apiKey,
            'Content-Type': 'application/json',
            'Api-Revision': GEMINI_API_REVISION,
          },
          body: JSON.stringify(body),
        })
      } catch (e) {
        // Network-level failure (offline, DNS, connection reset) — retried
        // like a 5xx so a blip mid-generation does not kill the whole run.
        if (signal?.aborted || isAbortError(e)) throw e
        lastError = new GeminiError(
          e instanceof Error ? e.message : String(e),
          0,
          'The connection to Gemini dropped. Lectern will retry.',
        )
        if (attempt === RATE_LIMIT_MAX_RETRIES) throw lastError
        await sleep(backoff, signal)
        continue
      }
      if (res.ok) return res.json()

      const error = await toGeminiError(res)
      const retryable = res.status === 429 || res.status >= 500
      if (!retryable || attempt === RATE_LIMIT_MAX_RETRIES) throw error
      lastError = error

      const retryAfterHeader = res.headers.get('retry-after')
      const retryAfterMs = retryAfterHeader
        ? Number.parseFloat(retryAfterHeader) * 1000
        : extractRetryAfterMs(error.message)
      await sleep(
        Number.isFinite(retryAfterMs) && retryAfterMs! > 0 ? retryAfterMs! : backoff,
        signal,
      )
    }
    throw lastError ?? new GeminiError('request failed', 0, 'The Gemini request failed.')
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseInteraction(raw: unknown): InteractionResult {
  const obj = (raw ?? {}) as Record<string, unknown>
  const id = typeof obj.id === 'string' ? obj.id : ''

  const functionCalls: FunctionCallStep[] = []
  const textParts: string[] = []
  const steps = Array.isArray(obj.steps) ? (obj.steps as Array<Record<string, unknown>>) : []
  for (const step of steps) {
    if (step.type === 'function_call') {
      functionCalls.push({
        id: typeof step.id === 'string' ? step.id : '',
        name: typeof step.name === 'string' ? step.name : '',
        arguments: step.arguments,
      })
    } else if (step.type === 'model_output' && Array.isArray(step.content)) {
      for (const part of step.content as Array<Record<string, unknown>>) {
        if (part.type === 'text' && typeof part.text === 'string') textParts.push(part.text)
      }
    }
  }

  const outputText =
    typeof obj.output_text === 'string' && obj.output_text.length > 0
      ? obj.output_text
      : textParts.join('')

  return { id, outputText, functionCalls, usage: parseUsage(obj) }
}

/** Interactions API usage shape: total_input_tokens / total_output_tokens
 *  (+ total_thought_tokens, billed like output). */
function parseUsage(obj: Record<string, unknown>): GeminiUsage {
  const usage = (obj.usage ?? {}) as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    inputTokens: num(usage.total_input_tokens),
    outputTokens: num(usage.total_output_tokens) + num(usage.total_thought_tokens),
  }
}

/** Parse a JSON object out of a structured-output text response. */
export function parseJsonPayload(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // Some models wrap JSON in fences despite instructions — salvage.
    const match = trimmed.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new GeminiError(
      'response was not valid JSON',
      0,
      'Gemini returned malformed data. Retrying usually fixes this.',
    )
  }
}

async function toGeminiError(res: Response): Promise<GeminiError> {
  let message = `HTTP ${res.status}`
  try {
    const data = (await res.json()) as { error?: { message?: string; status?: string } }
    if (data.error?.message) message = data.error.message
  } catch {
    // keep the HTTP status message
  }
  return new GeminiError(message, res.status, userMessageFor(res.status, message))
}

function userMessageFor(status: number, message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('spending') || lower.includes('billing') || lower.includes('quota exceeded')) {
    return 'Your Gemini quota or spending cap was reached. Check your Google AI Studio billing settings.'
  }
  if (status === 429) return 'Gemini is rate-limiting requests. Lectern will retry automatically.'
  if (status === 401 || status === 403) {
    return 'The Gemini API key was rejected. Check it in Settings.'
  }
  if (status >= 500) return 'Gemini had a temporary server problem. Lectern will retry.'
  return message
}

function extractRetryAfterMs(message: string): number | undefined {
  const patterns = [/retry in ([\d.]+)\s*s/i, /retry-after[:\s]+([\d.]+)/i]
  for (const p of patterns) {
    const m = message.match(p)
    if (m) return Number.parseFloat(m[1]) * 1000
  }
  return undefined
}

const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError'

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
