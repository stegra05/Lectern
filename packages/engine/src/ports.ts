/**
 * Everything the engine needs from outside. The engine itself touches no file system, no
 * network and no PDF library: the caller passes these in, so the same code runs from the
 * command line, in tests, inside the app and later on a server.
 */

export type Task = 'map' | 'fill' | 'repair' | 'split'

/** A slide as a picture: a PNG in base64. */
export interface SlideImage {
  slide: number
  png: string
}

export interface ModelRequest {
  /** Which step of the pipeline asks. Lets a scripted model tell the calls apart. */
  task: Task
  system: string
  /** The lecture as text. The same for every call about one lecture, so providers can cache it. */
  context: string
  /** Slides with little text, shown as pictures. They belong to the context. */
  images: SlideImage[]
  /** What this one call asks for. */
  prompt: string
  /** JSON Schema of the reply. Every object is closed and every property required. */
  schema: Record<string, unknown>
  /** How much the model should reason. Filling a form is recall, so it runs on `low`. */
  effort: 'low' | 'medium'
}

export interface Usage {
  /** All input tokens, the cached ones included. */
  inputTokens: number
  /** The part of the input the provider served from its prompt cache, at a lower price. */
  cachedInputTokens: number
  outputTokens: number
  costUsd: number
}

/** The one way to a model that writes. `data` is the parsed JSON reply. */
export interface ModelPort {
  readonly model: string
  /** List price in dollars per million tokens, for the estimate before a run. */
  readonly price: { input: number; cachedInput: number; output: number }
  complete(request: ModelRequest): Promise<{ data: unknown; usage: Usage }>
}

/** A closed question: how likely a statement is true, or which of a few values fits. */
export type Question =
  | { type: 'predicate'; statement: string }
  | { type: 'choice'; ask: string; choices: readonly string[] }

export type Answer =
  | { type: 'predicate'; probability: number }
  | { type: 'choice'; choice: string; confidence: number }
  | { type: 'refusal' }

export interface DecisionRequest {
  /** The input every question is about. Questions are batched per shared input. */
  context: string
  images: SlideImage[]
  questions: Question[]
}

/**
 * The one way to a decision model: every closed-set judgement of the pipeline goes through
 * here. It returns no text, only one answer per question, in order.
 */
export interface DecisionsPort {
  readonly model: string
  /** List price in dollars per million input tokens. Answers cost nothing. */
  readonly price: { input: number }
  decide(request: DecisionRequest): Promise<{ answers: Answer[]; usage: Usage }>
}

export interface PdfPort {
  /** The text lines of every slide, in slide order. A slide without text is an empty list. */
  readSlides(data: Uint8Array): Promise<string[][]>
  /** The given slides (1-based) as pictures, in the order asked. */
  renderSlides(data: Uint8Array, slides: number[]): Promise<SlideImage[]>
}

/** Plain files under one root. Paths use forward slashes and start with the course folder. */
export interface Store {
  /** The file as text, or null when it does not exist. */
  read(path: string): Promise<string | null>
  readBytes(path: string): Promise<Uint8Array>
  /** Writes the file and creates missing folders. */
  write(path: string, text: string): Promise<void>
  /** The names inside a folder, or an empty list when it does not exist. `''` is the root. */
  list(dir: string): Promise<string[]>
  /** Writes a binary file, such as an added PDF, and creates missing folders. */
  writeBytes(path: string, data: Uint8Array): Promise<void>
}

export interface Ports {
  store: Store
  pdf: PdfPort
  model: ModelPort
  decisions: DecisionsPort
  /** Milliseconds since the epoch. */
  now: () => number
}
