/** An error the student can act on: what went wrong, and the fix. */
export class EngineError extends Error {
  readonly fix: string

  constructor(message: string, fix: string) {
    super(message)
    this.fix = fix
  }
}

/** Anki is closed, or its AnkiConnect add-on is not running. The two look the same from here. */
export function ankiNotOpen(): EngineError {
  return new EngineError(
    'Anki is not open.',
    'Open Anki and wait until you see your decks, then try again. If Anki is open, restart it once so the AnkiConnect add-on starts.',
  )
}
