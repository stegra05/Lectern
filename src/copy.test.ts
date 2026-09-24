/**
 * House rules for every string the app can show: no em-dashes, and real
 * plurals instead of "card(s)". Checked on the syntax tree, so comments are
 * free to say what they like and only literals, templates and JSX text count.
 * See "Writing for users" in CONTRIBUTING.md.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname)

/** Prompt text is written for the model, not for the student. */
const MODEL_FACING = new Set(['engine/prompts.ts'])

const RULES: Array<{ name: string; test: (text: string) => boolean }> = [
  // The bare character is data (the HTML entity table), not copy.
  { name: 'em-dash', test: (text) => text.includes('—') && text !== '—' },
  { name: '"(s)" plural', test: (text) => /\w\(s\)/.test(text) },
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function copyViolations(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const found: string[] = []
  const check = (node: ts.Node, text: string) => {
    for (const rule of RULES) {
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

describe('user-facing copy', () => {
  it('follows the house rules in every string literal', () => {
    const violations = sourceFiles(SRC)
      .filter((path) => !MODEL_FACING.has(relative(SRC, path)))
      .flatMap(copyViolations)
    expect(violations).toEqual([])
  })
})
