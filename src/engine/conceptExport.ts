/**
 * Concept-map export — the map as text you can paste somewhere else.
 *
 * Two shapes, because the two places people put these differ:
 * - Markdown outline for outliners and note apps (RemNote, Notion, Obsidian).
 *   Nesting is the payload: relations sit under the concept they belong to, so
 *   an outliner turns them into child items rather than a flat wall.
 * - Mermaid for the graph itself, which renders in Notion, Obsidian, and
 *   GitHub without a plugin.
 *
 * Pure functions over ConceptMap — no UI imports, no clipboard.
 */

import { formatPageRefs } from './noteTypes'
import type { Concept, ConceptMap, Importance, Relation } from './types'
import { relationKeyOf } from './types'

export const IMPORTANCE_ORDER: Importance[] = ['high', 'medium', 'low']

export const SECTION_HEADING: Record<Importance, string> = {
  high: 'Key concepts',
  medium: 'Supporting concepts',
  low: 'Background',
}

/** `is_a` / `partOf` / `contrasts with` all read as prose. */
export function humanizeRelationType(type: string): string {
  return type
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Concept names come from the model, so characters that would restyle the
 * text in the target app get escaped. Only the ones that mean something
 * *inline*: every name here is emitted after a `- ` or inside `**…**`, never
 * at the start of a line, so `-`, `#`, `>` and `.` are safe as written —
 * escaping those would put visible backslashes into "gradient-based".
 */
export const escapeMarkdown = (value: string): string => value.replace(/([\\`*_[\]])/g, '\\$1')

export const pageSuffix = (pages: number[]): string => {
  const refs = formatPageRefs(pages)
  return refs === '' ? '' : ` · ${refs}`
}

export interface RelationLine {
  /** The other end of the relation, already resolved to a name. */
  otherName: string
  /** Reading direction from the concept the line hangs under. */
  text: string
}

/**
 * Relations touching `concept`, phrased from its side: outgoing keep the
 * relation's direction, incoming are inverted so the line still reads
 * left-to-right ("← is a — Optimization"). Self-relations and relations
 * pointing at concepts outside the map are dropped.
 */
export function relationsFor(
  concept: Concept,
  relations: Relation[],
  nameOf: (id: string) => string | undefined,
): RelationLine[] {
  const lines: RelationLine[] = []
  const seen = new Set<string>()
  for (const relation of relations) {
    const isSource = relation.source === concept.id
    const isTarget = relation.target === concept.id
    if (isSource === isTarget) continue // untouched, or a self-relation
    const otherId = isSource ? relation.target : relation.source
    const otherName = nameOf(otherId)
    if (otherName === undefined || otherName === '') continue
    const key = relationKeyOf(relation)
    if (seen.has(key)) continue
    seen.add(key)
    const verb = humanizeRelationType(relation.type)
    lines.push({
      otherName,
      text: isSource ? `${verb} → ${otherName}` : `← ${verb} — ${otherName}`,
    })
  }
  return lines
}

/**
 * The map as a Markdown outline: objectives, then concepts grouped by
 * importance, each with its difficulty, pages, and relations nested beneath.
 */
export function conceptMapToMarkdown(conceptMap: ConceptMap): string {
  const title = conceptMap.slideSetName.trim() || 'Concept map'
  const nameOf = (id: string): string | undefined =>
    conceptMap.concepts.find((c) => c.id === id)?.name.trim()

  const lines: string[] = [`# ${escapeMarkdown(title)}`, '']

  const objectives = conceptMap.objectives.map((o) => o.trim()).filter(Boolean)
  if (objectives.length > 0) {
    lines.push('## Learning objectives', '')
    for (const objective of objectives) lines.push(`- ${escapeMarkdown(objective)}`)
    lines.push('')
  }

  for (const importance of IMPORTANCE_ORDER) {
    const group = conceptMap.concepts.filter((c) => c.importance === importance)
    if (group.length === 0) continue
    lines.push(`## ${SECTION_HEADING[importance]}`, '')
    for (const concept of group) {
      const name = concept.name.trim()
      if (name === '') continue
      lines.push(
        `- **${escapeMarkdown(name)}** — ${concept.difficulty}${pageSuffix(concept.pageReferences)}`,
      )
      for (const relation of relationsFor(concept, conceptMap.relations, nameOf)) {
        lines.push(`  - ${escapeMarkdown(relation.text)}`)
      }
    }
    lines.push('')
  }

  // This line ends up pasted into someone's notes, so it counts properly.
  const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`
  lines.push(
    '---',
    '',
    `${count(conceptMap.concepts.length, 'concept')} · ` +
      `${count(conceptMap.relations.length, 'relation')} · ` +
      `${count(conceptMap.pageCount, 'page')} — mapped by Lectern`,
  )

  return lines.join('\n')
}

/** Mermaid rejects most punctuation in node ids, so nodes are numbered and
 *  the real name lives in the (quoted, escaped) label. */
const mermaidLabel = (value: string): string => `"${value.replace(/"/g, "'")}"`

/** Edge labels sit between pipes, where `|` and quotes would break the line. */
const mermaidEdgeLabel = (value: string): string => value.replace(/["|]/g, ' ').trim()

/**
 * Node shape carries importance, so the diagram still ranks its concepts
 * after it leaves Lectern. Shapes travel where colors may not: a renderer
 * that ignores `classDef` still draws a stadium differently from a box.
 */
const MERMAID_SHAPE: Record<Importance, (label: string) => string> = {
  high: (label) => `([${label}])`,
  medium: (label) => `[${label}]`,
  low: (label) => `(${label})`,
}

/** Muted fills in the same register as the app, readable on light or dark. */
const MERMAID_CLASSES = [
  'classDef key fill:#e8a33d22,stroke:#b97a1e,stroke-width:2px;',
  'classDef supporting fill:#8882,stroke:#888,stroke-width:1px;',
  'classDef background fill:none,stroke:#8886,stroke-width:1px,color:#888;',
]

const MERMAID_CLASS_OF: Record<Importance, string> = {
  high: 'key',
  medium: 'supporting',
  low: 'background',
}

/**
 * The map as a Mermaid flowchart. Only concepts that carry a name become
 * nodes; relations whose ends are missing are skipped, so the diagram never
 * references an undeclared node.
 */
export function conceptMapToMermaid(conceptMap: ConceptMap): string {
  const nodeIds = new Map<string, string>()
  const byImportance = new Map<Importance, string[]>()
  const lines: string[] = ['```mermaid', 'graph TD']

  // Declared most-important first so the layout engine puts the spine on top.
  for (const importance of IMPORTANCE_ORDER) {
    for (const concept of conceptMap.concepts) {
      if (concept.importance !== importance) continue
      const name = concept.name.trim()
      if (name === '' || nodeIds.has(concept.id)) continue
      const nodeId = `n${nodeIds.size}`
      nodeIds.set(concept.id, nodeId)
      lines.push(`  ${nodeId}${MERMAID_SHAPE[importance](mermaidLabel(name))}`)
      const group = byImportance.get(importance)
      if (group === undefined) byImportance.set(importance, [nodeId])
      else group.push(nodeId)
    }
  }

  const seen = new Set<string>()
  for (const relation of conceptMap.relations) {
    const source = nodeIds.get(relation.source)
    const target = nodeIds.get(relation.target)
    if (source === undefined || target === undefined || source === target) continue
    const key = relationKeyOf(relation)
    if (seen.has(key)) continue
    seen.add(key)
    const verb = mermaidEdgeLabel(humanizeRelationType(relation.type))
    lines.push(verb === '' ? `  ${source} --> ${target}` : `  ${source} -->|${verb}| ${target}`)
  }

  if (nodeIds.size > 0) {
    lines.push('', ...MERMAID_CLASSES.map((rule) => `  ${rule}`))
    for (const [importance, nodes] of byImportance) {
      lines.push(`  class ${nodes.join(',')} ${MERMAID_CLASS_OF[importance]};`)
    }
  }

  lines.push('```')
  return lines.join('\n')
}
