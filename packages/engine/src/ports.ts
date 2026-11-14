/**
 * Everything the engine needs from outside. The engine itself touches no file system, no
 * network and no PDF library: the caller passes these in, so the same code runs from the
 * command line, in tests, inside the app and later on a server.
 */

export type Task = 'map' | 'write' | 'rewrite'

export interface ModelRequest {
  /** Which step of the pipeline asks. Lets a scripted model tell the calls apart. */
  task: Task
  system: string
  prompt: string
  /** JSON Schema of the reply. Every object is closed and every property required. */
  schema: Record<string, unknown>
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

/** The one way to a model. `data` is the parsed JSON reply. */
export interface ModelPort {
  readonly model: string
  complete(request: ModelRequest): Promise<{ data: unknown; usage: Usage }>
}

export interface PdfPort {
  /** The text lines of every slide, in slide order. A slide without text is an empty list. */
  readSlides(data: Uint8Array): Promise<string[][]>
}

/** Plain files under one root. Paths use forward slashes and start with the course folder. */
export interface Store {
  /** The file as text, or null when it does not exist. */
  read(path: string): Promise<string | null>
  readBytes(path: string): Promise<Uint8Array>
  /** Writes the file and creates missing folders. */
  write(path: string, text: string): Promise<void>
  /** The names inside a folder, or an empty list when it does not exist. */
  list(dir: string): Promise<string[]>
}

export interface Ports {
  store: Store
  pdf: PdfPort
  model: ModelPort
  /** Milliseconds since the epoch. */
  now: () => number
}
