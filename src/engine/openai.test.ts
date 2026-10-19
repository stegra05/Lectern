/**
 * Offline wire tests for the OpenAI adapter: a scripted fetch plays the
 * Responses API and records every request.
 */

import { describe, expect, it, vi } from 'vitest'

import { LlmError, type ToolDeclaration } from './llm'
import { OpenAIClient } from './openai'

interface Captured {
  url: string
  request: Request
}

function scriptedFetch(script: Array<() => Response>, captured: Captured[]): typeof fetch {
  const turns = [...script]
  return vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init)
    // The SDK probes the fetch for FormData support before an upload.
    if (request.url.startsWith('data:')) return new Response('')
    captured.push({ url: request.url, request })
    const next = turns.shift()
    if (!next) throw new Error('scripted fetch exhausted')
    return next()
  })
}

const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const response = (id: string, output: unknown[]) => ({
  id,
  object: 'response',
  status: 'completed',
  output,
  usage: {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 40 },
    output_tokens: 20,
    output_tokens_details: { reasoning_tokens: 5 },
    total_tokens: 120,
  },
})

const TOOLS: ToolDeclaration[] = [
  {
    name: 'submit',
    description: 'Submit things.',
    parameters: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] },
  },
  { name: 'finish', description: 'Finish.', parameters: { type: 'object', properties: {} } },
]

describe('OpenAIClient', () => {
  it('chains turns by response id and narrows the declared tools per turn', async () => {
    const captured: Captured[] = []
    const client = new OpenAIClient(
      'key',
      scriptedFetch(
        [
          json({ id: 'file-1', object: 'file', purpose: 'user_data', filename: 'a.pdf' }),
          json(
            response('resp_1', [
              {
                type: 'function_call',
                id: 'fc_1',
                call_id: 'call_1',
                name: 'submit',
                arguments: '{"word":"x"}',
                status: 'completed',
              },
            ]),
          ),
          json(
            response('resp_2', [
              {
                type: 'message',
                id: 'msg_1',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'done', annotations: [] }],
              },
            ]),
          ),
        ],
        captured,
      ),
    )

    const document = await client.uploadPdf(new Uint8Array([1, 2, 3]), 'a.pdf')
    expect(document).toEqual({ id: 'file-1', mimeType: 'application/pdf' })
    const upload = await captured[0].request.formData()
    expect(upload.get('purpose')).toBe('user_data')

    const first = await client.turn({
      model: 'gpt-6-luna',
      instructions: 'Be terse.',
      input: [
        { type: 'document', document },
        { type: 'text', text: 'Start.' },
      ],
      tools: TOOLS,
      activeTools: ['submit'],
      requireTool: true,
      effort: 'low',
    })
    expect(first.toolCalls).toEqual([{ id: 'call_1', name: 'submit', arguments: { word: 'x' } }])
    expect(first.usage).toEqual({
      inputTokens: 100,
      cachedInputTokens: 40,
      cacheWriteTokens: 0,
      outputTokens: 20,
    })

    const second = await client.turn({
      model: 'gpt-6-luna',
      instructions: 'Be terse.',
      conversation: first.conversation,
      input: [
        { type: 'tool_result', callId: 'call_1', name: 'submit', text: 'ok' },
        { type: 'text', text: 'Next.' },
      ],
      tools: TOOLS,
      activeTools: [],
      effort: 'medium',
    })
    expect(second.outputText).toBe('done')

    const a = (await captured[1].request.json()) as Record<string, unknown>
    const b = (await captured[2].request.json()) as Record<string, unknown>
    expect(a.instructions).toBe('Be terse.')
    expect(b.instructions).toBe('Be terse.')
    expect(a.previous_response_id).toBeUndefined()
    expect(b.previous_response_id).toBe('resp_1')
    expect(a.reasoning).toEqual({ effort: 'low' })
    // The whole tool set stays declared; allowed_tools picks the phase's.
    expect(b.tools).toEqual(a.tools)
    expect(a.tools).toMatchObject([
      { strict: true, parameters: { required: ['word'], additionalProperties: false } },
      { strict: true },
    ])
    expect(a.tool_choice).toEqual({
      type: 'allowed_tools',
      mode: 'required',
      tools: [{ type: 'function', name: 'submit' }],
    })
    expect(b.tool_choice).toBe('none')
    expect(a.input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_file', file_id: 'file-1' },
          { type: 'input_text', text: 'Start.' },
        ],
      },
    ])
    expect(b.input).toEqual([
      { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
      { role: 'user', content: [{ type: 'input_text', text: 'Next.' }] },
    ])
  })

  it('treats an empty balance as billing, not a rate limit to wait out', async () => {
    const captured: Captured[] = []
    const client = new OpenAIClient(
      'key',
      scriptedFetch(
        [
          json(
            {
              error: {
                message: 'You exceeded your current quota.',
                type: 'insufficient_quota',
                code: 'insufficient_quota',
              },
            },
            429,
          ),
        ],
        captured,
      ),
    )
    const error = await client
      .turn({ model: 'gpt-6-luna', input: [{ type: 'text', text: 'x' }] })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).kind).toBe('spending_cap')
    expect(captured).toHaveLength(1)
  })

  it('treats a per-day limit as a daily quota, not a rate limit to wait out', async () => {
    const captured: Captured[] = []
    const client = new OpenAIClient(
      'key',
      scriptedFetch(
        [
          json(
            {
              error: {
                message: 'Rate limit reached for gpt-6-luna on requests per day (RPD).',
                type: 'requests',
                code: 'rate_limit_exceeded',
              },
            },
            429,
          ),
        ],
        captured,
      ),
    )
    const error = await client
      .turn({ model: 'gpt-6-luna', input: [{ type: 'text', text: 'x' }] })
      .catch((e: unknown) => e)
    expect((error as LlmError).kind).toBe('quota_daily')
    expect(captured).toHaveLength(1)
  })

  it('reports an answer cut off at the output limit instead of parsing it', async () => {
    const client = new OpenAIClient(
      'key',
      scriptedFetch(
        [
          json({
            ...response('resp_1', []),
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
          }),
        ],
        [],
      ),
    )
    const error = await client
      .turn({ model: 'gpt-6-luna', input: [{ type: 'text', text: 'x' }] })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmError)
    expect((error as LlmError).message).toBe('the answer ran past the output limit')
  })

  it('deletes an upload, and takes a 404 as already gone', async () => {
    const captured: Captured[] = []
    const client = new OpenAIClient(
      'key',
      scriptedFetch(
        [
          json({ id: 'file-1', object: 'file', deleted: true }),
          json({ error: { message: 'No such File object', type: 'invalid_request_error' } }, 404),
        ],
        captured,
      ),
    )
    const document = { id: 'file-1', mimeType: 'application/pdf' }
    await client.deleteDocument(document)
    await client.deleteDocument(document)
    expect(captured[0].request.method).toBe('DELETE')
    expect(captured[0].url).toBe('https://api.openai.com/v1/files/file-1')
  })
})
