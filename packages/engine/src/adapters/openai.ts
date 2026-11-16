import { createHash } from 'node:crypto'
import OpenAI, { toFile } from 'openai'
import { EngineError } from '../errors.ts'
import { MAX_DECISION_IMAGES } from '../ports.ts'
import { pace } from './pace.ts'
import type { Answer, DecisionsPort, ModelPort, Question, SlideImage } from '../ports.ts'

/** Dollars per million tokens. Above `longFrom` prompt tokens the long card prices the whole request. */
const LUNA = 'gpt-6-luna'
const PRICES: Record<
  string,
  {
    input: number
    cachedInput: number
    output: number
    longInput: number
    longOutput: number
    /** Fast mode, checked for gpt-6-luna on 2026-11-16: twice every rate. */
    fast: number
  }
> = {
  [LUNA]: { input: 0.1, cachedInput: 0.01, output: 0.5, longInput: 0.2, longOutput: 0.75, fast: 2 },
  'gpt-6.1-terra': {
    input: 1,
    cachedInput: 0.05,
    output: 5,
    longInput: 2,
    longOutput: 7.5,
    fast: 2,
  },
}
const LONG_FROM = 272_000

/** The Decisions API takes this many questions and pictures per request. */
const QUESTIONS_PER_REQUEST = 200
/**
 * A run makes hundreds of calls and saves nothing until the end, so one dropped connection must
 * not end it. The SDK waits longer between each of these tries.
 */
const RETRIES = 6
/**
 * The pictures of a lecture go with every call about it, megabytes a call: sent inline they made
 * the upload the limit of a build (measured 2026-11-16, lecture 4 of Entrepreneurship: 14 MB a
 * call). So the writing model gets each picture once, as a file that expires after a day, and a
 * file is used for half of that at most.
 */
const FILE_SECONDS = 86_400
/**
 * What a call is counted at before it is answered: a slide picture at detail `auto` (measured
 * 709 input tokens for one picture with a line of text), four characters a text token, and a
 * margin for the reply.
 */
const PICTURE_TOKENS = 750
const REPLY_TOKENS = 1000

export interface OpenAIOptions {
  /** Defaults to the environment (`OPENAI_API_KEY`). */
  apiKey?: string
  /** Defaults to the environment (`OPENAI_BASE_URL`). */
  baseURL?: string
  /** How often a failed call is tried again. */
  maxRetries?: number
}

const picture = (image: SlideImage) => ({
  type: 'input_image' as const,
  image_url: `data:image/png;base64,${image.png}`,
  detail: 'auto' as const,
})
const uploaded = (fileId: string) => ({
  type: 'input_image' as const,
  file_id: fileId,
  detail: 'auto' as const,
})
type Part = ReturnType<typeof picture> | ReturnType<typeof uploaded>
const text = (value: string) => ({ type: 'input_text' as const, text: value })

/**
 * The lecture as input blocks, ending in a cache breakpoint. OpenAI only reuses a prompt
 * prefix up to an explicit breakpoint, and only between calls with the same reply format and
 * reasoning effort (measured 2026-11-14 on gpt-6-luna).
 */
function shared<P extends Part>(
  context: string,
  pictures: { slide: number; part: P }[],
  labelled: boolean,
) {
  const blocks = [
    text(context),
    ...pictures.flatMap(({ slide, part }) =>
      labelled ? [text(`Picture of slide ${slide}:`), part] : [part],
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
  const paced = pace()
  const files = new Map<string, { id: Promise<string>; at: number }>()
  /** The id of the picture as a file, uploaded on its first use. */
  const fileOf = (openai: OpenAI, image: SlideImage): Promise<string> => {
    const key = createHash('sha256').update(image.png).digest('hex')
    const known = files.get(key)
    if (known && Date.now() - known.at < (FILE_SECONDS * 1000) / 2) return known.id
    const id = toFile(Buffer.from(image.png, 'base64'), `slide-${image.slide}.png`, {
      type: 'image/png',
    })
      .then((file) =>
        openai.files.create({
          file,
          purpose: 'user_data',
          expires_after: { anchor: 'created_at', seconds: FILE_SECONDS },
        }),
      )
      .then((file) => file.id)
    files.set(key, { id, at: Date.now() })
    // A failed upload is tried again by the next call that needs it.
    id.catch(() => files.delete(key))
    return id
  }
  return {
    model,
    price,
    async complete(request) {
      const openai = (client ??= new OpenAI({ maxRetries: RETRIES, ...options }))
      const pictures = await Promise.all(
        request.images.map(async (image) => ({
          slide: image.slide,
          part: uploaded(await fileOf(openai, image)),
        })),
      ).catch((error: unknown) => {
        throw explain(error)
      })
      const pictureCount = request.images.length + (request.shown?.length ?? 0)
      const estimate =
        Math.ceil((request.system.length + request.context.length + request.prompt.length) / 4) +
        pictureCount * PICTURE_TOKENS +
        REPLY_TOKENS
      const response = await paced.run(estimate, async () => {
        const { data, response } = await openai.responses
          .create({
            model,
            instructions: request.system,
            input: [
              {
                role: 'user',
                content: [
                  ...shared(request.context, pictures, true),
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
            ...(request.fast ? { service_tier: 'fast' as const } : {}),
          })
          .withResponse()
          .catch((error: unknown) => {
            throw explain(error)
          })
        // A key without the header is not limited by tokens.
        const limit = Number(response.headers.get('x-ratelimit-limit-tokens') ?? Infinity)
        const used = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0)
        return { reply: data, limit: Number.isFinite(limit) ? limit : Infinity, tokens: used }
      })
      // The call is billed whatever it returned, so it is reported before anything can throw.
      const usage = response.usage
      const inputTokens = usage?.input_tokens ?? 0
      const cached = usage?.input_tokens_details.cached_tokens ?? 0
      const outputTokens = usage?.output_tokens ?? 0
      const long = inputTokens > LONG_FROM
      // A call moved down to standard speed comes back as `default` and is billed as one.
      const fast = response.service_tier === 'priority' || response.service_tier === 'fast'
      const dollars =
        ((inputTokens - cached) * (long ? price.longInput : price.input) +
          cached * price.cachedInput +
          outputTokens * (long ? price.longOutput : price.output)) *
        (fast ? price.fast : 1)
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
      if (request.images.length > MAX_DECISION_IMAGES) {
        throw new Error(
          `A decision request carries ${request.images.length} pictures, more than the ${MAX_DECISION_IMAGES} the API takes.`,
        )
      }
      client ??= new OpenAI({ maxRetries: RETRIES, ...options })
      const pictures = request.images.map((image) => ({ slide: image.slide, part: picture(image) }))
      const content = shared(request.context, pictures, true)
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
