import { describe, expect, it } from 'vitest'
import { conceptMapToMarkdown, conceptMapToMermaid, humanizeRelationType } from './conceptExport'
import type { ConceptMap } from './types'

const map: ConceptMap = {
  objectives: ['Understand gradient descent', '  '],
  concepts: [
    {
      id: 'gd',
      name: 'Gradient Descent',
      importance: 'high',
      difficulty: 'foundational',
      pageReferences: [12, 13, 14, 18],
    },
    {
      id: 'lr',
      name: 'Learning Rate',
      importance: 'medium',
      difficulty: 'intermediate',
      pageReferences: [14],
    },
    {
      id: 'bg',
      name: 'Linear Algebra',
      importance: 'low',
      difficulty: 'foundational',
      pageReferences: [],
    },
  ],
  relations: [
    { source: 'gd', type: 'depends_on', target: 'lr', pageReferences: [14] },
    { source: 'lr', type: 'contrastsWith', target: 'bg', pageReferences: [] },
    // Dangling target — must not reach either output.
    { source: 'gd', type: 'is_a', target: 'ghost', pageReferences: [] },
  ],
  language: 'en',
  slideSetName: 'ML Lecture 2',
  pageCount: 40,
  estimatedTextChars: 12000,
  documentType: 'slides',
}

describe('humanizeRelationType', () => {
  it('reads snake_case and camelCase as prose', () => {
    expect(humanizeRelationType('is_a')).toBe('is a')
    expect(humanizeRelationType('contrastsWith')).toBe('contrasts with')
    expect(humanizeRelationType('part-of')).toBe('part of')
  })
})

describe('conceptMapToMarkdown', () => {
  const md = conceptMapToMarkdown(map)

  it('titles the outline with the slide set', () => {
    expect(md.startsWith('# ML Lecture 2')).toBe(true)
  })

  it('lists objectives, dropping blank ones', () => {
    const section = md.slice(md.indexOf('## Learning objectives'), md.indexOf('## Key concepts'))
    expect(section.match(/^- .+$/gm)).toEqual(['- Understand gradient descent'])
  })

  it('groups concepts by importance', () => {
    expect(md).toContain('## Key concepts')
    expect(md).toContain('## Supporting concepts')
    expect(md).toContain('## Background')
  })

  it('collapses consecutive pages into runs', () => {
    expect(md).toContain('**Gradient Descent** — foundational · pp. 12–14, 18')
  })

  it('omits the page suffix when a concept has no pages', () => {
    expect(md).toContain('**Linear Algebra** — foundational\n')
  })

  it('nests relations under the concept, phrased from its side', () => {
    expect(md).toContain('  - depends on → Learning Rate')
    expect(md).toContain('  - ← depends on — Gradient Descent')
  })

  it('drops relations pointing outside the map', () => {
    expect(md).not.toContain('ghost')
  })

  it('escapes the markdown punctuation that would restyle a name', () => {
    const risky = conceptMapToMarkdown({
      ...map,
      concepts: [{ ...map.concepts[0], name: 'O(n*log n) [amortized] with x_i' }],
      relations: [],
    })
    expect(risky).toContain('O(n\\*log n) \\[amortized\\] with x\\_i')
  })

  it('leaves punctuation that only matters at the start of a line alone', () => {
    const plain = conceptMapToMarkdown({
      ...map,
      objectives: ['Apply gradient-based methods. Compare #1 vs #2.'],
      concepts: [{ ...map.concepts[0], name: 'Well-posed problems' }],
      relations: [],
    })
    expect(plain).toContain('- Apply gradient-based methods. Compare #1 vs #2.')
    expect(plain).toContain('**Well-posed problems**')
    expect(plain).not.toContain('\\')
  })

  it('closes with a summary line', () => {
    expect(md).toContain('3 concepts · 3 relations · 40 pages — mapped by Lectern')
  })

  it('counts singulars properly in the summary line', () => {
    const one = conceptMapToMarkdown({
      ...map,
      concepts: [map.concepts[0]],
      relations: [map.relations[0]],
      pageCount: 1,
    })
    expect(one).toContain('1 concept · 1 relation · 1 page — mapped by Lectern')
  })
})

describe('conceptMapToMermaid', () => {
  const mermaid = conceptMapToMermaid(map)

  it('wraps a graph in a fenced mermaid block', () => {
    expect(mermaid.startsWith('```mermaid\ngraph TD')).toBe(true)
    expect(mermaid.endsWith('```')).toBe(true)
  })

  it('numbers nodes and keeps the name in the label', () => {
    expect(mermaid).toContain('n0(["Gradient Descent"])')
    expect(mermaid).toContain('n1["Learning Rate"]')
  })

  it('carries importance in the node shape and class', () => {
    expect(mermaid).toContain('n0(["Gradient Descent"])') // high → stadium
    expect(mermaid).toContain('n1["Learning Rate"]') // medium → box
    expect(mermaid).toContain('n2("Linear Algebra")') // low → round
    expect(mermaid).toContain('class n0 key;')
    expect(mermaid).toContain('class n1 supporting;')
    expect(mermaid).toContain('class n2 background;')
    expect(mermaid).toContain('classDef key ')
  })

  it('declares key concepts first, so the spine lands at the top', () => {
    const order = [...mermaid.matchAll(/^ {2}n\d+[[(]+"([^"]+)"/gm)].map((m) => m[1])
    expect(order).toEqual(['Gradient Descent', 'Learning Rate', 'Linear Algebra'])
  })

  it('emits no class lines for an empty map', () => {
    const empty = conceptMapToMermaid({ ...map, concepts: [], relations: [] })
    expect(empty).not.toContain('classDef')
    expect(empty).toBe('```mermaid\ngraph TD\n```')
  })

  it('labels edges with the humanized relation', () => {
    expect(mermaid).toContain('n0 -->|depends on| n1')
  })

  it('never references an undeclared node', () => {
    const declared = new Set([...mermaid.matchAll(/^ {2}(n\d+)[[(]/gm)].map((m) => m[1]))
    for (const [, from, to] of mermaid.matchAll(/^ {2}(n\d+) -->(?:\|[^|]*\|)? (n\d+)$/gm)) {
      expect(declared.has(from)).toBe(true)
      expect(declared.has(to)).toBe(true)
    }
  })

  it('quotes labels safely', () => {
    const risky = conceptMapToMermaid({
      ...map,
      concepts: [{ ...map.concepts[0], name: 'The "hard" case' }],
      relations: [],
    })
    expect(risky).toContain(`n0(["The 'hard' case"])`)
  })
})
