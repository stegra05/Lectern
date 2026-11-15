import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Card } from '../../../shared/contract.ts'
import {
  cloze,
  clozeForTyping,
  fieldIsEmpty,
  renderCard,
  renderTemplate,
  typeAnswer,
} from './render.ts'

describe('renderTemplate', () => {
  it('replaces fields and leaves unknown ones empty', () => {
    expect(renderTemplate('<b>{{Front}}</b>{{Nope}}', { Front: 'Q <i>x</i>' }, 1, 'front')).toBe(
      '<b>Q <i>x</i></b>',
    )
  })

  it('shows a section only when its field is set, an inverted one only when it is empty', () => {
    const t = '{{#Asked}}asked {{Asked}}{{/Asked}}{{^Asked}}core{{/Asked}}'
    expect(renderTemplate(t, { Asked: '4' }, 1, 'front')).toBe('asked 4')
    expect(renderTemplate(t, { Asked: '' }, 1, 'front')).toBe('core')
    expect(renderTemplate(t, {}, 1, 'front')).toBe('core')
  })

  it('nests sections', () => {
    const t = '{{#Asked}}asked {{Asked}}×{{#Part}}, {{Part}}{{/Part}}{{/Asked}}'
    expect(renderTemplate(t, { Asked: '4', Part: 'essay' }, 1, 'front')).toBe('asked 4×, essay')
    expect(renderTemplate(t, { Asked: '4', Part: '' }, 1, 'front')).toBe('asked 4×')
    expect(renderTemplate(t, { Asked: '', Part: 'essay' }, 1, 'front')).toBe('')
  })

  it('leaves the typing marker for the reviewer step', () => {
    expect(
      renderTemplate('{{#Typed}}{{type:Typed}}{{/Typed}}', { Typed: 'risk' }, 1, 'front'),
    ).toBe('[[type:Typed]]')
  })

  it('rejects unbalanced sections', () => {
    expect(() => renderTemplate('{{#A}}x', {}, 1, 'front')).toThrow()
    expect(() => renderTemplate('x{{/A}}', {}, 1, 'front')).toThrow()
    expect(() => renderTemplate('{{#A}}{{/B}}', {}, 1, 'front')).toThrow()
  })
})

describe('fieldIsEmpty', () => {
  it('treats whitespace, br and div as empty, as Anki does', () => {
    expect(fieldIsEmpty('')).toBe(true)
    expect(fieldIsEmpty(' <br> <div></div>\n')).toBe(true)
    expect(fieldIsEmpty('<span></span>')).toBe(false)
    expect(fieldIsEmpty('0')).toBe(false)
  })
})

describe('cloze', () => {
  const text = 'A {{c1::first one}} and {{c2::second}} and {{c1::again}}.'

  it('hides the asked deletion on the front with its text in data-cloze', () => {
    expect(cloze(text, 1, 'front')).toBe(
      'A <span class="cloze" data-cloze="first&#x20;one" data-ordinal="1">[...]</span> and ' +
        '<span class="cloze-inactive" data-ordinal="2">second</span> and ' +
        '<span class="cloze" data-cloze="again" data-ordinal="1">[...]</span>.',
    )
  })

  it('reveals it on the back', () => {
    expect(cloze(text, 1, 'back')).toBe(
      'A <span class="cloze" data-ordinal="1">first one</span> and ' +
        '<span class="cloze-inactive" data-ordinal="2">second</span> and ' +
        '<span class="cloze" data-ordinal="1">again</span>.',
    )
  })

  it('shows a hint in place of the dots', () => {
    expect(cloze('{{c1::x::hint}}', 1, 'front')).toBe(
      '<span class="cloze" data-cloze="x" data-ordinal="1">[hint]</span>',
    )
  })

  it('joins the deletions of one card for typing', () => {
    expect(clozeForTyping(text, 1)).toBe('first one, again')
  })
})

describe('typeAnswer', () => {
  it('puts a box on the front and the expected text on the back', () => {
    expect(typeAnswer('<p>[[type:Typed]]</p>', 'front', () => '')).toContain(
      '<input type=text id=typeans',
    )
    expect(typeAnswer('<p>[[type:Typed]]</p>', 'back', () => 'a < b')).toContain(
      '<code id=typeans>a &lt; b</code>',
    )
  })
})

// The gallery holds the markup Anki's own engine produced for these cards (design/cards/build.py).
const gallery = readFileSync(
  new URL('../../../../../../design/cards/gallery.html', import.meta.url),
  'utf8',
)
const rendered = JSON.parse(gallery.match(/const CARDS = (\[[\s\S]*?\]);\n/)![1]!) as {
  id: string
  front: string
  back: string
}[]
const byId = (id: string) => rendered.find((c) => c.id === id)!
const thumb = (name: string, lecture: number, slide: number) =>
  `<img src="media/${name}.svg" alt="Lecture ${lecture}, slide ${slide}">`

describe('renderCard matches Anki', () => {
  it('renders a Q&A card', () => {
    const card: Card = {
      id: '1',
      note: 'qa',
      concept: 'risk',
      slide: 14,
      fields: {
        Front: 'Knight (1921): what is risk?',
        Back: 'An outcome whose <mark>probability can be calculated or known</mark>, e.g. opening a hairdresser shop.',
        Role: 'definition',
        Lecture: '02',
        Topic: 'Effectuation',
        Source: 'Lecture 2, slide 14',
        Asked: '4',
        Part: 'short answer',
        Key: 'risk',
        Extra:
          'Knight sets risk against uncertainty, where the probabilities cannot be known. Effectuation is a method for uncertainty.',
        Excerpt:
          'Risk: the distribution of outcomes is known, either a priori or from statistics of past cases.',
        Slide: thumb('l02-s14', 2, 14),
      },
    }
    expect(renderCard(card, 'front')).toBe(byId('1').front)
    expect(renderCard(card, 'back')).toBe(byId('1').back)
  })

  it('renders a cloze card with deletion 1 asked', () => {
    const card: Card = {
      id: '10',
      note: 'cloze',
      concept: 'dijkstra',
      slide: 15,
      fields: {
        Text: "Dijkstra's algorithm fails with {{c1::negative edge weights}} because a settled node's distance {{c2::can still decrease}}.",
        Role: 'cloze',
        Lecture: '08',
        Topic: 'Shortest paths',
        Source: 'Lecture 8, slide 15',
        Asked: '3',
        Part: 'multiple choice',
        Key: 'Dijkstra, negative weights',
        Extra: 'Use Bellman-Ford when negative weights can occur.',
        Excerpt: 'Dijkstra assumes w(e) ≥ 0: once a node is settled, its distance is final.',
        Slide: thumb('l08-s15', 8, 15),
      },
    }
    expect(renderCard(card, 'front')).toBe(byId('10').front)
    expect(renderCard(card, 'back')).toBe(byId('10').back)
    // The typed variant differs from Anki only by the key handler the preview leaves out.
    const typed = { ...card, fields: { ...card.fields, Typed: 'on' } }
    expect(renderCard(typed, 'front')).toBe(
      byId('10t').front.replace(' onkeypress="_typeAnsPress();"', ''),
    )
  })
})
