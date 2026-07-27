// Renders CHANGELOG.md into website/changelog.html between the
// CHANGELOG:START / CHANGELOG:END markers. Run from the repo root:
//
//   node scripts/build-changelog.mjs
//
// The Pages workflow runs this before uploading the website, so the
// deployed page always reflects the changelog on main. The committed
// changelog.html keeps the last generated output for local preview.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const changelogPath = join(root, 'CHANGELOG.md')
const pagePath = join(root, 'website', 'changelog.html')

const REPO = 'https://github.com/stegra05/Lectern'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// Inline markdown: the changelog only uses **bold**, _italics_, `code`
// and [text](url).
function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Word-boundary underscores only, so snake_case identifiers survive.
    .replace(/(^|[\s(])_([^_]+)_(?=$|[\s.,;:!?)])/g, '$1<em>$2</em>')
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>',
    )
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

function parseChangelog(markdown) {
  const releases = []
  let release = null
  let section = null // { category, items } or { paragraph: [lines] }

  const flushSection = () => {
    if (!section) return
    if (section.paragraph) {
      release.blocks.push({ type: 'p', text: section.paragraph.join(' ') })
    }
    section = null
  }

  for (const line of markdown.split('\n')) {
    const heading = line.match(/^## (\d+\.\d+\.\d+)(?: \((\d{4}-\d{2}-\d{2})\))?/)
    if (heading) {
      flushSection()
      release = { version: heading[1], date: heading[2] ?? null, blocks: [] }
      releases.push(release)
      continue
    }
    if (!release) continue // preamble ("# Changelog")

    const category = line.match(/^### (.+)/)
    if (category) {
      flushSection()
      release.blocks.push({ type: 'h3', text: category[1].trim() })
      continue
    }

    const bullet = line.match(/^- (.*)/)
    if (bullet) {
      flushSection()
      let list = release.blocks.at(-1)
      if (!list || list.type !== 'ul' || list.closed) {
        list = { type: 'ul', items: [] }
        release.blocks.push(list)
      }
      list.items.push([bullet[1]])
      continue
    }

    const lastBlock = release.blocks.at(-1)
    const continuation = line.match(/^ {2,}(\S.*)/)
    if (continuation && !section && lastBlock?.type === 'ul' && !lastBlock.closed) {
      lastBlock.items.at(-1).push(continuation[1])
      continue
    }

    if (line.trim() === '') {
      flushSection()
      if (lastBlock?.type === 'ul') lastBlock.closed = true
      continue
    }

    // Plain paragraph line (release-level prose).
    if (lastBlock?.type === 'ul') lastBlock.closed = true
    if (!section) section = { paragraph: [] }
    section.paragraph.push(line.trim())
  }
  flushSection()

  return releases
}

function renderRelease({ version, date, blocks }) {
  const out = []
  out.push(`        <article class="release" id="v${version}">`)
  out.push('          <div class="release-head">')
  out.push(
    `            <h2><a href="${REPO}/releases/tag/v${version}">${version}</a></h2>`,
  )
  if (date) {
    out.push(`            <time datetime="${date}">${formatDate(date)}</time>`)
  }
  out.push('          </div>')

  for (const block of blocks) {
    if (block.type === 'h3') {
      const slug = block.text.toLowerCase().replace(/[^a-z]+/g, '-')
      out.push(`          <h3 class="release-cat" data-cat="${slug}">${inline(block.text)}</h3>`)
    } else if (block.type === 'p') {
      out.push(`          <p class="release-note">${inline(block.text)}</p>`)
    } else if (block.type === 'ul') {
      out.push('          <ul>')
      for (const item of block.items) {
        out.push(`            <li>${inline(item.join(' '))}</li>`)
      }
      out.push('          </ul>')
    }
  }

  out.push('        </article>')
  return out.join('\n')
}

const releases = parseChangelog(readFileSync(changelogPath, 'utf8'))
if (releases.length === 0) {
  console.error('No releases found in CHANGELOG.md — refusing to write an empty page.')
  process.exit(1)
}

const html = releases.map(renderRelease).join('\n\n')

const page = readFileSync(pagePath, 'utf8')
const START = '<!-- CHANGELOG:START -->'
const END = '<!-- CHANGELOG:END -->'
const startIdx = page.indexOf(START)
const endIdx = page.indexOf(END)
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  console.error('Markers not found in website/changelog.html')
  process.exit(1)
}

const updated =
  page.slice(0, startIdx + START.length) + '\n' + html + '\n        ' + page.slice(endIdx)
writeFileSync(pagePath, updated)
console.log(`Rendered ${releases.length} releases into website/changelog.html`)
