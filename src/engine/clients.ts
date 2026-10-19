/** The client for whichever provider serves a model. */

import { AnthropicClient } from './anthropic'
import { providerOf } from './config'
import { GeminiClient } from './gemini'
import type { LlmClient, RetryListener } from './llm'
import { OpenAIClient } from './openai'

export function createClient(
  model: string,
  apiKey: string,
  fetchFn: typeof fetch,
  onRetry?: RetryListener,
): LlmClient {
  switch (providerOf(model)) {
    case 'gemini':
      return new GeminiClient(apiKey, fetchFn, onRetry)
    case 'openai':
      return new OpenAIClient(apiKey, fetchFn, onRetry)
    case 'anthropic':
      return new AnthropicClient(apiKey, fetchFn, onRetry)
  }
}
