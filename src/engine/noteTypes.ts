/**
 * Bundled Anki note types — "Lectern Basic" and "Lectern Cloze".
 *
 * The design lives inside Anki, not the app: templates + CSS are installed as
 * real note types via AnkiConnect (see noteTypeSync.ts), so synced cards render
 * in the Lectern style on desktop, AnkiMobile, and AnkiDroid with the app
 * closed. Deliberate differences from theme add-ons like Prettify:
 * - No JavaScript in any template (identical rendering on every platform).
 * - Extra fields carry Lectern's provenance: Topic, Source, Excerpt.
 * - The answer keeps full ink; only the divider and cloze carry the accent.
 *
 * The CSS opens with a machine-readable marker line. The app upgrades a note
 * type only while the marker is intact — a user who edits the styling owns it
 * from then on (see parseStyleMarker).
 */

// --- Identity ---------------------------------------------------------------

export const NOTE_TYPE_VERSION = 1

export const LECTERN_BASIC_MODEL = 'Lectern Basic'
export const LECTERN_CLOZE_MODEL = 'Lectern Cloze'

export type NoteTypeTheme = 'paper' | 'nord'

export const isLecternModel = (name: string): boolean =>
  name === LECTERN_BASIC_MODEL || name === LECTERN_CLOZE_MODEL

export const NOTE_TYPE_THEMES: Array<{ id: NoteTypeTheme; label: string }> = [
  { id: 'paper', label: 'Evening lecture hall' },
  { id: 'nord', label: 'Nord' },
]

/** Provenance fields shared by both note types (after the content fields). */
export const PROVENANCE_FIELDS = ['Topic', 'Source', 'Excerpt'] as const

// --- Provenance field values ---------------------------------------------------

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** "p. 3" / "pp. 3–5, 8" — sorted, deduplicated, consecutive runs collapsed. */
export function formatPageRefs(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const runs: string[] = []
  let start = sorted[0]
  let end = sorted[0]
  for (const p of sorted.slice(1)) {
    if (p === end + 1) {
      end = p
    } else {
      runs.push(start === end ? `${start}` : `${start}–${end}`)
      start = end = p
    }
  }
  runs.push(start === end ? `${start}` : `${start}–${end}`)
  const prefix = sorted.length === 1 ? 'p.' : 'pp.'
  return `${prefix} ${runs.join(', ')}`
}

/** Values for the Topic/Source/Excerpt fields of the Lectern note types.
 *  Card content fields carry model-written HTML; these carry plain text from
 *  the pipeline, so they are escaped here. */
export function provenanceFieldValues(
  card: { slideTopic?: string; sourcePages: number[]; sourceExcerpt?: string },
  slideSetName: string,
): Record<string, string> {
  const source = [slideSetName.trim(), formatPageRefs(card.sourcePages)].filter(Boolean).join(' · ')
  return {
    Topic: escapeHtml(card.slideTopic?.trim() ?? ''),
    Source: escapeHtml(source),
    Excerpt: escapeHtml(card.sourceExcerpt?.trim() ?? ''),
  }
}

// --- Style marker -------------------------------------------------------------

const MARKER_RE = /\/\* lectern-notetype v(\d+) theme:([a-z]+) \*\//

export function styleMarker(theme: NoteTypeTheme, version = NOTE_TYPE_VERSION): string {
  return `/* lectern-notetype v${version} theme:${theme} */`
}

/** Returns the marker of app-managed styling, or null when the user owns it. */
export function parseStyleMarker(css: string): { version: number; theme: string } | null {
  const m = MARKER_RE.exec(css)
  if (!m) return null
  return { version: Number.parseInt(m[1], 10), theme: m[2] }
}

// --- Fonts --------------------------------------------------------------------

/** Media filenames referenced from the CSS. The leading underscore keeps
 *  Anki's "Check media" from deleting them as unused. */
export const FONT_FILES = {
  serif: '_LecternSourceSerif4.woff2',
  serifItalic: '_LecternSourceSerif4Italic.woff2',
  mono: '_LecternPlexMono400.woff2',
  mono500: '_LecternPlexMono500.woff2',
} as const

export interface FontAsset {
  filename: string
  /** Base64-encoded woff2 bytes, ready for AnkiConnect storeMediaFile. */
  dataBase64: string
}

// --- Templates ------------------------------------------------------------------
// Anki conditionals ({{#Field}}) hide provenance chrome on hand-made notes that
// leave those fields empty. The <hr id=answer> is Anki's show-answer scroll
// anchor and doubles as the lamp rule.

const FOOT_FRONT = `{{#Source}}
  <div class="lc-foot"><span class="lc-src">{{Source}}</span></div>
  {{/Source}}`

const FOOT_BACK = `{{#Source}}
  <div class="lc-foot">
    <span class="lc-src">{{Source}}</span>
    {{#Excerpt}}
    <details class="lc-ex">
      <summary>Source excerpt</summary>
      <blockquote>{{Excerpt}}</blockquote>
    </details>
    {{/Excerpt}}
  </div>
  {{/Source}}`

const BASIC_FRONT = `<div class="lc">
  {{#Topic}}<div class="lc-topic">{{Topic}}</div>{{/Topic}}
  <div class="lc-q">{{Front}}</div>
  ${FOOT_FRONT}
</div>`

const BASIC_BACK = `<div class="lc">
  {{#Topic}}<div class="lc-topic">{{Topic}}</div>{{/Topic}}
  <div class="lc-q">{{Front}}</div>
  <hr id="answer" class="lc-rule">
  <div class="lc-a">{{Back}}</div>
  ${FOOT_BACK}
</div>`

const CLOZE_FRONT = `<div class="lc">
  {{#Topic}}<div class="lc-topic">{{Topic}}</div>{{/Topic}}
  <div class="lc-a">{{cloze:Text}}</div>
  ${FOOT_FRONT}
</div>`

const CLOZE_BACK = `<div class="lc">
  {{#Topic}}<div class="lc-topic">{{Topic}}</div>{{/Topic}}
  <div class="lc-a">{{cloze:Text}}</div>
  {{#Back Extra}}
  <hr class="lc-rule">
  <div class="lc-a">{{Back Extra}}</div>
  {{/Back Extra}}
  ${FOOT_BACK}
</div>`

export interface LecternNoteType {
  name: string
  isCloze: boolean
  /** Field order matters: the first field is Anki's duplicate-detection key. */
  fields: string[]
  templates: Array<{ Name: string; Front: string; Back: string }>
}

export const LECTERN_NOTE_TYPES: LecternNoteType[] = [
  {
    name: LECTERN_BASIC_MODEL,
    isCloze: false,
    fields: ['Front', 'Back', ...PROVENANCE_FIELDS],
    templates: [{ Name: 'Card 1', Front: BASIC_FRONT, Back: BASIC_BACK }],
  },
  {
    name: LECTERN_CLOZE_MODEL,
    isCloze: true,
    fields: ['Text', 'Back Extra', ...PROVENANCE_FIELDS],
    templates: [{ Name: 'Cloze', Front: CLOZE_FRONT, Back: CLOZE_BACK }],
  },
]

// --- Styling ---------------------------------------------------------------------

interface ThemeTokens {
  /** window background / sheet / body text / secondary text / hairline */
  light: { ground: string; sheet: string; ink: string; soft: string; edge: string }
  night: { ground: string; sheet: string; ink: string; soft: string; edge: string }
  /** accent as text on the light sheet (must stay readable) / on the night sheet */
  accentLight: string
  accentNight: string
  /** the answer rule, which can afford a brighter tone than accent text */
  ruleLight: string
  ruleNight: string
  quoteBgLight: string
  quoteBgNight: string
}

const THEME_TOKENS: Record<NoteTypeTheme, ThemeTokens> = {
  // The app's own system: paper under the lamp, desk at night.
  paper: {
    light: {
      ground: '#f1efe9',
      sheet: '#faf9f5',
      ink: '#211e1a',
      soft: '#57534e',
      edge: '#e7e2d8',
    },
    night: {
      ground: '#1c1917',
      sheet: '#292524',
      ink: '#d6d3cc',
      soft: '#938e85',
      edge: '#3b362f',
    },
    accentLight: '#8a5a12',
    accentNight: '#e8a33d',
    ruleLight: '#b97a1e',
    ruleNight: '#e8a33d',
    quoteBgLight: '#f1efe9',
    quoteBgNight: '#211e1a',
  },
  // Nord, for collections already themed with Prettify Nord and friends.
  nord: {
    light: {
      ground: '#ececec',
      sheet: '#ffffff',
      ink: '#2e3440',
      soft: '#4c566a',
      edge: '#d8dee9',
    },
    night: {
      ground: '#242933',
      sheet: '#2e3440',
      ink: '#e5e9f0',
      soft: '#aeb6c4',
      edge: '#4c566a',
    },
    accentLight: '#4c6a92',
    accentNight: '#88c0d0',
    ruleLight: '#5e81ac',
    ruleNight: '#88c0d0',
    quoteBgLight: '#eceff4',
    quoteBgNight: '#272c37',
  },
}

/** The full note-type stylesheet for a theme, marker line first. */
export function noteTypeCss(theme: NoteTypeTheme): string {
  const t = THEME_TOKENS[theme]
  return `${styleMarker(theme)}
/* Lectern card design — edit freely; edits remove the marker's guarantees:
   once this file no longer carries the exact marker line above, the app
   stops touching this note type. */

@font-face {
  font-family: 'Lectern Serif';
  src: url('${FONT_FILES.serif}') format('woff2');
  font-style: normal;
  font-weight: 200 900;
}
@font-face {
  font-family: 'Lectern Serif';
  src: url('${FONT_FILES.serifItalic}') format('woff2');
  font-style: italic;
  font-weight: 200 900;
}
@font-face {
  font-family: 'Lectern Mono';
  src: url('${FONT_FILES.mono}') format('woff2');
  font-style: normal;
  font-weight: 400;
}
@font-face {
  font-family: 'Lectern Mono';
  src: url('${FONT_FILES.mono500}') format('woff2');
  font-style: normal;
  font-weight: 500;
}

.card {
  background-color: ${t.light.ground};
  --sheet: ${t.light.sheet};
  --ink: ${t.light.ink};
  --ink-soft: ${t.light.soft};
  --edge: ${t.light.edge};
  --accent: ${t.accentLight};
  --rule: ${t.ruleLight};
  --quote-bg: ${t.quoteBgLight};
  --sheet-shadow: 0 1px 2px rgba(56, 46, 32, 0.08), 0 6px 18px rgba(56, 46, 32, 0.11);
  padding: 0.5em 0;
}
.card.night_mode {
  background-color: ${t.night.ground};
  --sheet: ${t.night.sheet};
  --ink: ${t.night.ink};
  --ink-soft: ${t.night.soft};
  --edge: ${t.night.edge};
  --accent: ${t.accentNight};
  --rule: ${t.ruleNight};
  --quote-bg: ${t.quoteBgNight};
  --sheet-shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 8px 22px rgba(0, 0, 0, 0.38);
}
html:not(.mobile) .card {
  padding: 0.5em;
}

.lc {
  background-color: var(--sheet);
  border-radius: 8px;
  box-shadow: var(--sheet-shadow);
  color: var(--ink);
  font-family: 'Lectern Serif', Charter, Georgia, serif;
  font-size: 16px;
  line-height: 1.56;
  margin: 0 auto;
  max-width: 32em;
  padding: 1.6em 1.9em 1.4em;
  text-align: left;
  overflow-wrap: break-word;
}
.mobile .lc {
  padding: 1.1em 1.2em 1em;
}

.lc-topic {
  color: var(--ink-soft);
  font-family: 'Lectern Mono', ui-monospace, Menlo, monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.09em;
  margin-bottom: 1.2em;
  text-transform: uppercase;
}

.lc-q {
  font-size: 1.125em;
  font-weight: 560;
  line-height: 1.45;
}

.lc-rule {
  background-color: var(--rule);
  border: none;
  height: 2px;
  margin: 1.35em 0;
  width: 2.5em;
}

.lc b,
.lc strong {
  font-weight: 650;
}

.cloze {
  color: var(--accent);
  font-weight: 600;
}

.lc ol,
.lc ul {
  margin: 0.4em 0 0;
  padding-left: 1.4em;
}
.lc li {
  margin: 0.3em 0;
}

.lc img {
  border-radius: 4px;
  display: block;
  margin: 0.8em auto;
  max-width: 100%;
}

.lc-foot {
  border-top: 1px solid var(--edge);
  color: var(--ink-soft);
  font-family: 'Lectern Mono', ui-monospace, Menlo, monospace;
  font-size: 12px;
  margin-top: 1.7em;
  padding-top: 0.95em;
}

.lc-ex {
  margin-top: 0.55em;
}
.lc-ex summary {
  cursor: pointer;
  list-style: none;
}
.lc-ex summary::-webkit-details-marker {
  display: none;
}
.lc-ex summary::before {
  content: '+ ';
  font-weight: 500;
}
.lc-ex[open] summary::before {
  content: '\\2212 ';
}
.lc-ex blockquote {
  background-color: var(--quote-bg);
  border-left: 2px solid var(--rule);
  border-radius: 0 4px 4px 0;
  color: var(--ink-soft);
  font-family: 'Lectern Serif', Charter, Georgia, serif;
  font-size: 14px;
  font-style: italic;
  line-height: 1.55;
  margin: 0.7em 0 0.2em;
  padding: 0.7em 1em;
}

/* Anki's type-in-the-answer widgets, kept on-theme for future note types
   and for users who add {{type:...}} themselves. */
input#typeans {
  background-color: var(--quote-bg);
  border: 1px solid var(--edge);
  border-radius: 6px;
  color: var(--ink);
  font-family: 'Lectern Mono', ui-monospace, Menlo, monospace;
  font-size: 14px;
  padding: 0.6em 0.8em;
}
code#typeans {
  background-color: var(--quote-bg);
  border-radius: 6px;
  font-family: 'Lectern Mono', ui-monospace, Menlo, monospace;
  font-size: 14px;
  padding: 0.35em 0.7em;
}
`
}
