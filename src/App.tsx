import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useEffect, useState } from 'react'
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
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-desk/80 backdrop-blur-sm">
          <div className="rounded-lg border-2 border-dashed border-lamp px-10 py-8">
            <p className="text-[15px] font-medium text-lamp">Drop to read this lecture</p>
          </div>
        </div>
      )}

      <SettingsSheet />
      <Toasts />
    </div>
  )
}
