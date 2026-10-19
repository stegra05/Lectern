/**
 * OpenAI adapter over the Responses API. Like Gemini's Interactions API it
 * keeps the conversation server-side: each turn names the one before it by
 * `previous_response_id`, so the PDF is uploaded and sent once.
 *
 * The SDK's own retries are off; withRetry does them, so every wait shows up
 * in the activity log like Gemini's do.
 */

import OpenAI, { APIConnectionError, APIError, NotFoundError, toFile } from 'openai'
import type {
  FunctionTool,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  Response as OpenAIResponse,
} from 'openai/resources/responses/responses'

import {
  LlmError,
  fromSdkError,
  rateLimitKind,
  withRetry,
  type DocumentRef,
  type InputPart,
  type LlmClient,
  type LlmErrorKind,
  type RetryListener,
  type ToolCall,
  type TurnRequest,
  type TurnResult,
} from './llm'
import { requireAll } from './strictSchema'

export class OpenAIClient implements LlmClient {
  readonly provider = 'openai'
  private readonly sdk: OpenAI

  constructor(
    apiKey: string,
    fetchFn: typeof fetch,
    private readonly onRetry?: RetryListener,
  ) {
    // The key lives in the user's keychain and the request leaves from their
    // own machine: the "browser" here is the app's webview.
    this.sdk = new OpenAI({ apiKey, fetch: fetchFn, maxRetries: 0, dangerouslyAllowBrowser: true })
  }

  async uploadPdf(
    data: Uint8Array,
    displayName: string,
    signal?: AbortSignal,
  ): Promise<DocumentRef> {
    const file = await withRetry(
      async () =>
        this.sdk.files.create(
          {
            file: await toFile(data, displayName, { type: 'application/pdf' }),
            purpose: 'user_data',
          },
          { signal },
        ),
      toLlmError,
      this.onRetry,
      signal,
    )
    return { id: file.id, mimeType: 'application/pdf' }
  }

  async deleteDocument(document: DocumentRef): Promise<void> {
    try {
      await this.sdk.files.delete(document.id)
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw toLlmError(e)
    }
  }

  async turn(req: TurnRequest): Promise<TurnResult> {
    if (req.conversation && req.conversation.provider !== 'openai') {
      throw new LlmError(
        'conversation belongs to another provider',
        0,
        'request_rejected',
        'openai',
      )
    }
    const params: ResponseCreateParamsNonStreaming = {
      model: req.model,
      input: toOpenAIInput(req.input),
      // Instructions do not carry over from the previous response.
      instructions: req.instructions,
      previous_response_id: req.conversation?.responseId,
      store: true,
    }
    if (req.tools) {
      params.tools = req.tools.map((tool): FunctionTool => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        // Strict: the arguments always match the schema.
        parameters: requireAll(tool.parameters),
        strict: true,
      }))
      // The full set stays declared so the prompt cache holds; allowed_tools
      // narrows it to the phase.
      params.tool_choice = req.activeTools?.length
        ? {
            type: 'allowed_tools',
            mode: req.requireTool ? 'required' : 'auto',
            tools: req.activeTools.map((name) => ({ type: 'function', name })),
          }
        : 'none'
    }
    if (req.effort) params.reasoning = { effort: req.effort }
    if (req.responseSchema) {
      params.text = {
        format: {
          type: 'json_schema',
          name: 'response',
          schema: requireAll(req.responseSchema),
          strict: true,
        },
      }
    }

    const response = await withRetry(
      () => this.sdk.responses.create(params, { signal: req.signal }),
      toLlmError,
      this.onRetry,
      req.signal,
    )
    return parseResponse(response)
  }
}

function toOpenAIInput(parts: InputPart[]): ResponseInputItem[] {
  const items: ResponseInputItem[] = []
  // Text and documents travel together in one user message; tool results are
  // items of their own and must come before it.
  const content: Array<
    { type: 'input_text'; text: string } | { type: 'input_file'; file_id: string }
  > = []
  for (const part of parts) {
    if (part.type === 'tool_result') {
      items.push({ type: 'function_call_output', call_id: part.callId, output: part.text })
    } else if (part.type === 'document') {
      content.push({ type: 'input_file', file_id: part.document.id })
    } else {
      content.push({ type: 'input_text', text: part.text })
    }
  }
  if (content.length > 0) items.push({ role: 'user', content })
  return items
}

function parseResponse(response: OpenAIResponse): TurnResult {
  if (response.status === 'incomplete') {
    if (response.incomplete_details?.reason === 'content_filter') {
      throw new LlmError('the answer was stopped by a content filter', 200, 'refused', 'openai')
    }
    // Retrying would only run into the same ceiling.
    throw new LlmError('the answer ran past the output limit', 200, 'request_rejected', 'openai')
  }
  const toolCalls: ToolCall[] = []
  let refusal = ''
  for (const item of response.output) {
    if (item.type === 'function_call') {
      toolCalls.push({
        id: item.call_id,
        name: item.name,
        arguments: parseArguments(item.arguments),
      })
    } else if (item.type === 'message') {
      for (const part of item.content) {
        if (part.type === 'refusal') refusal += part.refusal
      }
    }
  }
  if (refusal && toolCalls.length === 0 && !response.output_text) {
    throw new LlmError(refusal, 200, 'refused', 'openai')
  }
  const usage = response.usage
  return {
    conversation: { provider: 'openai', responseId: response.id },
    outputText: response.output_text,
    toolCalls,
    usage: {
      inputTokens: usage?.input_tokens ?? 0,
      cachedInputTokens: usage?.input_tokens_details.cached_tokens ?? 0,
      // OpenAI caches on its own and charges nothing extra for the write.
      cacheWriteTokens: 0,
      // Reasoning tokens are already part of output_tokens.
      outputTokens: usage?.output_tokens ?? 0,
    },
  }
}

/** Arguments arrive as a JSON string. A broken one yields no arguments, which
 *  the tool handlers report back as an unusable call. */
function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const toLlmError = (e: unknown): LlmError =>
  fromSdkError(e, 'openai', { APIError, APIConnectionError }, kindFor)

function kindFor(status: number, message: string, code: string): LlmErrorKind {
  if (status === 401 || code === 'invalid_api_key') return 'key_rejected'
  // OpenAI reports an empty balance as a 429, but waiting will not refill it.
  if (code === 'insufficient_quota' || /billing/i.test(message)) return 'spending_cap'
  if (status === 429) return rateLimitKind(message)
  if (status >= 500) return 'server'
  return 'request_rejected'
}
