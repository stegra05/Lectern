/**
 * Renders one card through Lectern's real Anki templates, so the preview shows the markup Anki
 * itself produces. Only the part of Anki's template language those four files use is here:
 * `{{Field}}`, `{{#Field}}`, `{{^Field}}`, `{{cloze:Text}}` and `{{type:...}}`. The markup of
 * cloze deletions and of the typing box follows what design/cards/build.py got from Anki's
 * own engine and reviewer, so the stylesheets meet the same elements as in Anki.
 */

import type { Card } from '../../../shared/contract.ts'
import back from '../../../../../../design/cards/anki/back.html?raw'
import clozeBack from '../../../../../../design/cards/anki/cloze-back.html?raw'
import clozeFront from '../../../../../../design/cards/anki/cloze-front.html?raw'
import front from '../../../../../../design/cards/anki/front.html?raw'

export type Side = 'front' | 'back'

type Node =
  | { kind: 'text'; text: string }
  | { kind: 'field'; name: string }
  | { kind: 'section'; name: string; inverted: boolean; children: Node[] }

const TAG = /\{\{([\s\S]*?)\}\}/g

function parse(template: string): Node[] {
  const root: Node[] = []
  const stack: { name: string; children: Node[] }[] = [{ name: '', children: root }]
  let last = 0
  for (const match of template.matchAll(TAG)) {
    const top = stack[stack.length - 1]!
    if (match.index > last)
      top.children.push({ kind: 'text', text: template.slice(last, match.index) })
    last = match.index + match[0].length
    const tag = match[1]!.trim()
    if (tag.startsWith('#') || tag.startsWith('^')) {
      const section: Node = {
        kind: 'section',
        name: tag.slice(1).trim(),
        inverted: tag[0] === '^',
        children: [],
      }
      top.children.push(section)
      stack.push({ name: section.name, children: section.children })
    } else if (tag.startsWith('/')) {
      const name = tag.slice(1).trim()
      if (stack.length === 1 || top.name !== name)
        throw new Error(`Template closes {{/${name}}} without opening it`)
      stack.pop()
    } else {
      top.children.push({ kind: 'field', name: tag })
    }
  }
  if (stack.length > 1)
    throw new Error(`Template leaves {{#${stack[stack.length - 1]!.name}}} open`)
  if (last < template.length) root.push({ kind: 'text', text: template.slice(last) })
  return root
}

/** Anki counts a field as empty when it holds only whitespace, `<br>` and `<div>` tags. */
export function fieldIsEmpty(value: string | undefined): boolean {
  return !value || /^(?:\s|<\/?(?:br|div) ?\/?>)*$/i.test(value)
}

const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g

/** Anki's attribute encoding: letters and digits stay, everything else becomes an entity. */
function encodeAttribute(text: string): string {
  return text.replace(/[^A-Za-z0-9\u0080-￿]/g, (c) => {
    const named: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
    return named[c] ?? `&#x${c.charCodeAt(0).toString(16).toUpperCase()};`
  })
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

/** `{{cloze:Text}}` for the card of deletion `ord`. */
export function cloze(text: string, ord: number, side: Side): string {
  return text.replace(CLOZE, (_, n: string, body: string, hint?: string) => {
    if (Number(n) !== ord) return `<span class="cloze-inactive" data-ordinal="${n}">${body}</span>`
    if (side === 'back') return `<span class="cloze" data-ordinal="${n}">${body}</span>`
    return `<span class="cloze" data-cloze="${encodeAttribute(body)}" data-ordinal="${n}">[${hint ?? '...'}]</span>`
  })
}

/** What Anki compares a typed cloze answer against: every deletion of the card, joined by commas. */
export function clozeForTyping(text: string, ord: number): string {
  return [...text.matchAll(CLOZE)]
    .filter((m) => Number(m[1]) === ord)
    .map((m) => stripHtml(m[2]!))
    .join(', ')
}

function renderNodes(
  nodes: Node[],
  fields: Record<string, string>,
  ord: number,
  side: Side,
): string {
  let out = ''
  for (const node of nodes) {
    if (node.kind === 'text') out += node.text
    else if (node.kind === 'section') {
      if (fieldIsEmpty(fields[node.name]) === node.inverted)
        out += renderNodes(node.children, fields, ord, side)
    } else if (node.name.startsWith('type:')) {
      // Anki leaves the typing box to the reviewer, which finds it by this marker.
      out += `[[${node.name}]]`
    } else if (node.name.startsWith('cloze:')) {
      out += cloze(fields[node.name.slice('cloze:'.length)] ?? '', ord, side)
    } else {
      out += fields[node.name] ?? ''
    }
  }
  return out
}

/** Renders a template the way Anki's card.question() and card.answer() do, before the reviewer. */
export function renderTemplate(
  template: string,
  fields: Record<string, string>,
  ord: number,
  side: Side,
): string {
  return renderNodes(parse(template), fields, ord, side)
}

const TYPE_MARK = /\[\[type:(.+?)\]\]/g
// The field font and size Anki stores by default; the reviewer writes them inline.
const TYPE_STYLE = "font-family: 'Arial'; font-size: 20px"

/**
 * The reviewer's step for `{{type:...}}`: a text box on the front; on the back the comparison
 * with what was typed. A preview has nothing typed, and Anki then shows the expected text alone.
 * The box's key handler is left out because the preview runs no scripts.
 */
export function typeAnswer(html: string, side: Side, expected: (field: string) => string): string {
  return html.replace(TYPE_MARK, (_, spec: string) => {
    if (side === 'front')
      return `\n<center>\n<input type=text id=typeans\n   style="${TYPE_STYLE};">\n</center>\n`
    return `\n<div style="${TYPE_STYLE}"><code id=typeans>${escapeHtml(expected(spec))}</code></div>`
  })
}

const TEMPLATES = {
  qa: { front, back },
  cloze: { front: clozeFront, back: clozeBack },
}

/** One side of a card as the HTML inside Anki's `<div id="qa">`. Cloze cards show deletion 1. */
export function renderCard(card: Card, side: Side): string {
  const ord = 1
  const html = renderTemplate(TEMPLATES[card.note][side], card.fields, ord, side).trim()
  return typeAnswer(html, side, (spec) => {
    const field = spec.split(':').pop()!
    const value = card.fields[field] ?? ''
    return spec.startsWith('cloze:') ? clozeForTyping(value, ord) : stripHtml(value)
  })
}
