import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { openaiDecisions, openaiModel } from '../src/adapters/openai.ts'
import { EngineError } from '../src/api.ts'
import { ProviderError } from '../src/errors.ts'
import type { ModelPort, ModelRequest } from '../src/ports.ts'

/** Nothing listens at this address, so a call fails at once and without a retry. */
const nowhere = { apiKey: 'test', baseURL: 'http://127.0.0.1:1', maxRetries: 0 }
const unreachable = new ProviderError(
  'OpenAI could not be reached.',
  'Check the internet connection and build again.',
  'connection',
)
const onUsage = () => undefined

const request: ModelRequest = {
  task: 'fill',
  system: '',
  context: '',
  images: [],
  prompt: '',
  schema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  effort: 'low',
  onUsage,
}

describe('the OpenAI adapters when OpenAI cannot be reached', () => {
  it('turn a failed connection into an error that names the fix', async () => {
    await expect(openaiModel(undefined, nowhere).complete(request)).rejects.toEqual(unreachable)
    await expect(
      openaiDecisions(nowhere).decide({
        context: '',
        images: [],
        questions: [{ type: 'predicate', statement: 'Is it?' }],
        onUsage,
      }),
    ).rejects.toEqual(unreachable)
  })
})

const servers: Server[] = []
afterEach(() => Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done)))))

/** Options for an adapter whose every call is answered with one canned reply, as by OpenAI. */
async function serving(status: number, body: unknown) {
  const server = createServer((_, res) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  servers.push(server)
  const { port } = server.address() as AddressInfo
  return { apiKey: 'test', baseURL: `http://127.0.0.1:${port}/v1`, maxRetries: 0 }
}

/** A model whose every call is answered with one canned reply, standing in for OpenAI. */
async function answered(status: number, body: unknown): Promise<ModelPort> {
  return openaiModel(undefined, await serving(status, body))
}

const reply = (fields: Record<string, unknown>) => ({
  id: 'resp_1',
  object: 'response',
  created_at: 0,
  model: 'gpt-6-luna',
  status: 'completed',
  output: [],
  output_text: '',
  usage: { input_tokens: 10, output_tokens: 0, input_tokens_details: { cached_tokens: 0 } },
  ...fields,
})

const failure = (model: ModelPort) =>
  model.complete(request).then(
    () => {
      throw new Error('The call did not fail.')
    },
    (error: unknown) => error as EngineError,
  )

describe('the OpenAI writing model when the answer is not usable', () => {
  it('reads a refusal like the content filter', async () => {
    const model = await answered(
      200,
      reply({
        output: [
          {
            type: 'message',
            id: 'msg_1',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'refusal', refusal: 'I cannot help with that.' }],
          },
        ],
      }),
    )
    expect(await failure(model)).toEqual(
      new EngineError(
        'The model declined to work on these slides.',
        'Leave this lecture out and build again.',
      ),
    )
  })

  it('turns a failed response into an error that names the fix', async () => {
    const model = await answered(
      200,
      reply({ status: 'failed', error: { code: 'server_error', message: 'The model crashed.' } }),
    )
    expect(await failure(model)).toEqual(
      new EngineError(
        'OpenAI could not finish the answer: The model crashed.',
        'Build again in a few minutes.',
      ),
    )
  })

  it('turns output that is not JSON into an error that names the fix', async () => {
    const model = await answered(200, reply({ output_text: '{"cards": [' }))
    expect(await failure(model)).toEqual(
      new EngineError(
        'The model sent an answer that could not be read.',
        'Build again. If it happens again, leave this lecture out.',
      ),
    )
  })

  it('does not tell the student to wait for a request OpenAI rejected', async () => {
    const model = await answered(400, {
      error: { message: 'Too much context.', type: 'invalid_request_error' },
    })
    const error = await failure(model)
    expect(error.message).toContain('Too much context.')
    expect(error.fix).toBe(
      'Building again will not change this. Leave this lecture out, or split it into smaller PDFs.',
    )
  })

  it('still tells the student to wait when OpenAI itself fails', async () => {
    const model = await answered(500, { error: { message: 'Oops.', type: 'server_error' } })
    expect((await failure(model)).fix).toBe('Build again in a few minutes.')
  })
})

describe('the OpenAI decision model', () => {
  it('gives a choice with how likely the chosen value is', async () => {
    const decisions = openaiDecisions(
      await serving(200, {
        model: 'gpt-6-luna',
        answers: [
          {
            type: 'choice',
            name: null,
            choice: 'exam',
            confidence: 0.8,
            probabilities: [
              { value: 'slides', probability: 0.2 },
              { value: 'exam', probability: 0.8 },
            ],
          },
        ],
        usage: {
          input_tokens: 700,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
          output_tokens: 0,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 700,
        },
      }),
    )
    const answers = await decisions.decide({
      context: 'A PDF.',
      images: [],
      questions: [{ type: 'choice', ask: 'Which kind?', choices: ['slides', 'exam'] }],
      onUsage,
    })
    expect(answers).toEqual([{ type: 'choice', choice: 'exam', probability: 0.8 }])
  })
})
