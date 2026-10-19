/**
 * Claude adapter over the Messages API. The API is stateless, so the
 * conversation value carries the transcript, and it is append-only: Claude's
 * thinking blocks are bound to the exact prefix that produced them (system
 * prompt, tool set, every earlier message), and replaying them after an edit
 * is a 400 for newer accounts. The pipeline therefore keeps the system prompt
 * and tool set fixed per conversation; what changes per phase travels here:
 *  - active tools: Claude cannot be forced to call a tool (forced tool_choice
 *    is a 400 on current models), so the prompts name the tool to call;
 *  - effort: the top-level value stays at the conversation's first, and later
 *    changes go in as per-message effort, which keeps the prompt cache.
 * Top-level cache_control caches the growing transcript turn over turn, so
 * the document is billed at the cache-read rate after the first turn.
 */

import Anthropic, { APIConnectionError, APIError, toFile } from '@anthropic-ai/sdk'
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaToolUnion,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'

import { ANTHROPIC_MAX_TOKENS, type ThinkingLevel } from './config'
import {
  LlmError,
  withRetry,
  type Conversation,
  type DocumentRef,
  type InputPart,
  type LlmClient,
  type LlmErrorKind,
  type RetryListener,
  type ToolCall,
  type TurnRequest,
  type TurnResult,
} from './llm'

const BETAS = [
  // Re-run a policy decline on the model's default fallback instead of
  // stopping the student's run.
  'server-side-fallback-2026-07-01',
  // Effort per phase without invalidating the cache.
  'mid-conversation-output-config-2026-07-01',
]

type AnthropicConversation = Extract<Conversation, { provider: 'anthropic' }>

export class AnthropicClient implements LlmClient {
  readonly provider = 'anthropic'
  private readonly sdk: Anthropic

  constructor(
    apiKey: string,
    fetchFn: typeof fetch,
    private readonly onRetry?: RetryListener,
  ) {
    // The key lives in the user's keychain and the request leaves from their
    // own machine: the "browser" here is the app's webview.
    this.sdk = new Anthropic({
      apiKey,
      fetch: fetchFn,
      maxRetries: 0,
      dangerouslyAllowBrowser: true,
    })
  }

  async uploadPdf(
    data: Uint8Array,
    displayName: string,
    signal?: AbortSignal,
  ): Promise<DocumentRef> {
    const file = await withRetry(
      async () =>
        this.sdk.files.upload(
          { file: await toFile(data, displayName, { type: 'application/pdf' }) },
          { signal },
        ),
      toLlmError,
      this.onRetry,
      signal,
    )
    return { id: file.id, mimeType: 'application/pdf' }
  }

  async turn(req: TurnRequest): Promise<TurnResult> {
    const previous = req.conversation
    if (previous && previous.provider !== 'anthropic') {
      throw new LlmError(
        'conversation belongs to another provider',
        0,
        'request_rejected',
        'anthropic',
      )
    }
    const effort: ThinkingLevel = req.effort ?? previous?.effort ?? 'medium'
    const baseEffort = previous?.baseEffort ?? effort

    const appended: BetaMessageParam[] = []
    if (effort !== (previous?.effort ?? baseEffort)) {
      appended.push({ role: 'system', content: [], output_config: { effort } })
    }
    appended.push({ role: 'user', content: toClaudeContent(req.input) })
    const messages = [...((previous?.messages ?? []) as BetaMessageParam[]), ...appended]

    const params: MessageCreateParamsNonStreaming = {
      model: req.model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      messages,
      thinking: { type: 'adaptive' },
      output_config: { effort: baseEffort },
      cache_control: { type: 'ephemeral' },
      betas: BETAS,
      fallbacks: 'default',
    }
    if (req.instructions) params.system = req.instructions
    if (req.tools) {
      params.tools = req.tools.map((tool): BetaToolUnion => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters as Anthropic.Beta.BetaTool.InputSchema,
      }))
      params.tool_choice = req.activeTools?.length ? { type: 'auto' } : { type: 'none' }
    }
    if (req.responseSchema) {
      params.output_config = {
        ...params.output_config,
        format: { type: 'json_schema', schema: closeObjects(req.responseSchema) },
      }
    }

    const message = await withRetry(
      // Streamed so a long thinking turn cannot run into an HTTP timeout.
      () => this.sdk.beta.messages.stream(params, { signal: req.signal }).finalMessage(),
      toLlmError,
      this.onRetry,
      req.signal,
    )
    return parseMessage(message, {
      provider: 'anthropic',
      messages: [...messages, { role: 'assistant', content: message.content }],
      baseEffort,
      effort,
    })
  }
}

function toClaudeContent(parts: InputPart[]): BetaContentBlockParam[] {
  // Tool results must lead the user message that answers the tool calls.
  const ordered = [
    ...parts.filter((part) => part.type === 'tool_result'),
    ...parts.filter((part) => part.type !== 'tool_result'),
  ]
  return ordered.map((part): BetaContentBlockParam => {
    switch (part.type) {
      case 'tool_result':
        return { type: 'tool_result', tool_use_id: part.callId, content: part.text }
      case 'document':
        return { type: 'document', source: { type: 'file', file_id: part.document.id } }
      case 'text':
        return { type: 'text', text: part.text }
    }
  })
}

function parseMessage(message: BetaMessage, conversation: AnthropicConversation): TurnResult {
  if (message.stop_reason === 'refusal') {
    throw new LlmError(
      message.stop_details?.explanation ?? 'Claude declined the request.',
      200,
      'refused',
      'anthropic',
    )
  }
  if (message.stop_reason === 'max_tokens') {
    // Retrying would only run into the same ceiling.
    throw new LlmError('the answer ran past the output limit', 200, 'request_rejected', 'anthropic')
  }
  const toolCalls: ToolCall[] = []
  let outputText = ''
  for (const block of message.content) {
    if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, arguments: block.input })
    } else if (block.type === 'text') {
      outputText += block.text
    }
  }
  const usage = message.usage
  const cacheRead = usage.cache_read_input_tokens ?? 0
  return {
    conversation,
    outputText,
    toolCalls,
    usage: {
      inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + cacheRead,
      cachedInputTokens: cacheRead,
      // Thinking tokens are already part of output_tokens.
      outputTokens: usage.output_tokens,
    },
  }
}

/** Claude's structured output requires every object to be closed; the shared
 *  schemas cannot say so because Gemini rejects the keyword. */
function closeObjects(schema: unknown): Record<string, unknown> {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit)
    if (node === null || typeof node !== 'object') return node
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) out[key] = visit(value)
    if (out.type === 'object') out.additionalProperties = false
    return out
  }
  return visit(schema) as Record<string, unknown>
}

function toLlmError(e: unknown): LlmError {
  if (e instanceof LlmError) return e
  if (e instanceof APIConnectionError) {
    return new LlmError(e.message, 0, 'network', 'anthropic')
  }
  if (e instanceof APIError) {
    // The class's type parameters widen to any under instanceof.
    const error = e as APIError
    const status = error.status ?? 0
    return new LlmError(
      error.message,
      status,
      kindFor(status, error.message),
      'anthropic',
      retryAfterMs(error.headers),
    )
  }
  return new LlmError(e instanceof Error ? e.message : String(e), 0, 'network', 'anthropic')
}

function kindFor(status: number, message: string): LlmErrorKind {
  if (status === 401 || status === 403) return 'key_rejected'
  if (/credit balance|spend limit|billing/i.test(message)) return 'spending_cap'
  if (status === 429) return 'rate_limited'
  // 529 is "overloaded": a server-side condition like any 5xx.
  if (status >= 500) return 'server'
  return 'request_rejected'
}

function retryAfterMs(headers: Headers | undefined): number | undefined {
  const seconds = Number.parseFloat(headers?.get('retry-after') ?? '')
  return Number.isFinite(seconds) ? seconds * 1000 : undefined
}
