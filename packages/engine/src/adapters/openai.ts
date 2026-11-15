import OpenAI from 'openai'
import { EngineError } from '../errors.ts'
import type { Answer, DecisionsPort, ModelPort, Question, SlideImage } from '../ports.ts'

/** Dollars per million tokens. Above `longFrom` prompt tokens the long card prices the whole request. */
const LUNA = 'gpt-6-luna'
const PRICES: Record<
  string,
  { input: number; cachedInput: number; output: number; longInput: number; longOutput: number }
> = {
  [LUNA]: { input: 0.1, cachedInput: 0.01, output: 0.5, longInput: 0.2, longOutput: 0.75 },
  'gpt-6.1-terra': { input: 1, cachedInput: 0.05, output: 5, longInput: 2, longOutput: 7.5 },
}
const LONG_FROM = 272_000

/** The Decisions API takes this many questions and pictures per request. */
const QUESTIONS_PER_REQUEST = 200
const IMAGES_PER_REQUEST = 128
/**
 * A run makes hundreds of calls and saves nothing until the end, so one dropped connection must
 * not end it. The SDK waits longer between each of these tries.
 */
const RETRIES = 6

export interface OpenAIOptions {
  /** Defaults to the environment (`OPENAI_API_KEY`). */
  apiKey?: string
}

const picture = (image: SlideImage) => ({
  type: 'input_image' as const,
  image_url: `data:image/png;base64,${image.png}`,
  detail: 'auto' as const,
})
const text = (value: string) => ({ type: 'input_text' as const, text: value })

/**
 * The lecture as input blocks, ending in a cache breakpoint. OpenAI only reuses a prompt
 * prefix up to an explicit breakpoint, and only between calls with the same reply format and
 * reasoning effort (measured 2026-11-14 on gpt-6-luna).
 */
function shared(context: string, images: SlideImage[], labelled: boolean) {
  const blocks = [
    text(context),
    ...images.flatMap((image) =>
      labelled ? [text(`Picture of slide ${image.slide}:`), picture(image)] : [picture(image)],
    ),
  ]
  const last = blocks.at(-1)!
  return [
    ...blocks.slice(0, -1),
    { ...last, prompt_cache_breakpoint: { mode: 'explicit' as const } },
  ]
}

/**
 * A writing model through the Responses API. The reply is held to the JSON schema by the API
 * (strict structured output). The lecture comes first in the input and ends in a cache
 * breakpoint, so the many calls about one lecture read it at the cached price.
 */
export function openaiModel(model = LUNA, options: OpenAIOptions = {}): ModelPort {
  const price = PRICES[model]
  if (!price)
    throw new EngineError(
      `No price is known for the model ${model}.`,
      `Use one of: ${Object.keys(PRICES).join(', ')}.`,
    )
  let client: OpenAI | undefined
  return {
    model,
    price,
    async complete(request) {
      client ??= new OpenAI({ ...options, maxRetries: RETRIES })
      const response = await client.responses
        .create({
          model,
          instructions: request.system,
          input: [
            {
              role: 'user',
              content: [
                ...shared(request.context, request.images, true),
                ...(request.shown ?? []).flatMap((image) => [
                  text(`Picture of slide ${image.slide}:`),
                  picture(image),
                ]),
                text(request.prompt),
              ],
            },
          ],
          reasoning: { effort: request.effort },
          text: {
            format: { type: 'json_schema', name: 'reply', schema: request.schema, strict: true },
          },
          store: false,
        })
        .catch((error: unknown) => {
          throw explain(error)
        })
      // The call is billed whatever it returned, so it is reported before anything can throw.
      const usage = response.usage
      const inputTokens = usage?.input_tokens ?? 0
      const cached = usage?.input_tokens_details.cached_tokens ?? 0
      const outputTokens = usage?.output_tokens ?? 0
      const long = inputTokens > LONG_FROM
      const dollars =
        (inputTokens - cached) * (long ? price.longInput : price.input) +
        cached * price.cachedInput +
        outputTokens * (long ? price.longOutput : price.output)
      request.onUsage({
        inputTokens,
        cachedInputTokens: cached,
        outputTokens,
        costUsd: dollars / 1_000_000,
      })
      if (response.status === 'incomplete') {
        const filtered = response.incomplete_details?.reason === 'content_filter'
        throw new EngineError(
          filtered
            ? 'The model declined to work on these slides.'
            : 'The model ran out of room before it finished.',
          filtered
            ? 'Leave this lecture out and build again.'
            : 'Split the lecture into smaller PDFs.',
        )
      }
      return JSON.parse(response.output_text) as unknown
    },
  }
}

/**
 * OpenAI's decision model through the Decisions API: closed questions about one shared
 * input, answered with probabilities and no text. Long question lists go out in chunks.
 */
export function openaiDecisions(options: OpenAIOptions = {}): DecisionsPort {
  let client: OpenAI | undefined
  return {
    model: LUNA,
    price: { input: PRICES[LUNA]!.input },
    async decide(request) {
      if (request.images.length > IMAGES_PER_REQUEST) {
        throw new Error(
          `A decision request carries ${request.images.length} pictures, more than the ${IMAGES_PER_REQUEST} the API takes.`,
        )
      }
      client ??= new OpenAI({ ...options, maxRetries: RETRIES })
      const content = shared(request.context, request.images, true)
      const answers: Answer[] = []
      for (let start = 0; start < request.questions.length; start += QUESTIONS_PER_REQUEST) {
        const decision = await client.decisions
          .create({
            model: LUNA,
            input: [{ role: 'user', content }],
            questions: request.questions
              .slice(start, start + QUESTIONS_PER_REQUEST)
              .map(toQuestion),
          })
          .catch((error: unknown) => {
            throw explain(error)
          })
        // Only input is charged; answers are free. Cached input is billed lower by a factor
        // that is not published, so the full price stands in as an upper bound.
        const inputTokens = decision.usage.input_tokens
        request.onUsage({
          inputTokens,
          cachedInputTokens: decision.usage.input_tokens_details.cached_tokens,
          outputTokens: 0,
          costUsd: (inputTokens * PRICES[LUNA]!.input) / 1_000_000,
        })
        for (const answer of decision.answers) {
          if (answer.type === 'predicate')
            answers.push({ type: 'predicate', probability: answer.probability })
          else if (answer.type === 'choice') {
            answers.push({ type: 'choice', choice: String(answer.choice) })
          } else if (answer.type === 'score') answers.push({ type: 'score', score: answer.score })
          else answers.push({ type: 'refusal' })
        }
      }
      return answers
    },
  }
}

function toQuestion(question: Question) {
  if (question.type === 'predicate')
    return { type: 'predicate' as const, instructions: question.statement }
  if (question.type === 'score') {
    const levels = question.levels.map(({ label, description }) => ({ label, description }))
    return { type: 'score' as const, instructions: question.ask, levels }
  }
  return {
    type: 'choice' as const,
    instructions: question.ask,
    choices: question.choices.map((value) => ({ value })),
  }
}

function explain(error: unknown): Error {
  if (error instanceof OpenAI.AuthenticationError) {
    return new EngineError('OpenAI rejected the API key.', 'Check the key in OPENAI_API_KEY.')
  }
  if (error instanceof OpenAI.RateLimitError) {
    return error.code === 'insufficient_quota'
      ? new EngineError(
          'The OpenAI account has no credit left.',
          'Add credit to the account, then build again.',
        )
      : new EngineError(
          'OpenAI is limiting requests for this key.',
          'Wait a minute and build again.',
        )
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new EngineError(
      'OpenAI could not be reached.',
      'Check the internet connection and build again.',
    )
  }
  if (error instanceof OpenAI.APIError) {
    return new EngineError(
      `OpenAI answered with an error: ${error.message}`,
      'Build again in a few minutes.',
    )
  }
  return error instanceof Error ? error : new Error(String(error))
}
