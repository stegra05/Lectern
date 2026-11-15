import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './tokens.css'
import './ui/controls.css'

async function boot() {
  // In a plain browser there is no shell. The dev fixture stands in, for design work only.
  if (!window.lectern && import.meta.env.DEV) {
    const { installFixture } = await import('./dev/fixture.ts')
    installFixture()
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()
