/**
 * Live integration smoke test for the Gemini Interactions API client.
 * Runs only when GEMINI_API_KEY is set:
 *   GEMINI_API_KEY=... pnpm vitest run src/engine/gemini.smoke.test.ts
 *
 * Validates the exact wire shapes the pipeline depends on:
 *  1. instructions + response_format structured output
 *  2. agentic tool loop: function_call → function_result via previous_interaction_id
 *  3. PDF upload + document input part
 */

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { GeminiClient, parseJsonPayload } from './gemini'

const apiKey = process.env.GEMINI_API_KEY
const MODEL = 'gemini-3.5-flash'

describe.skipIf(!apiKey)('Gemini Interactions API (live)', () => {
  const client = new GeminiClient(apiKey ?? '', fetch)

  it('structured output with instructions', { timeout: 60_000 }, async () => {
    const result = await client.interact({
      model: MODEL,
      instructions: 'You are a terse status responder.',
      input: 'Report status ok.',
      responseSchema: {
        type: 'object',
        properties: { status: { type: 'string' } },
        required: ['status'],
      },
      thinkingLevel: 'low',
    })
    expect(result.id).toBeTruthy()
    const payload = parseJsonPayload(result.outputText) as { status: string }
    expect(typeof payload.status).toBe('string')
  })

  it('agentic tool round-trip', { timeout: 120_000 }, async () => {
    const echoTool = {
      type: 'function' as const,
      name: 'echo_check',
      description: 'Echo a word back to verify the tool channel.',
      parameters: {
        type: 'object',
        properties: { word: { type: 'string' } },
        required: ['word'],
      },
    }

    const first = await client.interact({
      model: MODEL,
      input: 'Call echo_check with the word "lectern".',
      tools: [echoTool],
      toolChoice: 'any',
      thinkingLevel: 'low',
    })
    expect(first.functionCalls.length).toBeGreaterThan(0)
    const call = first.functionCalls[0]
    expect(call.name).toBe('echo_check')
    expect((call.arguments as { word: string }).word.toLowerCase()).toContain('lectern')

    const second = await client.interact({
      model: MODEL,
      previousInteractionId: first.id,
      input: [
        {
          type: 'function_result',
          name: call.name,
          call_id: call.id,
          result: [{ type: 'text', text: '{"echoed":"lectern","ok":true}' }],
        },
      ],
      tools: [echoTool],
      toolChoice: 'auto',
      thinkingLevel: 'low',
    })
    expect(second.id).toBeTruthy()
    expect(second.outputText.length).toBeGreaterThan(0)
  })

  it('PDF upload + document turn', { timeout: 180_000 }, async () => {
    const pdfPath = '/Users/stef/Dev/Product/apps/Lectern/LecternApp/resources/test_slides.pdf'
    const bytes = new Uint8Array(await readFile(pdfPath))
    const file = await client.uploadPdf(bytes, 'smoke test slides')
    expect(file.uri).toBeTruthy()

    const result = await client.interact({
      model: MODEL,
      input: [
        { type: 'document', uri: file.uri, mime_type: file.mimeType },
        { type: 'text', text: 'Reply with JSON {"pages": <number of pages in this document>}.' },
      ],
      responseSchema: {
        type: 'object',
        properties: { pages: { type: 'integer' } },
        required: ['pages'],
      },
      thinkingLevel: 'low',
    })
    const payload = parseJsonPayload(result.outputText) as { pages: number }
    expect(payload.pages).toBeGreaterThan(0)
  })
})
