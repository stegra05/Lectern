/**
 * House rules checked on every source file, so review does not have to.
 *
 * Copy: no em-dashes, and real plurals instead of "card(s)", in every string
 * the app can show. See "Writing for users" in CONTRIBUTING.md.
 *
 * Design: colors, type sizes, radii and shadows come from the tokens in
 * index.css. No hex or rgb() colors, no Tailwind default palette, no arbitrary
 * text/shadow/radius values. See "Code layout" in CONTRIBUTING.md.
 *
 * Checked on the syntax tree, so comments are free to say what they like and
 * only literals, templates and JSX text count.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname)

/** Prompt text is written for the model, not for the student. */
const MODEL_FACING = new Set(['engine/prompts.ts'])

/** The engine styles what leaves the app (Anki note types, Mermaid exports),
 *  where the app's tokens do not exist. */
const OUTSIDE_THE_APP = 'engine/'

interface Rule {
  name: string
  test: (text: string) => boolean
}

const COPY_RULES: Rule[] = [
  // The bare character is data (the HTML entity table), not copy.
  { name: 'em-dash', test: (text) => text.includes('—') && text !== '—' },
  { name: '"(s)" plural', test: (text) => /\w\(s\)/.test(text) },
]

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black'
const COLOR_UTILITIES =
  'bg|text|border|ring|fill|stroke|from|via|to|shadow|outline|decoration|accent|caret|divide|placeholder'

const DESIGN_RULES: Rule[] = [
  { name: 'raw color', test: (text) => /#[0-9a-f]{3,8}\b|\brgba?\(/i.test(text) },
  {
    name: 'default palette',
    test: (text) => new RegExp(`\\b(?:${COLOR_UTILITIES})-(?:${PALETTE})\\b`).test(text),
  },
  { name: 'arbitrary value', test: (text) => /\b(?:text|shadow|rounded)-\[/.test(text) },
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function violations(path: string, rules: Rule[]): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const found: string[] = []
  const check = (node: ts.Node, text: string) => {
    for (const rule of rules) {
      if (!rule.test(text)) continue
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
      found.push(`${relative(SRC, path)}:${line + 1} ${rule.name}: ${text.trim().slice(0, 80)}`)
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      check(node, node.text)
    } else if (
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      check(node, node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** index.css lines outside the @theme block, where every raw color lives. */
function stylesheetViolations(): string[] {
  const lines = readFileSync(join(SRC, 'index.css'), 'utf8').split('\n')
  const found: string[] = []
  let inTheme = false
  lines.forEach((line, i) => {
    if (line.startsWith('@theme')) inTheme = true
    else if (inTheme && line.startsWith('}')) inTheme = false
    else if (!inTheme && !line.trimStart().startsWith('/*')) {
      for (const rule of DESIGN_RULES) {
        if (rule.test(line)) found.push(`index.css:${i + 1} ${rule.name}: ${line.trim()}`)
      }
    }
  })
  return found
}

describe('house rules', () => {
  const files = sourceFiles(SRC)

  it('keeps user-facing copy to the writing rules', () => {
    const found = files
      .filter((path) => !MODEL_FACING.has(relative(SRC, path)))
      .flatMap((path) => violations(path, COPY_RULES))
    expect(found).toEqual([])
  })

  it('takes every color, size, radius and shadow from the design tokens', () => {
    const found = [
      ...files
        .filter((path) => !relative(SRC, path).startsWith(OUTSIDE_THE_APP))
        .flatMap((path) => violations(path, DESIGN_RULES)),
      ...stylesheetViolations(),
    ]
    expect(found).toEqual([])
  })
})
