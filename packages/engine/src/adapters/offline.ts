import type { Answer, DecisionsPort, ModelPort, ModelRequest, Question } from '../ports.ts'

/**
 * A stand-in for both models that needs no script and no network: it turns the text of any
 * slides into a small, plausible course. Each slide with a heading and lines under it becomes
 * a concept, each line a fact, each fact a card made of the slide's own words. For demos and
 * interface tests. It says nothing about what a real model writes.
 */

const CONCEPT_WORDS = 5
const FACTS = 3
const SLIDES_PER_TOPIC = 3

const take = (text: string, n: number) => text.split(/\s+/).slice(0, n).join(' ')

function map(context: string): unknown {
  const slides = [...context.matchAll(/^\[(\d+)\] (.*)$/gm)].map((m) => ({
    slide: Number(m[1]),
    lines: m[2]!.replace(' (see the picture of this slide)', '').split(' / ').filter(Boolean),
  }))
  const names = new Set<string>()
  const concepts = slides.slice(1).flatMap(({ slide, lines }, i) => {
    const name = take(lines[0] ?? '', CONCEPT_WORDS)
    if (lines.length < 2 || names.has(name.toLowerCase())) return []
    names.add(name.toLowerCase())
    const facts = lines.slice(1, 1 + FACTS).map((text) => ({ text, slide }))
    return [{ name, core: i % 2 === 0, facts }]
  })
  const topics = []
  for (let i = 0; i < concepts.length; i += SLIDES_PER_TOPIC) {
    const group = concepts.slice(i, i + SLIDES_PER_TOPIC)
    topics.push({ name: group[0]!.name, concepts: group })
  }
  return { title: take(slides[0]?.lines[0] ?? 'Lecture', 4).slice(0, 32), topics }
}

/** Fills the form of a definition or a term card; other forms get the fact in every field. */
function fill(request: ModelRequest): Record<string, unknown> {
  const concept = /^Concept: (.+)$/m.exec(request.prompt)?.[1] ?? ''
  const fact = take(/^Fact to test: (.+) \(slide \d+\)$/m.exec(request.prompt)?.[1] ?? '', 20)
  const words = fact.split(' ')
  const keyFrom = Math.max(0, words.length - 2)
  const fields = Object.keys(request.schema.properties ?? {})
  if (fields.includes('answer')) {
    return {
      question: `${concept}: how does the statement beginning "${take(fact, 3)}" go on?`,
      answer: `${words.slice(0, keyFrom).join(' ')} ==${words.slice(keyFrom).join(' ')}==`.trim(),
      extra: '',
    }
  }
  if (fields.includes('term')) {
    return {
      question: `Which concept does this describe: ${take(fact, 12)}?`,
      term: concept,
      extra: '',
    }
  }
  return Object.fromEntries(fields.map((field) => [field, field === 'extra' ? '' : take(fact, 4)]))
}

const free = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: 0 }
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** `delayMs` makes every call take that long, so a run can be watched. */
export function offlineModel(delayMs = 0): ModelPort {
  return {
    model: 'offline',
    price: { input: 0, cachedInput: 0, output: 0 },
    async complete(request) {
      await wait(delayMs)
      const data =
        request.task === 'map'
          ? map(request.context)
          : request.task === 'split'
            ? { cards: [fill(request)] }
            : fill(request)
      return { data, usage: free }
    },
  }
}

function decide(question: Question): Answer {
  if (question.type === 'predicate') {
    // Sure that concepts belong and slides support their cards, sure that no two things are the same.
    return {
      type: 'predicate',
      probability: /are the same concept|test the same thing/.test(question.statement) ? 0.1 : 0.9,
    }
  }
  const slide = /^What kind of slide is slide (\d+)\?/.exec(question.ask)?.[1]
  const choice = slide
    ? slide === '1'
      ? 'title'
      : 'content'
    : question.choices.includes('concept')
      ? 'concept'
      : 'definition'
  return { type: 'choice', choice, confidence: 0.9 }
}

export function offlineDecisions(delayMs = 0): DecisionsPort {
  return {
    model: 'offline',
    price: { input: 0 },
    async decide(request) {
      await wait(delayMs)
      return { answers: request.questions.map(decide), usage: free }
    },
  }
}
