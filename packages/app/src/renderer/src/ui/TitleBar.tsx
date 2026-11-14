import type { ReactNode } from 'react'
import './titlebar.css'

/**
 * The 38px bar at the top of every window. The system draws the window controls on macOS, so
 * the bar only keeps their space free. Everything in it can drag the window except controls.
 */
export function TitleBar({
  left,
  centre,
  right,
}: {
  left?: ReactNode
  centre?: ReactNode
  right?: ReactNode
}) {
  return (
    <header className="titlebar" data-platform={window.lectern.platform}>
      <div className="titlebar-left">{left}</div>
      {centre && <div className="titlebar-centre">{centre}</div>}
      <div className="titlebar-right">{right}</div>
    </header>
  )
}
