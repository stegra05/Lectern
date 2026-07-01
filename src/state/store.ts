/**
 * The single UI store. Pipeline events land here as direct state updates —
 * there is no transport, no event translation, no split-brain.
 */

import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { create } from 'zustand'
import { AnkiClient, checkConnection, previewSync, syncCards } from '../engine/anki'
import { estimateCost, type CostEstimate } from '../engine/cost'
import { extractPdfInfo, openPdf, renderPageThumbnail } from '../engine/pdf'
import { runPipeline } from '../engine/pipeline'
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
import { IS_TAURI } from '../lib/platform'
import { getApiKey, loadSettings, saveSettings } from '../lib/settings'
import { tauriFetch } from '../lib/tauriFetch'

const THUMBNAIL_PAGE_LIMIT = 150
const UNDO_WINDOW_MS = 30_000

export interface LogLine {
  level: 'info' | 'warn' | 'error'
  message: string
  at: number
}

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
  undo?: () => void
}

export type AppPhase =
  | 'idle'
  | 'uploading'
  | 'mapping'
  | 'generating'
  | 'reflecting'
  | 'complete'
  | 'error'

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

  // review
  editingUid: string | null
  searchQuery: string
  pageFilter: number | null

  // sync
  syncState: 'idle' | 'previewing' | 'syncing' | 'done'
  syncPreview: SyncPreview | null
  syncProgress: SyncProgress | null
  syncResult: SyncResult | null

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
  setFocusPrompt: (focus: string) => void
  setTargetCards: (target: number | null) => void

  startGeneration: () => Promise<void>
  cancelGeneration: () => void
  backToHome: () => void

  updateCardFields: (uid: string, fields: Record<string, string>) => void
  removeCard: (uid: string) => void
  setEditingUid: (uid: string | null) => void
  setSearchQuery: (q: string) => void
  setPageFilter: (page: number | null) => void

  previewSyncNow: () => Promise<void>
  syncNow: () => Promise<void>

  toast: (kind: Toast['kind'], message: string, undo?: () => void) => void
  dismissToast: (id: number) => void
}

let abortController: AbortController | null = null
let toastSeq = 1

export const useLectern = create<LecternState & LecternActions>()((set, get) => {
  const pushLog = (level: LogLine['level'], message: string) =>
    set((s) => ({ logs: [...s.logs.slice(-400), { level, message, at: Date.now() }] }))

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
        pushLog('warn', `Rejected: "${event.front}" (${event.reasons.join(', ')})`)
        break
      case 'cards_replaced':
        set({ cards: event.cards })
        if (event.reflectionNote) pushLog('info', `Quality pass: ${event.reflectionNote}`)
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

  const refreshEstimate = () => {
    const { pdfInfo, settings, targetCards } = get()
    if (!pdfInfo || !settings) return
    const sizing = computeSizingPlan(pdfInfo, { userTargetCards: targetCards ?? undefined })
    set({ estimate: estimateCost(pdfInfo, sizing, settings.model), sizing })
  }

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

    editingUid: null,
    searchQuery: '',
    pageFilter: null,

    syncState: 'idle',
    syncPreview: null,
    syncProgress: null,
    syncResult: null,

    toasts: [],

    init: async () => {
      const settings = await loadSettings()
      const key = await getApiKey().catch(() => null)
      set({ settings, hasApiKey: Boolean(key) })
      void get().refreshAnki()
    },

    refreshAnki: async () => {
      const { settings } = get()
      if (!settings) return
      set({ ankiStatus: 'checking' })
      const client = new AnkiClient(settings.ankiUrl, tauriFetch)
      const status = await checkConnection(client)
      if (status.ok) {
        const decks = await client.deckNames().catch(() => [] as string[])
        set({ ankiStatus: 'connected', ankiDecks: decks })
      } else {
        set({ ankiStatus: 'offline', ankiDecks: [] })
      }
    },

    openSettings: (open) => set({ settingsOpen: open }),

    applySettings: async (settings) => {
      await saveSettings(settings)
      set({ settings })
      refreshEstimate()
      void get().refreshAnki()
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
        const suggestedDeck = get().deckName || fileName.replace(/\.pdf$/i, '')
        set({
          fileName,
          pdfBytes: bytes,
          pdfInfo,
          pageThumbs: {},
          deckName: suggestedDeck,
        })
        refreshEstimate()

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

    clearPdf: () =>
      set({ fileName: null, pdfBytes: null, pdfInfo: null, pageThumbs: {}, estimate: null }),

    setDeckName: (name) => set({ deckName: name }),
    setFocusPrompt: (focus) => set({ focusPrompt: focus }),
    setTargetCards: (target) => {
      set({ targetCards: target })
      refreshEstimate()
    },

    startGeneration: async () => {
      const { pdfBytes, pdfInfo, fileName, settings, deckName, focusPrompt, targetCards } = get()
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

      abortController = new AbortController()
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
        syncState: 'idle',
        syncPreview: null,
        syncResult: null,
        editingUid: null,
        searchQuery: '',
        pageFilter: null,
      })

      try {
        await runPipeline({
          pdfBytes,
          pdfInfo,
          fileName,
          focusPrompt: focusPrompt || undefined,
          userTargetCards: targetCards ?? undefined,
          model: settings.model,
          apiKey,
          fetchFn: tauriFetch,
          emit: handlePipelineEvent,
          signal: abortController.signal,
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
        }
      } finally {
        abortController = null
      }
    },

    cancelGeneration: () => abortController?.abort(),

    backToHome: () => set({ view: 'home', phase: 'idle' }),

    updateCardFields: (uid, fields) =>
      set((s) => ({
        cards: s.cards.map((c) => (c.uid === uid ? { ...c, fields } : c)),
        editingUid: null,
      })),

    removeCard: (uid) => {
      const { cards } = get()
      const index = cards.findIndex((c) => c.uid === uid)
      if (index === -1) return
      const card = cards[index]
      set({ cards: cards.filter((c) => c.uid !== uid) })
      const undo = () =>
        set((s) => {
          const restored = [...s.cards]
          restored.splice(Math.min(index, restored.length), 0, card)
          return { cards: restored }
        })
      get().toast('info', 'Card removed.', undo)
    },

    setEditingUid: (uid) => set({ editingUid: uid }),
    setSearchQuery: (q) => set({ searchQuery: q }),
    setPageFilter: (page) => set({ pageFilter: page }),

    previewSyncNow: async () => {
      const { settings, cards, deckName, conceptMap } = get()
      if (!settings || cards.length === 0) return
      set({ syncState: 'previewing' })
      try {
        const client = new AnkiClient(settings.ankiUrl, tauriFetch)
        const preview = await previewSync(client, cards, deckName, settings, (card) =>
          cardTags(card, settings, deckName, conceptMap),
        )
        set({ syncPreview: preview, syncState: 'idle' })
      } catch (e) {
        set({ syncState: 'idle' })
        get().toast('error', `Anki preview failed: ${(e as Error).message}`)
      }
    },

    syncNow: async () => {
      const { settings, cards, deckName, conceptMap } = get()
      if (!settings || cards.length === 0) return
      set({ syncState: 'syncing', syncProgress: { done: 0, total: cards.length } })
      try {
        const client = new AnkiClient(settings.ankiUrl, tauriFetch)
        const result = await syncCards(
          client,
          cards,
          deckName,
          settings,
          (card) => cardTags(card, settings, deckName, conceptMap),
          (p) => set({ syncProgress: p }),
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
