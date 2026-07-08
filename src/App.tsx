import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'
import { confirmDiscard } from './lib/confirm'
import { IS_TAURI } from './lib/platform'
import { HomeView } from './components/HomeView'
import { SessionView } from './components/SessionView'
import { SettingsSheet } from './components/SettingsSheet'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { useLectern } from './state/store'

export default function App() {
  const view = useLectern((s) => s.view)
  const init = useLectern((s) => s.init)
  const loadPdfFromPath = useLectern((s) => s.loadPdfFromPath)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  // Coming back to the window is the natural moment Anki may have been opened
  // (or closed) — re-probe so the status dot never goes stale.
  useEffect(() => {
    const onFocus = () => void useLectern.getState().refreshAnki()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // ⌘, — the macOS settings convention.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        useLectern.getState().openSettings(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Closing the window mid-session would silently drop an unsent deck.
  useEffect(() => {
    if (!IS_TAURI) return
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      const { view: currentView, cards } = useLectern.getState()
      const unsent = cards.filter((c) => !c.ankiNoteId).length
      if (currentView !== 'session' || unsent === 0) return
      const counted = unsent === 1 ? "1 card hasn't" : `${unsent} cards haven't`
      const ok = await confirmDiscard(
        `${counted} been sent to Anki. Quitting discards them.`,
        'Quit Lectern?',
      )
      if (!ok) event.preventDefault()
    })
    return () => {
      void unlisten.then((fn) => fn())
    }
  }, [])

  // Native drag & drop of PDFs onto the window.
  useEffect(() => {
    if (!IS_TAURI) return
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const { view: currentView } = useLectern.getState()
      if (event.payload.type === 'over') {
        if (currentView === 'home') setDragging(true)
      } else if (event.payload.type === 'drop') {
        setDragging(false)
        const pdf = event.payload.paths.find((p) => p.toLowerCase().endsWith('.pdf'))
        if (pdf && currentView === 'home') void loadPdfFromPath(pdf)
      } else {
        setDragging(false)
      }
    })
    return () => {
      void unlisten.then((fn) => fn())
    }
  }, [loadPdfFromPath])

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <TitleBar />
      {view === 'home' ? <HomeView /> : <SessionView />}

      {dragging && (
        <div className="bg-desk/80 fade-in pointer-events-none absolute inset-0 z-30 flex items-center justify-center backdrop-blur-sm">
          <div className="border-lamp rounded-lg border-2 border-dashed px-10 py-8">
            <p className="text-lamp text-md font-medium">Drop to read this lecture</p>
          </div>
        </div>
      )}

      <SettingsSheet />
      <Toasts />
    </div>
  )
}
