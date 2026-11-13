/**
 * Gemini adapter over the Interactions API (v1beta). Server-side conversation
 * state via `previous_interaction_id` replaces the old app's hand-rolled chat
 * history, pruning, and thought-signature bookkeeping.
 *
 * Raw fetch rather than an SDK: the Interactions API is pinned by revision
 * header, and all HTTP goes through an injected `fetchFn` so the app can pass
 * Tauri's CORS-free fetch while tests pass Node's fetch or mocks.
 */

import {
  FILE_ACTIVE_TIMEOUT_MS,
  GEMINI_API_REVISION,
  GEMINI_BASE_URL,
  RETRY_BASE_DELAY_MS,
  UPLOAD_MAX_RETRIES,
} from './config'
import {
  LlmError,
  isAbortError,
  isTransient,
  rateLimitKind,
  retryAfterFromHeaders,
  sleep,
  withRetry,
  type DocumentRef,
  type InputPart,
  type LlmClient,
  type LlmErrorKind,
  type RetryListener,
  type ToolCall,
  type TurnRequest,
  type TurnResult,
  type Usage,
} from './llm'

export class GeminiClient implements LlmClient {
  readonly provider = 'gemini'

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch,
    private readonly onRetry?: RetryListener,
    private readonly baseUrl: string = GEMINI_BASE_URL,
  ) {}

  async turn(req: TurnRequest): Promise<TurnResult> {
    if (req.conversation && req.conversation.provider !== 'gemini') {
      throw new LlmError(
        'conversation belongs to another provider',
        0,
        'request_rejected',
        'gemini',
      )
    }
    const body: Record<string, unknown> = {
      model: req.model,
      input: req.input.map(toGeminiPart),
    }
    if (req.instructions) body.system_instruction = req.instructions
    if (req.conversation) body.previous_interaction_id = req.conversation.interactionId
    // Gemini keys no reasoning to the tool set, so each turn declares only
    // the tools the phase may call.
    const active = (req.tools ?? []).filter((tool) => req.activeTools?.includes(tool.name))
    if (active.length > 0) body.tools = active.map((tool) => ({ type: 'function', ...tool }))
    const generationConfig: Record<string, unknown> = {}
    if (active.length > 0) generationConfig.tool_choice = req.requireTool ? 'any' : 'auto'
    if (req.effort) generationConfig.thinking_level = req.effort
    if (Object.keys(generationConfig).length > 0) body.generation_config = generationConfig
    if (req.responseSchema) {
      body.response_format = {
        type: 'text',
        mime_type: 'application/json',
        schema: req.responseSchema,
      }
    }

    const raw = await withRetry(
      () => this.post(`${this.baseUrl}/v1beta/interactions`, body, req.signal),
      toLlmError,
      this.onRetry,
      req.signal,
    )
    return parseInteraction(raw)
  }

  /** Upload a PDF via the resumable Files API and wait until it is ACTIVE. */
  async uploadPdf(
    data: Uint8Array,
    displayName: string,
    signal?: AbortSignal,
  ): Promise<DocumentRef> {
    let lastError: unknown
    for (let attempt = 0; attempt < UPLOAD_MAX_RETRIES; attempt++) {
      try {
        return await this.uploadPdfOnce(data, displayName, signal)
      } catch (e) {
        lastError = e
        if (signal?.aborted || isAbortError(e)) throw e
        // A rejected key, a spent quota or a refused PDF will not fix
        // itself; surface it instead of retrying.
        if (e instanceof LlmError && !isTransient(e.kind)) throw e
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1), signal)
      }
    }
    throw toLlmError(lastError)
  }

  async deleteDocument(document: DocumentRef): Promise<void> {
    // The uri is the file's resource URL; its path after the version is the
    // file name the Files API deletes by.
    const name = new URL(document.id).pathname.replace(/^\/v1beta\//, '')
    const res = await this.fetchFn(`${this.baseUrl}/v1beta/${name}`, {
      method: 'DELETE',
      headers: { 'x-goog-api-key': this.apiKey },
    })
    if (!res.ok && res.status !== 404) throw await errorFromResponse(res)
  }

  private async uploadPdfOnce(
    data: Uint8Array,
    displayName: string,
    signal?: AbortSignal,
  ): Promise<DocumentRef> {
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
    if (!startRes.ok) throw await errorFromResponse(startRes)
    const uploadUrl = startRes.headers.get('x-goog-upload-url')
    if (!uploadUrl) {
      throw new LlmError(
        'missing x-goog-upload-url header',
        startRes.status,
        'bad_response',
        'gemini',
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
    if (!uploadRes.ok) throw await errorFromResponse(uploadRes)
    const uploaded = (await uploadRes.json()) as {
      file?: { name?: string; uri?: string; mime_type?: string; mimeType?: string; state?: string }
    }
    const file = uploaded.file
    if (!file?.uri || !file.name) {
      throw new LlmError(
        'upload response missing file uri',
        uploadRes.status,
        'bad_response',
        'gemini',
      )
    }

    // Step 3: poll until the file is processed.
    const deadline = Date.now() + FILE_ACTIVE_TIMEOUT_MS
    let state = file.state ?? 'PROCESSING'
    while (state === 'PROCESSING') {
      if (Date.now() > deadline) {
        throw new LlmError('file processing timeout', 0, 'pdf_timeout', 'gemini')
      }
      await sleep(1500, signal)
      const pollRes = await this.fetchFn(`${this.baseUrl}/v1beta/${file.name}`, {
        headers: { 'x-goog-api-key': this.apiKey },
        signal,
      })
      if (!pollRes.ok) throw await errorFromResponse(pollRes)
      const polled = (await pollRes.json()) as { state?: string }
      state = polled.state ?? 'ACTIVE'
    }
    if (state === 'FAILED') {
      throw new LlmError('file processing failed', 0, 'pdf_rejected', 'gemini')
    }
    return { id: file.uri, mimeType: file.mime_type ?? file.mimeType ?? 'application/pdf' }
  }

  private async post(
    url: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const res = await this.fetchFn(url, {
      method: 'POST',
      signal,
      headers: {
        'x-goog-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'Api-Revision': GEMINI_API_REVISION,
      },
      body: JSON.stringify(body),
    })
    if (res.ok) return res.json()
    throw await errorFromResponse(res)
  }
}

function toGeminiPart(part: InputPart): Record<string, unknown> {
  switch (part.type) {
    case 'text':
      return part
    case 'document':
      return { type: 'document', uri: part.document.id, mime_type: part.document.mimeType }
    case 'tool_result':
      return {
        type: 'function_result',
        name: part.name,
        call_id: part.callId,
        result: [{ type: 'text', text: part.text }],
      }
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseInteraction(raw: unknown): TurnResult {
  const obj = (raw ?? {}) as Record<string, unknown>
  const id = typeof obj.id === 'string' ? obj.id : ''

  const toolCalls: ToolCall[] = []
  const textParts: string[] = []
  const steps = Array.isArray(obj.steps) ? (obj.steps as Array<Record<string, unknown>>) : []
  for (const step of steps) {
    if (step.type === 'function_call') {
      toolCalls.push({
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

  return {
    conversation: { provider: 'gemini', interactionId: id },
    outputText,
    toolCalls,
    usage: parseUsage(obj),
  }
}

/** Interactions API usage shape: total_input_tokens / total_output_tokens
 *  (+ total_thought_tokens, billed like output). */
function parseUsage(obj: Record<string, unknown>): Usage {
  const usage = (obj.usage ?? {}) as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    inputTokens: num(usage.total_input_tokens),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: num(usage.total_output_tokens) + num(usage.total_thought_tokens),
  }
}

/** A fetch that never got an answer rejects with a bare TypeError: that is a
 *  network failure, retried like a 5xx so a blip mid-generation does not
 *  kill the whole run. */
function toLlmError(e: unknown): LlmError {
  if (e instanceof LlmError) return e
  return new LlmError(e instanceof Error ? e.message : String(e), 0, 'network', 'gemini')
}

async function errorFromResponse(res: Response): Promise<LlmError> {
  let message = `HTTP ${res.status}`
  try {
    const data = (await res.json()) as { error?: { message?: string; status?: string } }
    if (data.error?.message) message = data.error.message
  } catch {
    // keep the HTTP status message
  }
  return new LlmError(
    message,
    res.status,
    kindFor(res.status, message),
    'gemini',
    retryAfterFromHeaders(res.headers) ?? extractRetryAfterMs(message),
  )
}

function kindFor(status: number, message: string): LlmErrorKind {
  const lower = message.toLowerCase()
  // A malformed key comes back as a 400, not a 401.
  if (status === 401 || status === 403 || /api[ _]?key[ _]?(not valid|invalid)/i.test(message)) {
    return 'key_rejected'
  }
  if (lower.includes('spending') || lower.includes('billing')) return 'spending_cap'
  if (status === 429) return rateLimitKind(message)
  if (status >= 500) return 'server'
  return 'request_rejected'
}

function extractRetryAfterMs(message: string): number | undefined {
  const patterns = [/retry in ([\d.]+)\s*s/i, /retry-after[:\s]+([\d.]+)/i]
  for (const p of patterns) {
    const m = message.match(p)
    if (m) return Number.parseFloat(m[1]) * 1000
  }
  return undefined
}
