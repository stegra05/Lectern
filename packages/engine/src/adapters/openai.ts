import OpenAI from 'openai'
import { EngineError } from '../errors.ts'
import type { Answer, DecisionsPort, ModelPort, Question, SlideImage } from '../ports.ts'

/** Dollars per million tokens. Above `longFrom` prompt tokens the long card prices the whole request. */
const PRICES: Record<
  string,
  { input: number; cachedInput: number; output: number; longInput: number; longOutput: number }
> = {
  'gpt-6-luna': { input: 0.1, cachedInput: 0.01, output: 0.5, longInput: 0.2, longOutput: 0.75 },
  'gpt-6.1-terra': { input: 1, cachedInput: 0.05, output: 5, longInput: 2, longOutput: 7.5 },
}
const LONG_FROM = 272_000

/** The Decisions API takes this many questions and pictures per request. */
const QUESTIONS_PER_REQUEST = 200
const IMAGES_PER_REQUEST = 128
const DECISION_MODEL = 'gpt-6-luna'
const DECISION_PRICE = 0.1

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
 * A writing model through the Responses API. The reply is held to the JSON schema by the API
 * (strict structured output). The lecture comes first in the input, so the provider's prompt
 * cache covers it across the many calls about one lecture.
 */
export function openaiModel(model = 'gpt-6-luna', options: OpenAIOptions = {}): ModelPort {
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
      client ??= new OpenAI(options)
      const response = await client.responses
        .create({
          model,
          instructions: request.system,
          input: [
            {
              role: 'user',
              content: [
                text(request.context),
                ...request.images.flatMap((image) => [
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
      const usage = response.usage
      const inputTokens = usage?.input_tokens ?? 0
      const cached = usage?.input_tokens_details.cached_tokens ?? 0
      const outputTokens = usage?.output_tokens ?? 0
      const long = inputTokens > LONG_FROM
      const dollars =
        (inputTokens - cached) * (long ? price.longInput : price.input) +
        cached * price.cachedInput +
        outputTokens * (long ? price.longOutput : price.output)
      return {
        data: JSON.parse(response.output_text) as unknown,
        usage: { inputTokens, outputTokens, costUsd: dollars / 1_000_000 },
      }
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
    model: DECISION_MODEL,
    price: { input: DECISION_PRICE },
    async decide(request) {
      client ??= new OpenAI(options)
      const content = [
        text(request.context),
        ...request.images.slice(0, IMAGES_PER_REQUEST).map(picture),
      ]
      const answers: Answer[] = []
      let inputTokens = 0
      for (let start = 0; start < request.questions.length; start += QUESTIONS_PER_REQUEST) {
        const decision = await client.decisions
          .create({
            model: DECISION_MODEL,
            input: [{ role: 'user', content }],
            questions: request.questions
              .slice(start, start + QUESTIONS_PER_REQUEST)
              .map(toQuestion),
          })
          .catch((error: unknown) => {
            throw explain(error)
          })
        inputTokens += decision.usage.input_tokens
        for (const answer of decision.answers) {
          if (answer.type === 'predicate')
            answers.push({ type: 'predicate', probability: answer.probability })
          else if (answer.type === 'choice') {
            answers.push({
              type: 'choice',
              choice: String(answer.choice),
              confidence: answer.confidence,
            })
          } else answers.push({ type: 'refusal' })
        }
      }
      // Only input is charged; answers are free.
      return {
        answers,
        usage: {
          inputTokens,
          outputTokens: 0,
          costUsd: (inputTokens * DECISION_PRICE) / 1_000_000,
        },
      }
    },
  }
}

function toQuestion(question: Question) {
  return question.type === 'predicate'
    ? { type: 'predicate' as const, instructions: question.statement }
    : {
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
