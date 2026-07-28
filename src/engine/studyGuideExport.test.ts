import { describe, expect, it } from 'vitest'
import { studyGuideFilename, studyGuideToMarkdown } from './studyGuideExport'
import type { Card, ConceptMap, CoverageData } from './types'

const map: ConceptMap = {
  objectives: ['Understand gradient descent', '  '],
  concepts: [
    {
      id: 'gd',
      name: 'Gradient Descent',
      importance: 'high',
      difficulty: 'foundational',
      pageReferences: [12, 13],
    },
    {
      id: 'mo',
      name: 'Momentum',
      importance: 'high',
      difficulty: 'intermediate',
      pageReferences: [20, 21],
    },
    {
      id: 'lr',
      name: 'Learning Rate',
      importance: 'medium',
      difficulty: 'intermediate',
      pageReferences: [14],
    },
  ],
  relations: [{ source: 'gd', type: 'depends_on', target: 'lr', pageReferences: [14] }],
  language: 'en',
  slideSetName: 'ML Lecture 2',
  pageCount: 30,
  estimatedTextChars: 12000,
  documentType: 'slides',
}

const card = (uid: string, conceptIds: string[], syncExcluded = false): Card => ({
  uid,
  modelName: 'Basic',
  fields: { Front: `Q ${uid}`, Back: `A ${uid}` },
  sourcePages: [12],
  conceptIds,
  relationKeys: [],
  qualityScore: 100,
  qualityIssues: [],
  ...(syncExcluded ? { syncExcluded } : {}),
})

const coverage: CoverageData = {
  pageCount: 30,
  coveredPages: [12, 13, 14],
  uncoveredPages: [20, 21, 22],
  pageCoveragePercent: 10,
  coveredConceptIds: ['gd', 'lr'],
  inferredConceptIds: [],
  conceptCoveragePercent: 66,
  effectiveConceptCoveragePercent: 66.6,
  coveredRelationKeys: [],
  relationCoveragePercent: 0,
  missingHighPriority: ['mo'],
  saturatedPages: [],
  cardsPerPage: { 12: 2, 13: 1 },
}

describe('studyGuideToMarkdown', () => {
  const cards = [card('a', ['gd']), card('b', ['gd', 'lr']), card('x', ['gd'], true)]
  const md = studyGuideToMarkdown(map, coverage, cards)

  it('titles the guide with the slide set', () => {
    expect(md.startsWith('# ML Lecture 2 — Study guide')).toBe(true)
  })

  it('counts only cards that will reach Anki', () => {
    // 'x' is syncExcluded, so Gradient Descent holds 2 cards, not 3.
    expect(md).toContain('**Gradient Descent** — foundational · pp. 12–13 · 2 cards')
    expect(md).toContain('**Learning Rate** — intermediate · p. 14 · 1 card')
  })

  it('leaves zero counts unsaid', () => {
    expect(md).toContain('**Momentum** — intermediate · pp. 20–21')
    expect(md).not.toContain('0 cards')
  })

  it('names missing high-priority concepts and uncovered pages in the gap section', () => {
    const gaps = md.slice(md.indexOf('## Review in the slides directly'))
    expect(gaps).toContain('**Momentum** · pp. 20–21')
    expect(gaps).toContain('Pages without any card: pp. 20–22')
  })

  it('closes with the session stats', () => {
    expect(md).toContain('3 concepts · 2 cards · 67% covered — study guide by Lectern')
  })

  it('omits the gap section and coverage stat without coverage data', () => {
    const early = studyGuideToMarkdown(map, null, [])
    expect(early).not.toContain('## Review in the slides directly')
    expect(early).toContain('3 concepts · 0 cards — study guide by Lectern')
  })

  it('omits the gap section when nothing is missing', () => {
    const full = studyGuideToMarkdown(
      map,
      { ...coverage, missingHighPriority: [], uncoveredPages: [] },
      cards,
    )
    expect(full).not.toContain('## Review in the slides directly')
  })

  it('escapes markdown in model-written names', () => {
    const spicy = studyGuideToMarkdown(
      { ...map, concepts: [{ ...map.concepts[0], name: 'a*b_c' }], relations: [] },
      null,
      [],
    )
    expect(spicy).toContain('**a\\*b\\_c**')
  })
})

describe('studyGuideFilename', () => {
  it('names the file after the slide set', () => {
    expect(studyGuideFilename(map)).toBe('ML Lecture 2 — Study guide.md')
  })

  it('strips filesystem-hostile characters', () => {
    expect(studyGuideFilename({ ...map, slideSetName: 'ML: Intro / Part 2?' })).toBe(
      'ML Intro Part 2 — Study guide.md',
    )
  })

  it('falls back when the set has no name', () => {
    expect(studyGuideFilename({ ...map, slideSetName: '  ' })).toBe('Study guide.md')
  })
})
