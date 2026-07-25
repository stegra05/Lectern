/**
 * The single UI store. Pipeline events land here as direct state updates —
 * there is no transport, no event translation, no split-brain.
 */

import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { create } from 'zustand'
import { AnkiClient, checkConnection, isSyncable, previewSync, syncCards } from '../engine/anki'
import { countDeckNotes, fetchDeckCards, MAX_IMPORT_CARDS } from '../engine/ankiImport'
import { provenanceFieldValues } from '../engine/noteTypes'
import { ensureLecternModels, migrateNotesToLectern } from '../engine/noteTypeSync'
import { loadNoteTypeFonts } from '../lib/noteTypeFonts'
import { estimateCost, type CostEstimate } from '../engine/cost'
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
import { confirmDiscard } from '../lib/confirm'
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
  at: number
}

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
  undo?: () => void
}

export type AppPhase =
  'idle' | 'uploading' | 'mapping' | 'generating' | 'reflecting' | 'complete' | 'error'

interface LecternState {
  // boot + connections
  settings: Settings | null
  hasApiKey: boolean
  ankiStatus: 'unknown' | 'checking' | 'connected' | 'offline'
  ankiDecks: string[]
  settingsOpen: boolean

  // source document
  fileName: string | null
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
  rejectedCount: number
  progress: { produced: number; cap: number; round: number } | null
  usage: { inputTokens: number; outputTokens: number; costUsd: number } | null
  doneSummary: string | null
  errorMessage: string | null
  /** Conversation handle for post-completion card requests; null until the
   *  pipeline completes. */
  followUp: FollowUpSeed | null
  followUpBusy: boolean

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
  syncState: 'idle' | 'previewing' | 'syncing' | 'done'
  syncPreview: SyncPreview | null
  syncProgress: SyncProgress | null
  syncResult: SyncResult | null
  migratingCards: boolean

  toasts: Toast[]
}

interface LecternActions {
  init: () => Promise<void>
  refreshAnki: () => Promise<void>
  openSettings: (open: boolean) => void
  applySettings: (settings: Settings) => Promise<void>
  setHasApiKey: (has: boolean) => void

  pickPdf: () => Promise<void>
  loadPdfFromPath: (path: string) => Promise<void>
  loadPdfFromBytes: (fileName: string, bytes: Uint8Array) => Promise<void>
  clearPdf: () => void
  setDeckName: (name: string) => void
  setExtendDeck: (extend: boolean) => void
  /** Count the notes in the named deck, so the home view can offer to keep
   *  them. Debounced by setDeckName; safe to call directly. */
  probeExistingDeck: () => Promise<void>
  setFocusPrompt: (focus: string) => void
  setTargetCards: (target: number | null) => void

  startGeneration: () => Promise<void>
  cancelGeneration: () => void
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
  syncNow: () => Promise<void>
  /** One-time action: move earlier plain Basic/Cloze syncs (found via the
   *  default tag) onto the Lectern note types. */
  migrateLegacyCards: () => Promise<void>

  toast: (kind: Toast['kind'], message: string, undo?: () => void) => void
  dismissToast: (id: number) => void
}

let abortController: AbortController | null = null
let toastSeq = 1
/** Debounce + last-writer-wins guards for the deck probe, which fires on
 *  every keystroke in the deck field. */
let deckProbeTimer: number | null = null
let deckProbeSeq = 0
const DECK_PROBE_DEBOUNCE_MS = 400

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

  const handlePipelineEvent = (event: PipelineEvent): void => {
    switch (event.type) {
      case 'phase':
        set({ phase: event.phase })
        break
      case 'log':
        pushLog(event.level, event.message)
        break
      case 'concept_map':
        set({ conceptMap: event.conceptMap, sizing: event.sizing })
        break
      case 'card_accepted':
        set((s) => ({ cards: [...s.cards, event.card] }))
        break
      case 'card_rejected':
        set((s) => ({ rejectedCount: s.rejectedCount + 1 }))
        pushLog(
          'warn',
          `Rejected: ${event.reasons.map((r) => r.replaceAll('_', ' ')).join(', ')}`,
          plainCardText(event.front),
        )
        break
      case 'cards_replaced':
        set({ cards: event.cards })
        if (event.reflectionNote) pushLog('info', 'Quality pass', event.reflectionNote)
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
        set({ doneSummary: event.summary })
        pushLog('info', event.summary)
        break
      case 'error':
        pushLog('error', event.message)
        if (event.fatal) set({ phase: 'error', errorMessage: event.message })
        break
    }
  }

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
    set({ estimate: estimateCost(pdfInfo, sizing, settings.model), sizing })
  }

  /** Best-effort install/upgrade of the bundled note types. Failure is not
   *  fatal: model resolution falls back to plain Basic/Cloze when the
   *  Lectern types are absent. */
  const ensureNoteTypes = async (client: AnkiClient, settings: Settings): Promise<void> => {
    if (!settings.useLecternNoteTypes) return
    try {
      const result = await ensureLecternModels(client, settings.noteTypeTheme, loadNoteTypeFonts)
      if (result.created.length > 0) {
        pushLog('info', `Added the ${result.created.join(' and ')} note type(s) to Anki.`)
      }
      if (result.userOwned.length > 0) {
        pushLog(
          'info',
          `${result.userOwned.join(' and ')}: styling was edited in Anki, so Lectern leaves it as is.`,
        )
      }
    } catch (e) {
      pushLog('warn', `Could not set up the Lectern note types: ${(e as Error).message}`)
    }
  }

  /** Topic/Source/Excerpt values for the Lectern note types. */
  const noteExtras = (card: Card): Record<string, string> =>
    provenanceFieldValues(card, get().conceptMap?.slideSetName ?? '')

  return {
    settings: null,
    hasApiKey: false,
    ankiStatus: 'unknown',
    ankiDecks: [],
    settingsOpen: false,

    fileName: null,
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
    rejectedCount: 0,
    progress: null,
    usage: null,
    doneSummary: null,
    errorMessage: null,
    followUp: null,
    followUpBusy: false,

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
      set({ settings, hasApiKey: Boolean(key) })
      void get().refreshAnki()
    },

    refreshAnki: async () => {
      const { settings, ankiStatus } = get()
      if (!settings) return
      // Focus-triggered re-probes shouldn't flicker an already-green dot.
      if (ankiStatus !== 'connected') set({ ankiStatus: 'checking' })
      const client = new AnkiClient(settings.ankiUrl, tauriFetch)
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
        void ensureNoteTypes(new AnkiClient(settings.ankiUrl, tauriFetch), settings)
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
      } catch (e) {
        get().toast('error', `Could not read ${fileName}: ${(e as Error).message}`)
      }
    },

    loadPdfFromBytes: async (fileName, bytes) => {
      try {
        const doc = await openPdf(bytes)
        const pdfInfo = await extractPdfInfo(doc)
        void currentDoc?.loadingTask.destroy().catch(() => {})
        currentDoc = doc
        slideRendersInFlight.clear()
        const suggestedDeck = get().deckName || fileName.replace(/\.pdf$/i, '')
        set({
          fileName,
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
        get().toast('error', `Could not read ${fileName}: ${(e as Error).message}`)
      }
    },

    clearPdf: () => {
      void currentDoc?.loadingTask.destroy().catch(() => {})
      currentDoc = null
      slideRendersInFlight.clear()
      set({
        fileName: null,
        pdfBytes: null,
        pdfInfo: null,
        pageThumbs: {},
        estimate: null,
        slidePeek: null,
        slideRenders: {},
      })
    },

    setDeckName: (name) => {
      // The old count belongs to the old name — drop it rather than show a
      // stale "87 cards already here" against a deck nobody has looked up.
      set({ deckName: name, existingDeckCount: null })
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
      set({
        view: 'session',
        phase: 'uploading',
        cards: [],
        coverage: null,
        conceptMap: null,
        logs: [],
        rejectedCount: 0,
        progress: null,
        usage: null,
        doneSummary: null,
        errorMessage: null,
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
            `Keeping ${imported.cards.length} card(s) already in “${deckName}” — this run adds to them.`,
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
            pushLog('warn', `${unreadable} note(s) in the deck could not be read and are ignored.`)
          }
        } catch (e) {
          const message = (e as Error).message
          set({
            phase: 'error',
            errorMessage:
              `Could not read “${deckName}” from Anki: ${message}. ` +
              'Nothing was generated — running without the existing cards would duplicate them.',
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
        void notifyRunFinished({
          enabled: settings.notifyOnFinish,
          title: `${deckName} is ready`,
          body: get().doneSummary ?? `${get().cards.length} cards are waiting for review.`,
        })
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          set({ view: 'home', phase: 'idle' })
          get().toast('info', 'Generation cancelled.')
        } else {
          const message =
            (e as { userMessage?: string }).userMessage ?? (e as Error).message ?? 'Unknown error'
          set({ phase: 'error', errorMessage: message })
          pushLog('error', message)
          // Worth interrupting for: a failed run is exactly what you walked
          // away from the window expecting not to happen.
          void notifyRunFinished({
            enabled: settings.notifyOnFinish,
            title: 'Lectern stopped generating',
            body: message,
          })
        }
      } finally {
        if (abortController === controller) abortController = null
      }
    },

    cancelGeneration: () => abortController?.abort(),

    requestMoreCards: async (text) => {
      const { settings, conceptMap, followUp, followUpBusy, cards, focusPrompt } = get()
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
          model: settings.model,
          apiKey,
          fetchFn: tauriFetch,
          emit: handlePipelineEvent,
          signal: controller.signal,
        })
        set((s) => ({
          followUp: outcome.seed,
          usage: {
            inputTokens: (s.usage?.inputTokens ?? 0) + outcome.usage.inputTokens,
            outputTokens: (s.usage?.outputTokens ?? 0) + outcome.usage.outputTokens,
            costUsd: (s.usage?.costUsd ?? 0) + outcome.usage.costUsd,
          },
        }))
        const added = outcome.added.length
        const outside = outcome.outsideSourceCount
        const optIn = `kept out of the Anki send until you include ${outside === 1 ? 'it' : 'them'}`
        const outsideNote =
          outside === 0
            ? ''
            : outside === added
              ? outside === 1
                ? ` It is outside the source — ${optIn}.`
                : ` All are outside the source — ${optIn}.`
              : ` ${outside} of them ${outside === 1 ? 'is' : 'are'} outside the source — ${optIn}.`
        pushLog(
          'info',
          added === 0
            ? 'No cards were added for this request.'
            : `Added ${added === 1 ? '1 card' : `${added} cards`}.${outsideNote}`,
          outcome.note,
        )
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          pushLog('warn', 'Request stopped.')
        } else {
          const message =
            (e as { userMessage?: string }).userMessage ?? (e as Error).message ?? 'Unknown error'
          pushLog('error', message)
          get().toast('error', `Request failed: ${message}`)
        }
      } finally {
        if (abortController === controller) abortController = null
        set({ followUpBusy: false })
      }
    },

    backToHome: async () => {
      const unsent = get().cards.filter((c) => !c.ankiNoteId).length
      if (unsent > 0) {
        const counted = unsent === 1 ? "1 card hasn't" : `${unsent} cards haven't`
        const ok = await confirmDiscard(
          `${counted} been sent to Anki. Leaving discards them.`,
          'Discard this deck?',
        )
        if (!ok) return
      }
      set({ view: 'home', phase: 'idle' })
    },

    updateCardFields: (uid, fields) =>
      set((s) => ({
        cards: s.cards.map((c) =>
          // Editing a card inherited from Anki is how you opt it into the
          // next send: it stops being untouched ballast and becomes an
          // update against its existing note.
          c.uid === uid ? { ...c, fields, fromAnki: undefined } : c,
        ),
        editingUid: null,
      })),

    removeCard: (uid) => {
      const { cards } = get()
      const index = cards.findIndex((c) => c.uid === uid)
      if (index === -1) return
      const card = cards[index]
      if (card.fromAnki) {
        // Removing it here would suggest it left Anki, which it did not.
        get().toast('info', 'This card is already in Anki — remove it there.')
        return
      }
      set({ cards: cards.filter((c) => c.uid !== uid) })
      const undo = () =>
        set((s) => {
          const restored = [...s.cards]
          restored.splice(Math.min(index, restored.length), 0, card)
          return { cards: restored }
        })
      get().toast('info', 'Card removed.', undo)
    },

    setCardSyncExcluded: (uid, excluded) =>
      set((s) => ({
        cards: s.cards.map((c) => (c.uid === uid ? { ...c, syncExcluded: excluded } : c)),
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

    previewSyncNow: async () => {
      const { settings, cards, deckName, conceptMap } = get()
      const syncable = cards.filter(isSyncable)
      if (!settings || syncable.length === 0) return
      set({ syncState: 'previewing' })
      try {
        const client = new AnkiClient(settings.ankiUrl, tauriFetch)
        await ensureNoteTypes(client, settings)
        const preview = await previewSync(
          client,
          syncable,
          deckName,
          settings,
          (card) => cardTags(card, settings, deckName, conceptMap),
          noteExtras,
        )
        set({ syncPreview: preview, syncState: 'idle' })
      } catch (e) {
        set({ syncState: 'idle' })
        get().toast('error', `Anki preview failed: ${(e as Error).message}`)
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
        if (result.failures.length === 0) {
          get().toast('success', `Sent ${result.created + result.updated} cards to Anki.`)
        } else {
          get().toast(
            'error',
            `Sent ${result.created + result.updated} cards; ${result.failures.length} failed.`,
          )
        }
      } catch (e) {
        set({ syncState: 'idle' })
        get().toast('error', `Anki sync failed: ${(e as Error).message}`)
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
          get().toast('success', `Moved ${result.migrated} cards to the Lectern design.`)
        } else {
          get().toast(
            'error',
            `Moved ${result.migrated} cards; ${result.failures.length} failed (${result.failures[0].error}).`,
          )
        }
      } catch (e) {
        get().toast('error', `Could not restyle existing cards: ${(e as Error).message}`)
      } finally {
        set({ migratingCards: false })
      }
    },

    toast: (kind, message, undo) => {
      const id = toastSeq++
      set((s) => ({ toasts: [...s.toasts, { id, kind, message, undo }] }))
      window.setTimeout(
        () => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
        undo ? UNDO_WINDOW_MS : 5000,
      )
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
