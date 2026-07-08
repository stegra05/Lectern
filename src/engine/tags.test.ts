import { describe, expect, it } from 'vitest'

import { buildCardTags, buildHierarchicalTag, cleanTagPart } from './tags'

const TEMPLATE = '{{deck}}::{{slide_set}}::{{topic}}'

describe('cleanTagPart', () => {
  it('replaces disallowed characters and turns spaces into dashes', () => {
    expect(cleanTagPart('lecture 1: supervised learning', { titleCase: true })).toBe(
      'Lecture-1-Supervised-Learning',
    )
  })

  it('keeps single in-word dashes but collapses dash/space runs', () => {
    expect(cleanTagPart('Lecture-1')).toBe('Lecture-1')
    expect(cleanTagPart('Lecture - 1')).toBe('Lecture-1')
  })

  it('preserves acronyms and digits while Title Casing the rest', () => {
    expect(cleanTagPart('INTRO to NLP', { titleCase: true })).toBe('INTRO-To-NLP')
    expect(cleanTagPart('chapter 2 basics', { titleCase: true })).toBe('Chapter-2-Basics')
  })

  it('lowercases in slug mode', () => {
    expect(cleanTagPart('Deep Learning', { slug: true })).toBe('deep-learning')
  })

  it('handles empty input and strips edge dashes/spaces', () => {
    expect(cleanTagPart('')).toBe('')
    expect(cleanTagPart('  --Trees-- ')).toBe('Trees')
  })
})

describe('buildHierarchicalTag', () => {
  it('builds a full three-level tag with Title Cased slide set and topic', () => {
    const tag = buildHierarchicalTag(TEMPLATE, {
      deck: 'Machine Learning',
      slideSet: 'lecture 1: supervised learning',
      topic: 'image classification',
    })
    expect(tag).toBe('Machine-Learning::Lecture-1-Supervised-Learning::Image-Classification')
  })

  it('collapses the trailing separator when the topic is empty', () => {
    expect(buildHierarchicalTag(TEMPLATE, { deck: 'ML', slideSet: 'Intro' })).toBe('ML::Intro')
    expect(buildHierarchicalTag(TEMPLATE, { deck: 'ML', slideSet: 'Intro', topic: '' })).toBe(
      'ML::Intro',
    )
  })

  it('collapses an empty middle segment', () => {
    expect(buildHierarchicalTag(TEMPLATE, { deck: 'ML', slideSet: '', topic: 'Trees' })).toBe(
      'ML::Trees',
    )
  })

  it('cleans each segment of a hierarchical deck name separately', () => {
    expect(
      buildHierarchicalTag(TEMPLATE, {
        deck: 'Uni 2026::ML Course',
        slideSet: 'week 3',
        topic: 'SVM',
      }),
    ).toBe('Uni-2026::ML-Course::Week-3::SVM')
  })

  it('sanitizes characters Anki tags cannot hold', () => {
    expect(
      buildHierarchicalTag(TEMPLATE, {
        deck: 'Bio/Chem',
        slideSet: 'Enzymes & Kinetics!',
        // en dash is sanitized to "-"; capitalize() lowers the rest of the
        // word (Python parity), so "Menten" becomes "menten".
        topic: 'Michaelis–Menten',
      }),
    ).toBe('Bio-Chem::Enzymes-Kinetics::Michaelis-menten')
  })

  it('returns an empty string when every part is empty', () => {
    expect(buildHierarchicalTag(TEMPLATE, { deck: '', slideSet: '' })).toBe('')
  })
})

describe('buildCardTags', () => {
  const base = {
    template: TEMPLATE,
    deck: 'Machine Learning',
    slideSet: 'Lecture 1',
    topic: 'Regression',
    defaultTag: 'lectern',
  }

  it('appends the default tag when enabled', () => {
    expect(buildCardTags({ ...base, enableDefaultTag: true })).toEqual([
      'Machine-Learning::Lecture-1::Regression',
      'lectern',
    ])
  })

  it('omits the default tag when disabled', () => {
    expect(buildCardTags({ ...base, enableDefaultTag: false })).toEqual([
      'Machine-Learning::Lecture-1::Regression',
    ])
  })

  it('omits an empty or whitespace-only default tag', () => {
    expect(buildCardTags({ ...base, defaultTag: '', enableDefaultTag: true })).toEqual([
      'Machine-Learning::Lecture-1::Regression',
    ])
    expect(buildCardTags({ ...base, defaultTag: '   ', enableDefaultTag: true })).toEqual([
      'Machine-Learning::Lecture-1::Regression',
    ])
  })

  it('dedupes the default tag against the primary tag', () => {
    expect(
      buildCardTags({
        template: '{{deck}}',
        deck: 'lectern',
        slideSet: '',
        defaultTag: 'lectern',
        enableDefaultTag: true,
      }),
    ).toEqual(['lectern'])
  })

  it('returns only the default tag when the hierarchical tag is empty', () => {
    expect(
      buildCardTags({
        template: TEMPLATE,
        deck: '',
        slideSet: '',
        defaultTag: 'lectern',
        enableDefaultTag: true,
      }),
    ).toEqual(['lectern'])
  })
})
