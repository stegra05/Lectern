/**
 * Live smoke test for every provider adapter. Each provider runs only when
 * its key is set:
 *   GEMINI_API_KEY=... OPENAI_API_KEY=... ANTHROPIC_API_KEY=... \
 *     pnpm vitest run src/engine/llm.smoke.test.ts
 *
 * Validates the wire shapes the pipeline depends on:
 *  1. instructions + structured output
 *  2. agentic tool round-trip on the conversation value, with the whole tool
 *     set declared, one tool active, and an effort change between turns
 *  3. PDF upload + document input part, when LECTERN_TEST_PDF names a file
 */

import { readFile } from 'node:fs/promises'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createClient } from './clients'
import type { ProviderId } from './config'
import { parseJsonPayload, type ToolDeclaration } from './llm'

const PDF_PATH = process.env.LECTERN_TEST_PDF

const PROVIDERS: Array<{ provider: ProviderId; model: string; key: string | undefined }> = [
  { provider: 'gemini', model: 'gemini-3.8-flash', key: process.env.GEMINI_API_KEY },
  { provider: 'openai', model: 'gpt-6-luna', key: process.env.OPENAI_API_KEY },
  { provider: 'anthropic', model: 'claude-haiku-5-5', key: process.env.ANTHROPIC_API_KEY },
]

const ECHO_TOOL: ToolDeclaration = {
  name: 'echo_check',
  description: 'Echo a word back to verify the tool channel.',
  parameters: {
    type: 'object',
    properties: { word: { type: 'string' } },
    required: ['word'],
  },
}
const IDLE_TOOL: ToolDeclaration = {
  name: 'idle_check',
  description: 'Never call this tool.',
  parameters: { type: 'object', properties: {} },
}

for (const { provider, model, key } of PROVIDERS) {
  describe.skipIf(!key)(`${provider} adapter (live)`, () => {
    // Built lazily: the SDKs refuse to construct without a key, and a
    // skipped suite still runs its body.
    const client = () => createClient(provider, key ?? '', fetch)

    it('structured output with instructions', { timeout: 120_000 }, async () => {
      const result = await client().turn({
        model,
        instructions: 'You are a terse status responder.',
        input: [{ type: 'text', text: 'Report status ok.' }],
        responseSchema: {
          type: 'object',
          properties: { status: { type: 'string' } },
          required: ['status'],
        },
        effort: 'low',
      })
      const payload = parseJsonPayload(result.outputText, provider) as { status: string }
      expect(typeof payload.status).toBe('string')
      expect(result.usage.inputTokens).toBeGreaterThan(0)
    })

    it('agentic tool round-trip', { timeout: 180_000 }, async () => {
      const tools = [ECHO_TOOL, IDLE_TOOL]
      const instructions = 'You verify tool channels. Use tools when asked.'
      const first = await client().turn({
        model,
        instructions,
        input: [{ type: 'text', text: 'Call echo_check with the word "lectern".' }],
        tools,
        activeTools: ['echo_check'],
        requireTool: true,
        effort: 'low',
      })
      expect(first.toolCalls.length).toBeGreaterThan(0)
      const call = first.toolCalls[0]
      expect(call.name).toBe('echo_check')
      expect((call.arguments as { word: string }).word.toLowerCase()).toContain('lectern')

      const second = await client().turn({
        model,
        instructions,
        conversation: first.conversation,
        input: [
          {
            type: 'tool_result',
            name: call.name,
            callId: call.id,
            text: '{"echoed":"lectern","ok":true}',
          },
          { type: 'text', text: 'Reply with one word: done.' },
        ],
        tools,
        activeTools: [],
        effort: 'medium',
      })
      expect(second.outputText.length).toBeGreaterThan(0)
    })

    it.skipIf(!PDF_PATH)('PDF upload + document turn', { timeout: 240_000 }, async () => {
      const bytes = new Uint8Array(await readFile(PDF_PATH!))
      const document = await client().uploadPdf(bytes, 'smoke-test-slides.pdf')
      expect(document.id).toBeTruthy()
      onTestFinished(() => client().deleteDocument(document))

      const result = await client().turn({
        model,
        input: [
          { type: 'document', document },
          { type: 'text', text: 'Reply with JSON {"pages": <number of pages in this document>}.' },
        ],
        responseSchema: {
          type: 'object',
          properties: { pages: { type: 'integer' } },
          required: ['pages'],
        },
        effort: 'low',
      })
      const payload = parseJsonPayload(result.outputText, provider) as { pages: number }
      expect(payload.pages).toBeGreaterThan(0)
    })
  })
}
