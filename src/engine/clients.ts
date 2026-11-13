/** The client for a provider. */

import { AnthropicClient } from './anthropic'
import type { ProviderId } from './config'
import { GeminiClient } from './gemini'
import type { LlmClient, RetryListener } from './llm'
import { OpenAIClient } from './openai'

export function createClient(
  provider: ProviderId,
  apiKey: string,
  fetchFn: typeof fetch,
  onRetry?: RetryListener,
): LlmClient {
  switch (provider) {
    case 'gemini':
      return new GeminiClient(apiKey, fetchFn, onRetry)
    case 'openai':
      return new OpenAIClient(apiKey, fetchFn, onRetry)
    case 'anthropic':
      return new AnthropicClient(apiKey, fetchFn, onRetry)
  }
}
