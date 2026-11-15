import type { Card } from '../../../shared/contract.ts'
import type { CardDesign } from './designs.ts'
import { renderCard, type Side } from './render.ts'

/** The width the designs are drawn for: a phone, where most reviews happen. */
const LAYOUT_WIDTH = 360

// What Anki's reviewer puts under every card (ts/reviewer/reviewer.scss), as in the gallery, so
// a design meets the same defaults here as in Anki.
const REVIEWER_CSS = `
hr { background-color: #c0c0c0; margin: 1em 0; border: none; height: 1px; }
body { margin: 20px; overflow-wrap: break-word; }
body.nightMode { background-color: var(--canvas); color: var(--fg); }
:root { --canvas: #2c2c2c; --fg: #fcfcfc; }
img { max-width: 100%; max-height: 95vh; }
li { text-align: start; }
pre { text-align: left; }
#typeans { width: 100%; box-sizing: border-box; line-height: 1.75; }
code#typeans { white-space: pre-wrap; font-variant-ligatures: none; }
.typeGood { background: #afa; color: black; }
.typeBad { color: black; background: #faa; }
.typeMissed { color: black; background: #ccc; }
`

function documentOf(card: Card, side: Side, design: CardDesign, night: boolean): string {
  return (
    '<!doctype html><html class="mobile"><head><meta charset="utf-8">' +
    `<style>${REVIEWER_CSS}</style><style>${design.css}</style></head>` +
    `<body class="card card1${night ? ' nightMode night_mode' : ''}">` +
    `<div id="qa">${renderCard(card, side)}</div></body></html>`
  )
}

/**
 * One side of a card in one design, as Anki would show it on a phone, scaled to `width`. The
 * card lives in its own document so the design's stylesheet cannot reach the app. The frame
 * runs no scripts; same origin only lets it load the design's fonts from the app.
 */
export function CardFrame({
  card,
  side,
  design,
  night,
  width,
  height,
}: {
  card: Card
  side: Side
  design: CardDesign
  night: boolean
  width: number
  height: number
}) {
  const scale = width / LAYOUT_WIDTH
  return (
    <div
      style={{
        width,
        height,
        flex: 'none',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 0 0 0.5px var(--hairline), 0 1px 2px rgba(0, 0, 0, 0.05)',
      }}
    >
      <iframe
        title={`${side === 'front' ? 'Front' : 'Back'} of the card in ${design.name}`}
        sandbox="allow-same-origin"
        srcDoc={documentOf(card, side, design, night)}
        tabIndex={-1}
        style={{
          display: 'block',
          width: LAYOUT_WIDTH,
          height: height / scale,
          border: 0,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
