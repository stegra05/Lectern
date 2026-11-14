/** An error the student can act on: what went wrong, and the fix. */
export class EngineError extends Error {
  readonly fix: string

  constructor(message: string, fix: string) {
    super(message)
    this.fix = fix
  }
}
