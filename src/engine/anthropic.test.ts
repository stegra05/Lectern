/**
 * Offline wire tests for the Claude adapter: a scripted fetch plays the
 * Messages API (streamed as server-sent events) and records every request.
 * The properties under test are the ones a live 400 would punish: the
 * transcript is append-only, the system prompt and tool set never change
 * between turns, and effort changes travel as per-message effort.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AnthropicClient } from './anthropic'
import { LlmError, type ToolDeclaration } from './llm'
import type { RetryNotice } from './types'

type Block =
  { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }

interface ScriptedMessage {
  blocks: Block[]
  stopReason?: string
  stopDetails?: Record<string, unknown>
}

/** One Messages API answer as the SSE stream the SDK reads. */
function sse(message: ScriptedMessage): Response {
  const events: Array<Record<string, unknown>> = [
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 70,
          output_tokens: 1,
        },
      },
    },
  ]
  message.blocks.forEach((block, index) => {
    if (block.type === 'text') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text },
      })
    } else {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      })
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      })
    }
    events.push({ type: 'content_block_stop', index })
  })
  events.push({
    type: 'message_delta',
    delta: {
      stop_reason: message.stopReason ?? 'end_turn',
      stop_sequence: null,
      stop_details: message.stopDetails ?? null,
    },
    usage: { output_tokens: 30 },
  })
  events.push({ type: 'message_stop' })
  const body = events
    .map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

interface Captured {
  body: Record<string, unknown>
  headers: Headers
}

function scriptedFetch(script: Array<() => Response>, captured: Captured[]): typeof fetch {
  const turns = [...script]
  return vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init)
    captured.push({
      body: JSON.parse(await request.text()) as Record<string, unknown>,
      headers: request.headers,
    })
    const next = turns.shift()
    if (!next) throw new Error('scripted fetch exhausted')
    return next()
  })
}

const TOOLS: ToolDeclaration[] = [
  {
    name: 'submit',
    description: 'Submit things.',
    parameters: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] },
  },
  { name: 'finish', description: 'Finish.', parameters: { type: 'object', properties: {} } },
]

describe('AnthropicClient', () => {
  it('keeps the transcript append-only and the prefix fixed across turns', async () => {
    const captured: Captured[] = []
    const client = new AnthropicClient(
      'key',
      scriptedFetch(
        [
          () =>
            sse({
              blocks: [{ type: 'tool_use', id: 'toolu_1', name: 'submit', input: { word: 'x' } }],
              stopReason: 'tool_use',
            }),
          () => sse({ blocks: [{ type: 'text', text: 'done' }] }),
        ],
        captured,
      ),
    )

    const first = await client.turn({
      model: 'claude-haiku-5-5',
      instructions: 'Be terse.',
      input: [
        { type: 'text', text: 'Start.' },
        { type: 'document', document: { id: 'file_1', mimeType: 'application/pdf' } },
      ],
      tools: TOOLS,
      activeTools: ['submit'],
      requireTool: true,
      effort: 'low',
    })
    expect(first.toolCalls).toEqual([{ id: 'toolu_1', name: 'submit', arguments: { word: 'x' } }])
    // Cache writes and reads are input too; reads are reported apart.
    expect(first.usage).toEqual({
      inputTokens: 100,
      cachedInputTokens: 70,
      cacheWriteTokens: 20,
      outputTokens: 30,
    })

    const second = await client.turn({
      model: 'claude-haiku-5-5',
      instructions: 'Be terse.',
      conversation: first.conversation,
      input: [
        { type: 'text', text: 'Next.' },
        { type: 'tool_result', callId: 'toolu_1', name: 'submit', text: 'ok' },
      ],
      tools: TOOLS,
      activeTools: [],
      effort: 'medium',
    })
    expect(second.outputText).toBe('done')

    const [a, b] = captured.map((c) => c.body)
    // Forced tool choice is a 400 on current Claude models: auto, then none.
    expect(a.tool_choice).toEqual({ type: 'auto' })
    expect(b.tool_choice).toEqual({ type: 'none' })
    // The prefix Claude binds its thinking to never changes.
    expect(b.system).toEqual(a.system)
    expect(b.tools).toEqual(a.tools)
    expect((a.tools as unknown[]).length).toBe(2)
    expect((a.tools as Array<Record<string, unknown>>).some((t) => 'strict' in t)).toBe(false)
    // Effort: the top level stays at the first turn's, the change is a message.
    expect(a.output_config).toEqual({ effort: 'low' })
    expect(b.output_config).toEqual({ effort: 'low' })
    expect(a.cache_control).toEqual({ type: 'ephemeral' })
    expect(a.fallbacks).toBe('default')
    expect(captured[0].headers.get('anthropic-beta')).toContain(
      'mid-conversation-output-config-2026-07-01',
    )

    const firstMessages = a.messages as Array<Record<string, unknown>>
    const secondMessages = b.messages as Array<Record<string, unknown>>
    // Append-only: the first request is a prefix of the second.
    expect(secondMessages.slice(0, firstMessages.length)).toEqual(firstMessages)
    expect(secondMessages[1]).toMatchObject({ role: 'assistant' })
    expect(secondMessages[2]).toEqual({
      role: 'system',
      content: [],
      output_config: { effort: 'medium' },
    })
    // Tool results lead the user message that answers the call.
    const answer = secondMessages[3] as { role: string; content: Array<Record<string, unknown>> }
    expect(answer.role).toBe('user')
    expect(answer.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' })
    expect(answer.content[1]).toMatchObject({ type: 'text', text: 'Next.' })
    // The document goes by file id.
    const opening = firstMessages[0].content as Array<Record<string, unknown>>
    expect(opening[1]).toEqual({ type: 'document', source: { type: 'file', file_id: 'file_1' } })
  })

  it('closes every object in a structured-output schema', async () => {
    const captured: Captured[] = []
    const client = new AnthropicClient(
      'key',
      scriptedFetch([() => sse({ blocks: [{ type: 'text', text: '{"a":[]}' }] })], captured),
    )
    await client.turn({
      model: 'claude-haiku-5-5',
      input: [{ type: 'text', text: 'Map it.' }],
      effort: 'high',
      responseSchema: {
        type: 'object',
        properties: {
          a: { type: 'array', items: { type: 'object', properties: { b: { type: 'string' } } } },
        },
      },
    })
    const format = (captured[0].body.output_config as { format: { schema: unknown } }).format
    expect(format.schema).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        a: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { b: { type: 'string' } },
          },
        },
      },
    })
  })

  it('reports a policy refusal as its own kind, without retrying', async () => {
    const captured: Captured[] = []
    const client = new AnthropicClient(
      'key',
      scriptedFetch(
        [
          () =>
            sse({
              blocks: [],
              stopReason: 'refusal',
              stopDetails: { type: 'refusal', category: 'bio', explanation: 'Declined.' },
            }),
        ],
        captured,
      ),
    )
    const error = await client
      .turn({ model: 'claude-haiku-5-5', input: [{ type: 'text', text: 'x' }] })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).kind).toBe('refused')
    expect(captured).toHaveLength(1)
  })

  describe('retries', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    const apiError = (status: number, message: string) => () =>
      new Response(JSON.stringify({ type: 'error', error: { type: 'x', message } }), {
        status,
        headers: { 'content-type': 'application/json' },
      })

    it('waits out an overloaded server, and says so', async () => {
      const captured: Captured[] = []
      const notices: RetryNotice[] = []
      const client = new AnthropicClient(
        'key',
        scriptedFetch(
          [apiError(529, 'Overloaded'), () => sse({ blocks: [{ type: 'text', text: 'ok' }] })],
          captured,
        ),
        (n) => notices.push(n),
      )
      const promise = client.turn({
        model: 'claude-haiku-5-5',
        input: [{ type: 'text', text: 'x' }],
      })
      await vi.advanceTimersByTimeAsync(10_000)
      expect((await promise).outputText).toBe('ok')
      expect(notices).toHaveLength(1)
      expect(notices[0].status).toBe(529)
    })

    it('does not retry a rejected key', async () => {
      const captured: Captured[] = []
      const client = new AnthropicClient(
        'key',
        scriptedFetch([apiError(401, 'invalid x-api-key')], captured),
      )
      const error = await client
        .turn({ model: 'claude-haiku-5-5', input: [{ type: 'text', text: 'x' }] })
        .catch((e: unknown) => e)
      expect((error as LlmError).kind).toBe('key_rejected')
      expect((error as LlmError).provider).toBe('anthropic')
      expect(captured).toHaveLength(1)
    })
  })

  it('deletes an upload, and takes a 404 as already gone', async () => {
    const captured: Captured[] = []
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      captured.push({ body: {}, headers: request.headers })
      return captured.length === 1
        ? new Response(JSON.stringify({ id: 'file_1', type: 'file_deleted' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response(
            JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'x' } }),
            { status: 404, headers: { 'content-type': 'application/json' } },
          )
    })
    const client = new AnthropicClient('key', fetchFn)
    const document = { id: 'file_1', mimeType: 'application/pdf' }
    await client.deleteDocument(document)
    await client.deleteDocument(document)
    expect(String(fetchFn.mock.calls[0][0])).toContain('/v1/files/file_1')
  })
})
