/**
 * Study-guide export — the session's intelligence as a document you study from.
 *
 * Unlike the concept-map exports (which carry the map alone), the guide folds
 * in what the deck actually covers: per-concept card counts, and a gap section
 * naming the high-importance concepts and pages that have no cards — the app
 * admitting where you still have to read the slides yourself.
 *
 * Pure function over session data — no UI imports, no clipboard, no LLM call.
 */

import {
  escapeMarkdown,
  IMPORTANCE_ORDER,
  pageSuffix,
  relationsFor,
  SECTION_HEADING,
} from './conceptExport'
import { formatPageRefs } from './noteTypes'
import type { Card, ConceptMap, CoverageData } from './types'

/** Cards that will actually be studied: everything not held back from Anki. */
const studiedCards = (cards: Card[]): Card[] => cards.filter((card) => !card.syncExcluded)

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

/**
 * The guide as Markdown: objectives, concepts grouped by importance — each
 * with difficulty, pages, relations, and how many cards the deck holds on it —
 * then the gaps. `coverage` may be null early in a session; the gap section
 * simply stays out until the ledger has spoken.
 */
export function studyGuideToMarkdown(
  conceptMap: ConceptMap,
  coverage: CoverageData | null,
  cards: Card[],
): string {
  const setName = conceptMap.slideSetName.trim()
  const title = setName === '' ? 'Study guide' : `${setName} — Study guide`
  const nameOf = (id: string): string | undefined =>
    conceptMap.concepts.find((c) => c.id === id)?.name.trim()

  const studied = studiedCards(cards)
  const cardsPerConcept = new Map<string, number>()
  for (const card of studied) {
    for (const id of card.conceptIds) {
      cardsPerConcept.set(id, (cardsPerConcept.get(id) ?? 0) + 1)
    }
  }

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
      const cardCount = cardsPerConcept.get(concept.id) ?? 0
      // Zero is left unsaid: the gap section names the absences that matter,
      // and "0 cards" down every background row reads like a reproach.
      const cardsNote = cardCount > 0 ? ` · ${count(cardCount, 'card')}` : ''
      lines.push(
        `- **${escapeMarkdown(name)}** — ${concept.difficulty}` +
          `${pageSuffix(concept.pageReferences)}${cardsNote}`,
      )
      for (const relation of relationsFor(concept, conceptMap.relations, nameOf)) {
        lines.push(`  - ${escapeMarkdown(relation.text)}`)
      }
    }
    lines.push('')
  }

  if (coverage) {
    const missing = coverage.missingHighPriority
      .map((id) => nameOf(id))
      .filter((name): name is string => name !== undefined && name !== '')
    const uncovered = formatPageRefs(coverage.uncoveredPages)

    if (missing.length > 0 || uncovered !== '') {
      lines.push('## Review in the slides directly', '')
      lines.push('No cards cover these — go back to the source material:', '')
      for (const id of coverage.missingHighPriority) {
        const name = nameOf(id)
        if (name === undefined || name === '') continue
        const concept = conceptMap.concepts.find((c) => c.id === id)
        lines.push(`- **${escapeMarkdown(name)}**${pageSuffix(concept?.pageReferences ?? [])}`)
      }
      if (uncovered !== '') {
        lines.push(`- Pages without any card: ${uncovered}`)
      }
      lines.push('')
    }
  }

  const stats = [
    count(conceptMap.concepts.length, 'concept'),
    count(studied.length, 'card'),
    ...(coverage ? [`${Math.round(coverage.effectiveConceptCoveragePercent)}% covered`] : []),
  ]
  lines.push('---', '', `${stats.join(' · ')} — study guide by Lectern`)

  return lines.join('\n')
}

/** A filename the OS will take: the deck's name, minus path separators and
 *  the characters Windows reserves, collapsed to single spaces. */
export function studyGuideFilename(conceptMap: ConceptMap): string {
  const base = conceptMap.slideSetName
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return base === '' ? 'Study guide.md' : `${base} — Study guide.md`
}
