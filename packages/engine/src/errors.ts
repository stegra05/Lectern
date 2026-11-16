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

/** Why a PDF cannot be read. */
export type Unreadable = 'password' | 'damaged'

/** What a PdfPort throws for a PDF it cannot read. It knows no file name; its caller does. */
export class UnreadablePdf extends Error {
  readonly why: Unreadable

  constructor(why: Unreadable) {
    super(why === 'password' ? 'The PDF is protected by a password.' : 'The PDF is damaged.')
    this.why = why
  }
}

/** What reading a PDF gives, or why it cannot be read. Every other failure goes on. */
export async function orUnreadable<T extends object>(read: Promise<T>): Promise<T | Unreadable> {
  try {
    return await read
  } catch (error) {
    if (error instanceof UnreadablePdf) return error.why
    throw error
  }
}

/** A PDF that cannot be read, in the student's words, with its file name. */
export function cannotRead(file: string, why: Unreadable): EngineError {
  return why === 'password'
    ? new EngineError(
        `${file} is protected by a password, so Lectern cannot read it.`,
        'Save a copy without the password, then add that copy.',
      )
    : new EngineError(
        `${file} is damaged, so Lectern cannot read it.`,
        'Download or export the file again, then add the new copy.',
      )
}
