/** An error the student can act on: what went wrong, and the fix. */
export class EngineError extends Error {
  readonly fix: string

  constructor(message: string, fix: string) {
    super(message)
    this.fix = fix
  }
}

/**
 * A model provider's failure, by what it means for the next step. `rejected`: the provider
 * refused the request for what it holds, so sending it again changes nothing. The others are
 * about the key, the account, the connection or the provider, and stop every request alike.
 */
export class ProviderError extends EngineError {
  readonly reason: 'key' | 'credit' | 'limit' | 'connection' | 'rejected' | 'server'

  constructor(message: string, fix: string, reason: ProviderError['reason']) {
    super(message, fix)
    this.reason = reason
  }
}

/** Anki is closed, or its AnkiConnect add-on is not running. The two look the same from here. */
export function ankiNotOpen(): EngineError {
  return new EngineError(
    'Anki is not open.',
    'Open Anki and wait until you see your decks, then try again. If Anki is open, restart it once so the AnkiConnect add-on starts.',
  )
}
