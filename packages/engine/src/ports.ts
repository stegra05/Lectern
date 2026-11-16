/**
 * Everything the engine needs from outside. The engine itself touches no file system, no
 * network and no PDF library: the caller passes these in, so the same code runs from the
 * command line, in tests, inside the app and later on a server.
 */

export type Task = 'read' | 'map' | 'fill' | 'repair' | 'split'

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
  /** Pictures only this call looks at. They come after the lecture, so the lecture stays cached. */
  shown?: SlideImage[]
  /** What this one call asks for. */
  prompt: string
  /** JSON Schema of the reply. Every object is closed and every property required. */
  schema: Record<string, unknown>
  /** How much the model should reason. Filling a form is recall, so it runs on `low`. */
  effort: 'low' | 'medium'
  /** Called with the cost of each billed call as soon as the provider reports it, even if the call then fails. */
  onUsage: (usage: Usage) => void
  /**
   * On the path every later step of the build waits for: asked on the provider's faster tier,
   * at `price.fast` times the list price.
   */
  fast?: boolean
}

export interface Usage {
  /** All input tokens, the cached ones included. */
  inputTokens: number
  /** The part of the input the provider served from its prompt cache, at a lower price. */
  cachedInputTokens: number
  outputTokens: number
  costUsd: number
}

/** The one way to a model that writes. The reply is the parsed JSON. */
export interface ModelPort {
  readonly model: string
  /**
   * List price in dollars per million tokens, for the estimate before a run, and how many times
   * that a call on the faster tier costs.
   */
  readonly price: { input: number; cachedInput: number; output: number; fast: number }
  complete(request: ModelRequest): Promise<unknown>
}

/** One step of an ordered scale, lowest first. */
export interface Level {
  label: string
  description: string
}

/**
 * A closed question: how likely a statement is true, which of a few values fits, or where the
 * input stands on an ordered scale.
 */
export type Question =
  | { type: 'predicate'; statement: string }
  | {
      type: 'choice'
      ask: string
      choices: readonly string[]
      /** What a choice means, by its value, where its name alone does not say it. */
      descriptions?: Readonly<Record<string, string>>
    }
  | { type: 'score'; ask: string; levels: readonly Level[] }

export type Answer =
  | { type: 'predicate'; probability: number }
  /** `probability`: how likely the chosen value is, with all choices sharing one whole. */
  | { type: 'choice'; choice: string; probability: number }
  /** From 0, the lowest level, to the number of levels minus one. Not a whole number. */
  | { type: 'score'; score: number }
  | { type: 'refusal' }

/** The most pictures one decision request may carry. */
export const MAX_DECISION_IMAGES = 128

export interface DecisionRequest {
  /** The input every question is about. Questions are batched per shared input. */
  context: string
  images: SlideImage[]
  questions: Question[]
  /** Called with the cost of each billed request as soon as the provider reports it. */
  onUsage: (usage: Usage) => void
}

/**
 * The one way to a decision model: every closed-set judgement of the pipeline goes through
 * here. It returns no text, only one answer per question, in order.
 */
export interface DecisionsPort {
  readonly model: string
  /** List price in dollars per million input tokens. Answers cost nothing. */
  readonly price: { input: number }
  decide(request: DecisionRequest): Promise<Answer[]>
}

/** A PDF that cannot be read, for a password or for damage, rejects with `UnreadablePdf`. */
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
  /** Moves a file, and creates missing folders. */
  move(from: string, to: string): Promise<void>
}

/** A note type as Anki holds it: its fields in order, one stylesheet and one card template. */
export interface NoteType {
  name: string
  cloze: boolean
  fields: readonly string[]
  css: string
  template: { name: string; front: string; back: string }
}

export interface Note {
  deck: string
  noteType: string
  fields: Record<string, string>
  tags: string[]
}

/**
 * The one way into the student's Anki. Every call fails with an error the student can act on
 * when Anki is not running or does not answer.
 */
export interface AnkiPort {
  /** The names of all note types. Also the first sign of whether Anki is there. */
  noteTypes(): Promise<string[]>
  /** The stylesheet of a note type as it is in Anki now. */
  styling(noteType: string): Promise<string>
  createNoteType(type: NoteType): Promise<void>
  /** Replaces the stylesheet and the template of a note type. Its notes keep their fields. */
  restyle(type: Pick<NoteType, 'name' | 'css' | 'template'>): Promise<void>
  /** The names of all decks, subdecks as `Parent::Child`. */
  deckNames(): Promise<string[]>
  /** Creates the deck and its parents. A deck that exists stays as it is. */
  createDeck(name: string): Promise<void>
  /**
   * Puts a file into Anki's media folder. `data` is base64. A file of that name is replaced.
   * The name must be lowercase: Anki 26 writes a new file under its name in lowercase, and a
   * card that asks for it in another case finds it on a Mac and not on a phone.
   */
  storeMedia(name: string, data: string): Promise<void>
  /** Adds one note and returns Anki's id for it. */
  addNote(note: Note): Promise<number>
  /** Replaces the fields of a note. Its cards keep their progress. */
  updateNote(id: number, fields: Record<string, string>): Promise<void>
  /** Deletes notes with their cards and their progress. A note that is not there is passed over. */
  deleteNotes(ids: number[]): Promise<void>
  /** Which of these notes are in Anki. */
  existingNotes(ids: number[]): Promise<number[]>
  /** The notes that carry this tag. */
  taggedNotes(tag: string): Promise<number[]>
}

/** What Lectern's note types are made of: the four templates and the stylesheet. */
export interface TemplateFiles {
  templates: { front: string; back: string; clozeFront: string; clozeBack: string }
  css: string
}

export interface TemplatesPort {
  load(): Promise<TemplateFiles>
}

export interface Ports {
  store: Store
  pdf: PdfPort
  model: ModelPort
  decisions: DecisionsPort
  anki: AnkiPort
  templates: TemplatesPort
  /** Milliseconds since the epoch. */
  now: () => number
}
