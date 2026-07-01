/**
 * Card content rendering: sanitize model HTML, render LaTeX (\( \) / \[ \])
 * with KaTeX, and mark cloze deletions.
 */

import DOMPurify from 'dompurify'
import katex from 'katex'

const ALLOWED_TAGS = [
  'b', 'strong', 'i', 'em', 'u', 'sub', 'sup', 'br', 'p', 'ul', 'ol', 'li', 'span', 'div', 'code',
]

function renderMath(html: string): string {
  const renderTex = (tex: string, displayMode: boolean): string => {
    try {
      return katex.renderToString(tex, { displayMode, throwOnError: false })
    } catch {
      return tex
    }
  }
  return html
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => renderTex(tex, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => renderTex(tex, false))
}

/** Replace Anki cloze markers with highlight spans (answer shown). */
function renderClozeShown(text: string): string {
  return text.replace(/\{\{c\d+::([\s\S]*?)(?:::[^}]*)?\}\}/g, '<span class="cloze-hl">$1</span>')
}

/** Replace cloze markers with the hint or an ellipsis (answer hidden). */
function renderClozeHidden(text: string): string {
  return text.replace(/\{\{c\d+::[\s\S]*?(?:::([^}]*))?\}\}/g, (_m, hint: string | undefined) => {
    return `<span class="cloze-hl">[${hint?.trim() || '…'}]</span>`
  })
}

export function renderCardHtml(
  raw: string,
  opts: { cloze?: 'shown' | 'hidden' } = {},
): string {
  let html = raw
  if (opts.cloze === 'shown') html = renderClozeShown(html)
  else if (opts.cloze === 'hidden') html = renderClozeHidden(html)
  html = renderMath(html)
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS, 'math', 'annotation', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt', 'mtext', 'mspace', 'mover', 'munder', 'mtable', 'mtr', 'mtd', 'mstyle', 'mpadded', 'mphantom', 'svg', 'path', 'line'],
    ALLOWED_ATTR: ['class', 'style', 'aria-hidden', 'xmlns', 'width', 'height', 'viewBox', 'd', 'x1', 'x2', 'y1', 'y2', 'stroke-width', 'preserveAspectRatio'],
  })
}
