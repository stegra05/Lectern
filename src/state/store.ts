/**
 * The single UI store. Pipeline events land here as direct state updates —
 * there is no transport, no event translation, no split-brain.
 */

import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { create } from 'zustand'
import { AnkiClient, checkConnection, isSyncable, previewSync, syncCards } from '../engine/anki'
import {
  countDeckNotes,
  fetchDeckCards,
  looksLikeSameSet,
  MAX_IMPORT_CARDS,
} from '../engine/ankiImport'
import { buildLedgerLecture, mergeLedger, sha256Hex } from '../engine/ledger'
import { readDeckLedger, writeDeckLedger } from '../lib/ledgerStore'
import {
  appendCalibrationRun,
  calibrationFactors,
  type CalibrationLog,
} from '../engine/calibration'
import { readCalibrationLog, writeCalibrationLog } from '../lib/calibrationStore'
import { provenanceFieldValues } from '../engine/noteTypes'
import { ensureLecternModels, migrateNotesToLectern } from '../engine/noteTypeSync'
import { loadNoteTypeFonts } from '../lib/noteTypeFonts'
import { estimateCost, type CostEstimate } from '../engine/cost'
import { evaluateCard } from '../engine/quality'
import { extractPdfInfo, openPdf, renderPageThumbnail } from '../engine/pdf'
import { runFollowUp } from '../engine/followUp'
import { runPipeline, type FollowUpSeed } from '../engine/pipeline'
import type {
  Card,
  ConceptMap,
  CoverageData,
  PdfInfo,
  PipelineEvent,
  Settings,
  SizingPlan,
  SyncPreview,
  SyncProgress,
  SyncResult,
} from '../engine/types'
import { computeSizingPlan } from '../engine/pacing'
import { count } from '../engine/plural'
import { confirmUnsentDiscard } from '../lib/confirm'
import type { Link } from '../lib/links'
import { describeProblem, describeSyncFailure, type Activity, type Problem } from '../lib/problems'
import { describeReasons } from '../lib/qualityCopy'
import { plainCardText } from '../lib/render'
import { notifyRunFinished } from '../lib/notify'
import { IS_TAURI } from '../lib/platform'
import { getApiKey, loadSettings, saveSettings } from '../lib/settings'
import { tauriFetch } from '../lib/tauriFetch'

const THUMBNAIL_PAGE_LIMIT = 150
const UNDO_WINDOW_MS = 30_000
/** Render width for the slide peek panel (2x a ~550px panel). */
const SLIDE_PEEK_RENDER_WIDTH = 1100

// The open pdf.js document, kept out of the store (not serializable state).
// Owned by loadPdfFromBytes; used by peekSlide for on-demand full renders.
let currentDoc: PDFDocumentProxy | null = null
const slideRendersInFlight = new Set<number>()

export interface LogLine {
  level: 'info' | 'warn' | 'error'
  message: string
  /** Prose from the model or a card, quoted under the message in serif. */
  quote?: string
  /** 'user' marks a follow-up request typed into the activity log. */
  speaker?: 'user'
  /** Consecutive events of one kind (rejected cards, cards Anki already
   *  had, cards that failed to send) fold into a single line whose details
   *  open on demand, instead of one line each. */
  group?: 'rejected' | 'duplicate' | 'failed'
  items?: Array<{ message: string; quote?: string }>
  at: number
}

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
  /** A second, quieter line: the fix, when the message is a problem. */
  detail?: string
  action?: { label: string; run: () => void }
  link?: Link
}

type ToastOptions = Pick<Toast, 'detail' | 'action' | 'link'>

export type AppPhase =
  'idle' | 'uploading' | 'mapping' | 'generating' | 'reflecting' | 'complete' | 'error'

interface LecternState {
  // boot + connections
  settings: Settings | null
  hasApiKey: boolean
  ankiStatus: 'unknown' | 'checking' | 'connected' | 'offline'
  ankiDecks: string[]
  settingsOpen: boolean
  /** The concept-map sheet. In the store rather than in Sidebar's local
   *  state because the card shortcuts have to know a modal is open. */
  conceptsOpen: boolean

  // source document
  fileName: string | null
  /** Where the PDF lives on disk; null when it arrived as bytes only
   *  (browser mode). Recorded in the deck ledger so later features can
   *  re-read the document. */
  pdfPath: string | null
  pdfBytes: Uint8Array | null
  pdfInfo: PdfInfo | null
  pageThumbs: Record<number, string>
  estimate: CostEstimate | null

  // session
  view: 'home' | 'session'
  phase: AppPhase
  deckName: string
  /** Notes already in the named Anki deck; null while unknown (Anki offline,
   *  no name typed, or a probe still in flight). */
  existingDeckCount: number | null
  /** Keep those cards and generate around them, rather than starting over. */
  extendDeck: boolean
  focusPrompt: string
  targetCards: number | null
  conceptMap: ConceptMap | null
  sizing: SizingPlan | null
  cards: Card[]
  coverage: CoverageData | null
  logs: LogLine[]
  progress: { produced: number; cap: number; round: number } | null
  usage: { inputTokens: number; outputTokens: number; costUsd: number } | null
  doneSummary: string | null
  /** How long the finished run took, for the sidebar's closing line. */
  runMs: number | null
  /** Why the run stopped; null unless phase is 'error'. */
  problem: Problem | null
  /** Conversation handle for post-completion card requests; null until the
   *  pipeline completes. */
  followUp: FollowUpSeed | null
  followUpBusy: boolean
  /** A retry wait in progress: until when, and the HTTP status behind it.
   *  Shown as a countdown, so a paused run does not look like a hung one. */
  wait: { until: number; waitMs: number; status: number } | null

  // review
  editingUid: string | null
  selectedUid: string | null
  searchQuery: string
  pageFilter: number | null
  /** Page shown in the slide peek panel, null when closed. */
  slidePeek: number | null
  /** Full-size page renders for the peek panel, keyed by page number. */
  slideRenders: Record<number, string>

  // sync
  syncState: 'idle' | 'syncing' | 'done'
  syncPreview: SyncPreview | null
  syncProgress: SyncProgress | null
  syncResult: SyncResult | null
  migratingCards: boolean

  toasts: Toast[]
}

interface LecternActions {
  init: () => Promise<void>
  /** Probe AnkiConnect. Pass a URL to test one the user is still typing in
   *  Settings, rather than the saved one. */
  refreshAnki: (urlOverride?: string) => Promise<void>
  openSettings: (open: boolean) => void
  openConcepts: (open: boolean) => void
  applySettings: (settings: Settings) => Promise<void>
  setHasApiKey: (has: boolean) => void

  pickPdf: () => Promise<void>
  loadPdfFromPath: (path: string) => Promise<void>
  loadPdfFromBytes: (fileName: string, bytes: Uint8Array) => Promise<void>
  setDeckName: (name: string) => void
  setExtendDeck: (extend: boolean) => void
  /** Count the notes in the named deck, so the home view can offer to keep
   *  them. Debounced by setDeckName; safe to call directly. */
  probeExistingDeck: () => Promise<void>
  setFocusPrompt: (focus: string) => void
  setTargetCards: (target: number | null) => void

  startGeneration: () => Promise<void>
  cancelGeneration: () => void
  /** Start the run again after an error, asking first if that would discard
   *  cards that never reached Anki. */
  retryGeneration: () => Promise<void>
  backToHome: () => Promise<void>
  /** Post-completion chat: ask Gemini for additional cards. Additions only —
   *  the existing deck is never edited. */
  requestMoreCards: (text: string) => Promise<void>

  updateCardFields: (uid: string, fields: Record<string, string>) => void
  removeCard: (uid: string) => void
  /** Opt an outside-source card in or out of the Anki send. */
  setCardSyncExcluded: (uid: string, excluded: boolean) => void
  setEditingUid: (uid: string | null) => void
  setSelectedUid: (uid: string | null) => void
  setSearchQuery: (q: string) => void
  setPageFilter: (page: number | null) => void
  peekSlide: (page: number | null) => void

  previewSyncNow: () => Promise<void>
  /** Show the deck in Anki's card browser, where the sent cards now live. */
  openDeckInAnki: () => Promise<void>
  syncNow: () => Promise<void>
  /** One-time action: move earlier plain Basic/Cloze syncs (found via the
   *  default tag) onto the Lectern note types. */
  migrateLegacyCards: () => Promise<void>

  toast: (kind: Toast['kind'], message: string, options?: ToastOptions) => void
  /** Describe an error and show it as a toast, with its fix attached. */
  showProblem: (error: unknown, activity: Activity) => void
  dismissToast: (id: number) => void
}

let abortController: AbortController | null = null
let toastSeq = 1
/** In-memory copy of the persisted estimate-vs-actual history. Loaded once at
 *  init, updated after every completed run; estimates read it synchronously. */
let calibrationLog: CalibrationLog | null = null
/** Debounce + last-writer-wins guards for the deck probe, which fires on
 *  every keystroke in the deck field. */
let deckProbeTimer: number | null = null
let deckProbeSeq = 0
const DECK_PROBE_DEBOUNCE_MS = 400
/** Last-writer-wins guard for the automatic send preview. */
let syncPreviewSeq = 0
/** When the current run began, for the finished run's duration. */
let runStartedAt = 0

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

export const useLectern = create<LecternState & LecternActions>()((set, get) => {
  const pushLog = (
    level: LogLine['level'],
    message: string,
    quote?: string,
    speaker?: LogLine['speaker'],
  ) =>
    set((s) => ({
      logs: [...s.logs.slice(-400), { level, message, quote, speaker, at: Date.now() }],
    }))

  /** Add an item to the open group of this kind, or start one. */
  const pushGrouped = (
    group: NonNullable<LogLine['group']>,
    level: LogLine['level'],
    heading: (n: number) => string,
    item: { message: string; quote?: string },
  ) =>
    set((s) => {
      const last = s.logs.at(-1)
      if (last?.group === group && last.items) {
        const items = [...last.items, item]
        return {
          logs: [...s.logs.slice(0, -1), { ...last, message: heading(items.length), items }],
        }
      }
      const line: LogLine = { level, message: heading(1), group, items: [item], at: Date.now() }
      return { logs: [...s.logs.slice(-400), line] }
    })

  const handlePipelineEvent = (event: PipelineEvent): void => {
    switch (event.type) {
      case 'phase':
        set({ phase: event.phase })
        break
      case 'log':
        pushLog(event.level, event.message, event.quote)
        break
      case 'concept_map':
        set({ conceptMap: event.conceptMap, sizing: event.sizing })
        break
      case 'card_accepted':
        set((s) => ({ cards: [...s.cards, event.card] }))
        break
      case 'card_rejected':
        pushGrouped('rejected', 'warn', (n) => `${count(n, 'card')} rejected`, {
          message: capitalize(describeReasons(event.reasons)),
          quote: plainCardText(event.front),
        })
        break
      case 'cards_replaced':
        set({ cards: event.cards })
        break
      case 'coverage':
        set({ coverage: event.coverage })
        break
      case 'progress':
        set({ progress: { produced: event.produced, cap: event.cap, round: event.round } })
        break
      case 'usage':
        set({
          usage: {
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            costUsd: event.costUsd,
          },
        })
        break
      case 'done':
        set({ doneSummary: event.summary, runMs: Date.now() - runStartedAt })
        pushLog('info', event.summary)
        break
      case 'waiting':
        set({
          wait: { until: Date.now() + event.waitMs, waitMs: event.waitMs, status: event.status },
        })
        // Said live by the countdown under the current step, not in the log.
        break
    }
  }

  /**
   * A send report describes the deck as it was when it was sent. Once a card
   * is edited, removed, or opted in, the bar has to go back to saying what
   * the *next* send would do — otherwise it sits on "Sent 40 cards / Send
   * again" for the rest of the session, with no hint that pressing it now
   * updates all forty.
   */
  const staleSync = (s: LecternState): Partial<LecternState> =>
    s.syncState === 'done' ? { syncState: 'idle', syncResult: null, syncPreview: null } : {}

  const scheduleDeckProbe = () => {
    if (deckProbeTimer !== null) window.clearTimeout(deckProbeTimer)
    deckProbeTimer = window.setTimeout(() => {
      deckProbeTimer = null
      void get().probeExistingDeck()
    }, DECK_PROBE_DEBOUNCE_MS)
  }

  const refreshEstimate = () => {
    const { pdfInfo, settings, targetCards } = get()
    if (!pdfInfo || !settings) return
    const sizing = computeSizingPlan(pdfInfo, { userTargetCards: targetCards ?? undefined })
    const factors = calibrationFactors(calibrationLog, settings.model)
    set({ estimate: estimateCost(pdfInfo, sizing, settings.model, factors), sizing })
  }

  /**
   * Write a completed run's estimate-vs-actual pair to the calibration log,
   * so future estimates learn from it. Best-effort like the deck ledger: a
   * miss only costs calibration accuracy, never the run.
   */
  const recordCalibrationRun = async (
    estimate: CostEstimate,
    sizing: SizingPlan,
    pdfInfo: PdfInfo,
    model: string,
    actual: { inputTokens: number; outputTokens: number; costUsd: number },
    cardCount: number,
  ): Promise<void> => {
    try {
      calibrationLog = appendCalibrationRun(calibrationLog ?? (await readCalibrationLog()), {
        at: new Date().toISOString(),
        model,
        pageCount: pdfInfo.pageCount,
        textChars: pdfInfo.textChars,
        imageCount: pdfInfo.imageCount,
        totalCardCap: sizing.totalCardCap,
        batchSize: sizing.batchSize,
        cardCount,
        estimated: estimate,
        actual,
      })
      await writeCalibrationLog(calibrationLog)
    } catch (e) {
      // Bookkeeping the student never sees; a miss only blunts the next estimate.
      console.warn('Could not record the cost calibration log:', e)
    }
  }

  /** Best-effort install/upgrade of the bundled note types. Failure is not
   *  fatal: model resolution falls back to plain Basic/Cloze when the
   *  Lectern types are absent. */
  const ensureNoteTypes = async (
    client: AnkiClient,
    settings: Settings,
    /** Report the outcome as a toast too — a design change made from Home
     *  has no activity log to land in, and used to look like nothing. */
    announce = false,
  ): Promise<void> => {
    if (!settings.useLecternNoteTypes) return
    try {
      const result = await ensureLecternModels(client, settings.noteTypeTheme, loadNoteTypeFonts)
      if (result.created.length > 0) {
        const noun = result.created.length === 1 ? 'note type' : 'note types'
        pushLog('info', `Added the ${result.created.join(' and ')} ${noun} to Anki.`)
      }
      if (result.updated.length > 0) {
        pushLog('info', `Restyled ${result.updated.join(' and ')} in Anki.`)
      }
      if (result.userOwned.length > 0) {
        pushLog(
          'info',
          `${result.userOwned.join(' and ')}: styling was edited in Anki, so Lectern leaves it as is.`,
        )
      }
      if (result.newerVersion.length > 0) {
        pushLog(
          'info',
          `${result.newerVersion.join(' and ')} came from a newer Lectern, so Lectern leaves it as is.`,
        )
      }
      if (result.fieldMismatch.length > 0) {
        pushLog(
          'warn',
          `${result.fieldMismatch.join(' and ')} in Anki has different fields from Lectern's, ` +
            'so it is left alone. Cards sent to it carry no Topic, Source or Excerpt.',
        )
      }
      if (!announce) return
      if (result.updated.length > 0) {
        get().toast('success', 'Card design applied. Cards in Anki show it right away.')
      } else if (result.userOwned.length > 0) {
        get().toast(
          'info',
          `Left as it is: you edited the styling of ${result.userOwned.join(' and ')} in Anki.`,
        )
      } else if (result.newerVersion.length > 0) {
        get().toast('info', 'A newer Lectern installed these note types, so they stay as they are.')
      }
    } catch (e) {
      const problem = describeProblem(e, 'styling')
      pushLog('warn', `${problem.title}. ${problem.body}`)
      if (announce) get().showProblem(e, 'styling')
    }
  }

  /**
   * The slide-set name written onto cards. The model names the set fresh on
   * every run ("ML Lecture 2" one week, "Machine Learning Lecture 2" the
   * next), which would file the same lecture under two different tags; when
   * the deck already holds cards from this document, their spelling wins.
   */
  const slideSetName = (): string => {
    const fromModel = get().conceptMap?.slideSetName ?? ''
    const inherited = get().cards.find(
      (card) => card.sourceSetName !== undefined && looksLikeSameSet(card.sourceSetName, fromModel),
    )
    return inherited?.sourceSetName ?? fromModel
  }

  /**
   * Write the session's provenance to the deck ledger after a send. Runs
   * best-effort off the sync path: the cards are in Anki either way, and a
   * ledger miss only costs future insights, so failure is a log line — never
   * a sync error.
   */
  const recordSyncedDeck = async (): Promise<void> => {
    const { conceptMap, cards, deckName, pdfPath, pdfBytes } = get()
    if (!conceptMap || !deckName.trim()) return
    try {
      const lecture = buildLedgerLecture({
        conceptMap,
        cards,
        slideSetName: slideSetName() || conceptMap.slideSetName,
        pdfPath,
        pdfSha256: pdfBytes ? await sha256Hex(pdfBytes) : null,
        syncedAt: new Date().toISOString(),
      })
      if (lecture.cards.length === 0) return
      const existing = await readDeckLedger(deckName)
      await writeDeckLedger(mergeLedger(existing, deckName, lecture))
    } catch (e) {
      // Bookkeeping the student never sees; the cards are in Anki either way.
      console.warn('Could not record the deck ledger:', e)
    }
  }

  /** Topic/Source/Excerpt values for the Lectern note types. */
  const noteExtras = (card: Card): Record<string, string> => {
    const runSet = slideSetName()
    // A card from a different lecture sharing this deck: this run knows
    // neither its pages (adoptExistingCards drops them) nor its document, so
    // it writes no provenance rather than replacing the note's own with a
    // wrong one.
    if (card.sourceSetName !== undefined && !looksLikeSameSet(card.sourceSetName, runSet)) {
      return {}
    }
    return provenanceFieldValues(card, card.sourceSetName ?? runSet)
  }

  return {
    settings: null,
    hasApiKey: false,
    ankiStatus: 'unknown',
    ankiDecks: [],
    settingsOpen: false,
    conceptsOpen: false,

    fileName: null,
    pdfPath: null,
    pdfBytes: null,
    pdfInfo: null,
    pageThumbs: {},
    estimate: null,

    view: 'home',
    phase: 'idle',
    deckName: '',
    existingDeckCount: null,
    // Keeping what is already there is the safe default; it only takes effect
    // once a probe finds cards in the named deck.
    extendDeck: true,
    focusPrompt: '',
    targetCards: null,
    conceptMap: null,
    sizing: null,
    cards: [],
    coverage: null,
    logs: [],
    progress: null,
    usage: null,
    doneSummary: null,
    runMs: null,
    problem: null,
    followUp: null,
    followUpBusy: false,
    wait: null,

    editingUid: null,
    selectedUid: null,
    searchQuery: '',
    pageFilter: null,
    slidePeek: null,
    slideRenders: {},

    syncState: 'idle',
    syncPreview: null,
    syncProgress: null,
    syncResult: null,
    migratingCards: false,

    toasts: [],

    init: async () => {
      const settings = await loadSettings()
      const key = await getApiKey().catch(() => null)
      calibrationLog = await readCalibrationLog()
      set({ settings, hasApiKey: Boolean(key) })
      void get().refreshAnki()
    },

    refreshAnki: async (urlOverride) => {
      const { settings, ankiStatus } = get()
      if (!settings) return
      // Focus-triggered re-probes shouldn't flicker an already-green dot.
      if (ankiStatus !== 'connected' || urlOverride) set({ ankiStatus: 'checking' })
      const client = new AnkiClient(urlOverride ?? settings.ankiUrl, tauriFetch)
      const status = await checkConnection(client)
      if (status.ok) {
        const decks = await client.deckNames().catch(() => [] as string[])
        set({ ankiStatus: 'connected', ankiDecks: decks })
        // Anki just became reachable — the deck in the field can be looked up.
        void get().probeExistingDeck()
      } else {
        set({ ankiStatus: 'offline', ankiDecks: [], existingDeckCount: null })
      }
    },

    openSettings: (open) => set({ settingsOpen: open }),

    openConcepts: (open) => set({ conceptsOpen: open }),

    applySettings: async (settings) => {
      const before = get().settings
      await saveSettings(settings)
      set({ settings })
      refreshEstimate()
      void get().refreshAnki()
      // Theme switches restyle every synced Lectern card immediately.
      const designChanged =
        settings.useLecternNoteTypes &&
        (before?.useLecternNoteTypes !== settings.useLecternNoteTypes ||
          before?.noteTypeTheme !== settings.noteTypeTheme)
      if (designChanged) {
        void ensureNoteTypes(new AnkiClient(settings.ankiUrl, tauriFetch), settings, true)
      }
    },

    setHasApiKey: (has) => set({ hasApiKey: has }),

    pickPdf: async () => {
      if (!IS_TAURI) {
        // Plain-browser dev mode: use a file input instead of the native dialog.
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/pdf'
        input.onchange = async () => {
          const file = input.files?.[0]
          if (file) {
            await get().loadPdfFromBytes(file.name, new Uint8Array(await file.arrayBuffer()))
          }
        }
        input.click()
        return
      }
      const path = await openDialog({
        multiple: false,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (typeof path === 'string') await get().loadPdfFromPath(path)
    },

    loadPdfFromPath: async (path) => {
      if (!path.toLowerCase().endsWith('.pdf')) {
        get().toast('error', 'Lectern reads PDF files only.')
        return
      }
      const fileName = path.split('/').pop() ?? 'document.pdf'
      try {
        const bytes = await readFile(path)
        await get().loadPdfFromBytes(fileName, bytes)
        // loadPdfFromBytes only knows bytes; the path is this caller's to
        // record — but only if that load actually took (it toasts and leaves
        // the previous document in place when the file is unreadable).
        if (get().fileName === fileName && get().pdfBytes === bytes) set({ pdfPath: path })
      } catch (e) {
        get().showProblem(e, 'opening_pdf')
      }
    },

    loadPdfFromBytes: async (fileName, bytes) => {
      try {
        const doc = await openPdf(bytes)
        const pdfInfo = await extractPdfInfo(doc)
        void currentDoc?.loadingTask.destroy().catch(() => {})
        currentDoc = doc
        slideRendersInFlight.clear()
        // A deck name the user typed survives swapping the PDF; one Lectern
        // suggested from the previous file name follows the new file, so
        // "Replace" doesn't leave last lecture's deck on this lecture.
        const suggestedFrom = (name: string) => name.replace(/\.pdf$/i, '')
        const previousDeck = get().deckName
        const wasSuggested = previousDeck === suggestedFrom(get().fileName ?? '')
        const suggestedDeck = !previousDeck || wasSuggested ? suggestedFrom(fileName) : previousDeck
        set({
          fileName,
          pdfPath: null,
          pdfBytes: bytes,
          pdfInfo,
          pageThumbs: {},
          slidePeek: null,
          slideRenders: {},
          deckName: suggestedDeck,
          existingDeckCount: null,
        })
        refreshEstimate()
        // The suggested deck name may well be one that already exists.
        void get().probeExistingDeck()

        // Render thumbnails progressively; the filmstrip fills in as they land.
        const pages = Math.min(pdfInfo.pageCount, THUMBNAIL_PAGE_LIMIT)
        for (let p = 1; p <= pages; p++) {
          if (get().fileName !== fileName) break // replaced meanwhile
          try {
            const url = await renderPageThumbnail(doc, p, 240)
            set((s) => ({ pageThumbs: { ...s.pageThumbs, [p]: url } }))
          } catch {
            // skip unrenderable page
          }
        }
      } catch (e) {
        get().showProblem(e, 'opening_pdf')
      }
    },

    setDeckName: (name) => {
      // Trimmed here rather than at each use: "Stats " and "Stats" are two
      // different decks to Anki, and the probe, the import and createDeck all
      // took the raw string while only the validity check trimmed it.
      // Interior spaces are the user's business; the ends never are.
      set({ deckName: name.replace(/^\s+/, '').replace(/\s+$/, ''), existingDeckCount: null })
      scheduleDeckProbe()
    },

    setExtendDeck: (extend) => set({ extendDeck: extend }),

    probeExistingDeck: async () => {
      const { settings, deckName, ankiStatus } = get()
      if (!settings || ankiStatus !== 'connected' || !deckName.trim()) {
        set({ existingDeckCount: null })
        return
      }
      const seq = ++deckProbeSeq
      try {
        const client = new AnkiClient(settings.ankiUrl, tauriFetch)
        const count = await countDeckNotes(client, deckName)
        if (seq === deckProbeSeq) set({ existingDeckCount: count })
      } catch {
        // Unknown beats wrong: the extend offer simply does not appear.
        if (seq === deckProbeSeq) set({ existingDeckCount: null })
      }
    },

    setFocusPrompt: (focus) => set({ focusPrompt: focus }),
    setTargetCards: (target) => {
      set({ targetCards: target })
      refreshEstimate()
    },

    startGeneration: async () => {
      const {
        pdfBytes,
        pdfInfo,
        fileName,
        settings,
        deckName,
        focusPrompt,
        targetCards,
        extendDeck,
        existingDeckCount,
        estimate,
        sizing,
      } = get()
      if (!pdfBytes || !pdfInfo || !fileName || !settings) return
      const apiKey = await getApiKey().catch(() => null)
      if (!apiKey) {
        set({ settingsOpen: true })
        get().toast('error', 'Add your Gemini API key in Settings to generate cards.')
        return
      }
      if (!deckName.trim()) {
        get().toast('error', 'Name the target deck first.')
        return
      }

      const controller = new AbortController()
      abortController = controller
      runStartedAt = Date.now()
      set({
        view: 'session',
        phase: 'uploading',
        cards: [],
        coverage: null,
        conceptMap: null,
        logs: [],
        progress: null,
        usage: null,
        doneSummary: null,
        runMs: null,
        problem: null,
        wait: null,
        followUp: null,
        followUpBusy: false,
        syncState: 'idle',
        syncPreview: null,
        syncResult: null,
        editingUid: null,
        selectedUid: null,
        searchQuery: '',
        pageFilter: null,
        slidePeek: null,
      })

      // An extend run inherits the deck that is already in Anki. Reading it
      // is a precondition, not a nicety: generating without it would produce
      // a second copy of cards the user already has, so a failure here stops
      // the run instead of quietly starting over.
      let existingCards: Card[] = []
      if (extendDeck && (existingDeckCount ?? 0) > 0) {
        try {
          const client = new AnkiClient(settings.ankiUrl, tauriFetch)
          const imported = await fetchDeckCards(client, deckName)
          existingCards = imported.cards
          set({ cards: existingCards })
          pushLog(
            'info',
            `Keeping the ${count(imported.cards.length, 'card')} already in “${deckName}”. This run adds to them.`,
          )
          if (imported.truncated) {
            pushLog(
              'warn',
              `“${deckName}” holds ${imported.totalNotes} notes; only the first ${MAX_IMPORT_CARDS} were read. ` +
                'Cards beyond that may be duplicated.',
            )
          }
          const unreadable = Math.min(imported.totalNotes, MAX_IMPORT_CARDS) - imported.cards.length
          if (unreadable > 0) {
            pushLog(
              'warn',
              `${count(unreadable, 'note')} in the deck could not be read, so Lectern skips them.`,
            )
          }
        } catch (e) {
          const problem = describeProblem(e, 'reading_deck')
          set({
            phase: 'error',
            problem: {
              ...problem,
              body:
                `${problem.body} Nothing was generated yet: without the cards already in ` +
                `“${deckName}”, this run would repeat them.`,
            },
          })
          return
        }
      }

      try {
        const outcome = await runPipeline({
          pdfBytes,
          pdfInfo,
          fileName,
          focusPrompt: focusPrompt || undefined,
          userTargetCards: targetCards ?? undefined,
          existingCards,
          model: settings.model,
          apiKey,
          fetchFn: tauriFetch,
          emit: handlePipelineEvent,
          signal: controller.signal,
        })
        set({ followUp: outcome.followUp })
        if (estimate && sizing) {
          void recordCalibrationRun(
            estimate,
            sizing,
            pdfInfo,
            settings.model,
            outcome.usage,
            outcome.cards.length - existingCards.length,
          )
        }
        void notifyRunFinished({
          enabled: settings.notifyOnFinish,
          title: `${deckName} is ready`,
          body: get().doneSummary ?? `${count(get().cards.length, 'card')} waiting for review.`,
        })
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          set({ view: 'home', phase: 'idle' })
          get().toast('info', 'Generation cancelled.')
        } else {
          const problem = describeProblem(e, 'generating')
          set({ phase: 'error', problem })
          pushLog('error', problem.title)
          // Worth interrupting for: a failed run is exactly what you walked
          // away from the window expecting not to happen.
          void notifyRunFinished({
            enabled: settings.notifyOnFinish,
            title: 'Lectern stopped generating',
            body: problem.title,
          })
        }
      } finally {
        if (abortController === controller) abortController = null
        set({ wait: null })
      }
    },

    cancelGeneration: () => abortController?.abort(),

    requestMoreCards: async (text) => {
      const { settings, conceptMap, followUp, followUpBusy, cards, focusPrompt, pdfInfo } = get()
      const request = text.trim()
      if (!request || !settings || !conceptMap || !followUp || followUpBusy) return
      const apiKey = await getApiKey().catch(() => null)
      if (!apiKey) {
        set({ settingsOpen: true })
        get().toast('error', 'Add your Gemini API key in Settings first.')
        return
      }

      const controller = new AbortController()
      abortController = controller
      set({ followUpBusy: true })
      pushLog('info', request, undefined, 'user')

      try {
        const outcome = await runFollowUp({
          request,
          deck: cards,
          conceptMap,
          seed: followUp,
          focusPrompt: focusPrompt || undefined,
          pdfInfo: pdfInfo ?? undefined,
          model: settings.model,
          apiKey,
          fetchFn: tauriFetch,
          emit: handlePipelineEvent,
          signal: controller.signal,
        })
        set((s) => ({
          followUp: outcome.seed,
          ...staleSync(s),
          usage: {
            inputTokens: (s.usage?.inputTokens ?? 0) + outcome.usage.inputTokens,
            outputTokens: (s.usage?.outputTokens ?? 0) + outcome.usage.outputTokens,
            costUsd: (s.usage?.costUsd ?? 0) + outcome.usage.costUsd,
          },
        }))
        const added = outcome.added.length
        const outside = outcome.outsideSourceCount
        const optIn = `Lectern leaves ${outside === 1 ? 'it' : 'them'} out of the Anki send until you include ${outside === 1 ? 'it' : 'them'}`
        const outsideNote =
          outside === 0
            ? ''
            : outside === added
              ? outside === 1
                ? ` It is not from the lecture. ${optIn}.`
                : ` None of them are from the lecture. ${optIn}.`
              : ` ${outside} of them ${outside === 1 ? 'is' : 'are'} not from the lecture. ${optIn}.`
        pushLog(
          'info',
          added === 0
            ? 'No cards were added for this request.'
            : `Added ${count(added, 'card')}.${outsideNote}`,
          outcome.note,
        )
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          pushLog('warn', 'Request stopped.')
        } else {
          pushLog('error', describeProblem(e, 'requesting').title)
          get().showProblem(e, 'requesting')
        }
      } finally {
        if (abortController === controller) abortController = null
        set({ followUpBusy: false, wait: null })
      }
    },

    retryGeneration: async () => {
      // A new run starts from an empty deck, so the cards the error banner
      // promised to keep would go with it.
      const ok = await confirmUnsentDiscard(
        get().cards,
        'Starting over discards them.',
        'Start over?',
      )
      if (ok) await get().startGeneration()
    },

    backToHome: async () => {
      const ok = await confirmUnsentDiscard(
        get().cards,
        'Leaving discards them.',
        'Discard this deck?',
      )
      if (ok) set({ view: 'home', phase: 'idle' })
    },

    updateCardFields: (uid, fields) => {
      const pdfInfo = get().pdfInfo
      set((s) => ({
        cards: s.cards.map((c) => {
          if (c.uid !== uid) return c
          // Editing a card inherited from Anki opts it into the next send as
          // an update against its existing note — without it ceasing to be a
          // card that lives in Anki.
          const edited: Card = { ...c, fields, edited: true }
          // The same gate the model's edits pass. Without this the badge kept
          // describing the card as it was generated: a fixed card stayed
          // flagged, and a newly broken one (an emptied field, a deleted
          // cloze marker) went out looking clean.
          const verdict = evaluateCard(edited, {
            pageCount: pdfInfo?.pageCount,
            pageTexts: pdfInfo?.pageTexts,
            provenanceOptional: c.fromAnki === true,
          })
          edited.qualityScore = verdict.score
          edited.qualityIssues = verdict.issues
          return edited
        }),
        editingUid: null,
        // The send bar's breakdown describes a deck that just changed.
        ...staleSync(s),
      }))
    },

    removeCard: (uid) => {
      const { cards } = get()
      const index = cards.findIndex((c) => c.uid === uid)
      if (index === -1) return
      const card = cards[index]
      if (card.fromAnki) {
        // Removing it here would suggest it left Anki, which it did not.
        get().toast('info', 'This card is already in Anki. Remove it there.')
        return
      }
      set((s) => ({ cards: s.cards.filter((c) => c.uid !== uid), ...staleSync(s) }))
      const undo = () =>
        set((s) => {
          const restored = [...s.cards]
          restored.splice(Math.min(index, restored.length), 0, card)
          return { cards: restored, ...staleSync(s) }
        })
      get().toast('info', 'Card removed.', { action: { label: 'Undo', run: undo } })
    },

    setCardSyncExcluded: (uid, excluded) =>
      set((s) => ({
        cards: s.cards.map((c) => (c.uid === uid ? { ...c, syncExcluded: excluded } : c)),
        ...staleSync(s),
      })),

    setEditingUid: (uid) => set({ editingUid: uid }),
    setSelectedUid: (uid) => set({ selectedUid: uid }),
    setSearchQuery: (q) => set({ searchQuery: q }),
    setPageFilter: (page) => set({ pageFilter: page }),

    peekSlide: (page) => {
      set({ slidePeek: page })
      if (page === null || !currentDoc) return
      if (get().slideRenders[page] || slideRendersInFlight.has(page)) return
      slideRendersInFlight.add(page)
      renderPageThumbnail(currentDoc, page, SLIDE_PEEK_RENDER_WIDTH)
        .then((url) => set((s) => ({ slideRenders: { ...s.slideRenders, [page]: url } })))
        .catch(() => {}) // panel falls back to the filmstrip thumbnail
        .finally(() => slideRendersInFlight.delete(page))
    },

    // Runs by itself whenever the send bar's card set changes, so the bar can
    // say what the send will actually do ("12 new · 2 updates") without the
    // user having to ask. Read-only: it never installs note types or touches
    // the collection, and a failure just leaves the breakdown off the bar.
    previewSyncNow: async () => {
      const { settings, cards, deckName, conceptMap, ankiStatus } = get()
      const syncable = cards.filter(isSyncable)
      if (!settings || ankiStatus !== 'connected' || syncable.length === 0) return
      const seq = ++syncPreviewSeq
      set({ syncPreview: null })
      try {
        const client = new AnkiClient(settings.ankiUrl, tauriFetch)
        const preview = await previewSync(
          client,
          syncable,
          deckName,
          settings,
          (card) => cardTags(card, settings, deckName, conceptMap),
          noteExtras,
        )
        if (seq === syncPreviewSeq) set({ syncPreview: preview })
      } catch {
        // The send bar simply shows no breakdown; the send itself still works.
      }
    },

    syncNow: async () => {
      const { settings, cards, deckName, conceptMap } = get()
      const syncable = cards.filter(isSyncable)
      if (!settings || syncable.length === 0) return
      set({ syncState: 'syncing', syncProgress: { done: 0, total: syncable.length } })
      try {
        const client = new AnkiClient(settings.ankiUrl, tauriFetch)
        await ensureNoteTypes(client, settings)
        const result = await syncCards(
          client,
          syncable,
          deckName,
          settings,
          (card) => cardTags(card, settings, deckName, conceptMap),
          (p) => set({ syncProgress: p }),
          noteExtras,
        )
        set((s) => ({
          syncState: 'done',
          syncResult: result,
          cards: s.cards.map((c) => {
            const noteId = result.noteIds.get(c.uid)
            return noteId ? { ...c, ankiNoteId: noteId } : c
          }),
        }))
        // Cards that made it now carry note ids — write their provenance down
        // while the session still knows it (see the deck ledger).
        void recordSyncedDeck()
        // "see Activity" used to point at a log that never heard about the
        // send: every per-card outcome was thrown away with the toast.
        for (const skipped of result.duplicates) {
          pushGrouped(
            'duplicate',
            'info',
            (n) => `${count(n, 'card')} already in Anki, left as is`,
            {
              message: 'Already in Anki',
              quote: plainCardText(skipped.front).slice(0, 120),
            },
          )
        }
        for (const failure of result.failures) {
          pushGrouped('failed', 'error', (n) => `${count(n, 'card')} not sent`, {
            message: describeSyncFailure(failure.error),
            quote: plainCardText(failure.front).slice(0, 120),
          })
        }
        const sent = result.created + result.updated
        const extras = [
          result.duplicates.length > 0 ? `${result.duplicates.length} already there` : '',
          result.failures.length > 0 ? `${result.failures.length} failed` : '',
        ].filter(Boolean)
        const suffix = extras.length > 0 ? ` (${extras.join(', ')})` : ''
        pushLog('info', `Sent ${count(sent, 'card')} to “${deckName}”${suffix}.`)
        // Success needs no toast: the send bar says it where the button was.
        if (result.failures.length > 0) {
          get().toast(
            'error',
            `Sent ${count(sent, 'card')}, but ${result.failures.length} failed.`,
            {
              detail: 'The activity log says why for each one.',
            },
          )
        }
      } catch (e) {
        set({ syncState: 'idle' })
        get().showProblem(e, 'sending')
      }
    },

    openDeckInAnki: async () => {
      const { settings, deckName } = get()
      if (!settings) return
      try {
        const client = new AnkiClient(settings.ankiUrl, tauriFetch)
        await client.guiBrowse(`deck:"${deckName.replaceAll('"', '\\"')}"`)
      } catch (e) {
        get().showProblem(e, 'opening_anki')
      }
    },

    migrateLegacyCards: async () => {
      const { settings, migratingCards } = get()
      if (!settings || migratingCards) return
      set({ migratingCards: true })
      try {
        const client = new AnkiClient(settings.ankiUrl, tauriFetch)
        await ensureNoteTypes(client, settings)
        const result = await migrateNotesToLectern(client, settings.defaultTag)
        if (result.migrated === 0 && result.failures.length === 0) {
          get().toast('info', 'No cards needed the new design.')
        } else if (result.failures.length === 0) {
          get().toast('success', `Moved ${count(result.migrated, 'card')} to the Lectern design.`)
        } else {
          get().toast(
            'error',
            `Moved ${count(result.migrated, 'card')}, but ${result.failures.length} failed.`,
            { detail: describeSyncFailure(result.failures[0].error) },
          )
        }
      } catch (e) {
        get().showProblem(e, 'styling')
      } finally {
        set({ migratingCards: false })
      }
    },

    toast: (kind, message, options = {}) => {
      const id = toastSeq++
      set((s) => ({ toasts: [...s.toasts, { id, kind, message, ...options }] }))
      // An error names a fix, and five seconds is not long enough to read
      // one; it stays until dismissed.
      if (kind === 'error') return
      window.setTimeout(
        () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
        options.action ? UNDO_WINDOW_MS : 5000,
      )
    },

    showProblem: (error, activity) => {
      const problem = describeProblem(error, activity)
      const action =
        problem.fix === 'settings'
          ? { label: 'Open Settings', run: () => get().openSettings(true) }
          : problem.fix === 'check_anki'
            ? { label: 'Check again', run: () => void get().refreshAnki() }
            : undefined
      get().toast('error', problem.title, { detail: problem.body, action, link: problem.link })
    },

    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }
})

// Dev-only escape hatch for browser-mode debugging and UI automation.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__lectern = useLectern
}

// Tag construction shared by preview + sync.
import { buildCardTags } from '../engine/tags'

function cardTags(
  card: Card,
  settings: Settings,
  deckName: string,
  conceptMap: ConceptMap | null,
): string[] {
  return buildCardTags({
    template: settings.tagTemplate,
    deck: deckName,
    slideSet: conceptMap?.slideSetName ?? '',
    topic: card.slideTopic,
    defaultTag: settings.defaultTag,
    enableDefaultTag: settings.enableDefaultTag,
  })
}
