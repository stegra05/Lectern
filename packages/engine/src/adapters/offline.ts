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

/** One slide: its heading is the concept, each line under it a fact. A title slide gives none. */
function read(request: ModelRequest): unknown {
  const slide = Number(/^Read slide (\d+) /.exec(request.prompt)![1])
  const lines = (/^Its text: (.*)$/m.exec(request.prompt)?.[1] ?? '').split(' / ').filter(Boolean)
  if (slide === 1 || lines.length < 2) return { facts: [] }
  const concept = take(lines[0]!, CONCEPT_WORDS)
  return { facts: lines.slice(1, 1 + FACTS).map((text) => ({ concept, text, items: 0 })) }
}

/** The facts under the concept the reading named, three concepts to a topic. */
function group(request: ModelRequest): unknown {
  const facts = [...request.prompt.matchAll(/^(F\d+) \(slide \d+\) ([^:]+): /gm)]
  const concepts: { name: string; facts: string[] }[] = []
  for (const [, id, name] of facts) {
    const known = concepts.find((c) => c.name === name)
    if (known) known.facts.push(id!)
    else concepts.push({ name: name!, facts: [id!] })
  }
  const topics = []
  for (let i = 0; i < concepts.length; i += SLIDES_PER_TOPIC) {
    const part = concepts.slice(i, i + SLIDES_PER_TOPIC)
    topics.push({ name: part[0]!.name, concepts: part })
  }
  const first = /^\[1\] (.*)$/m.exec(request.context)?.[1]?.split(' / ')[0] ?? 'Lecture'
  return { title: take(first, 4).slice(0, 32), topics, repeats: [] }
}

/** A past paper: every line that ends in a question mark is a question. */
function questions(context: string): unknown {
  const lines = context.split(/\n| \/ /).map((l) => l.trim())
  const asked = lines.filter((l) => l.endsWith('?'))
  return { questions: asked.map((text, i) => ({ number: String(i + 1), text })) }
}

/** Every question a family of its own, in the first lecture, about its first concept. */
function families(prompt: string): unknown {
  const asked = [...prompt.matchAll(/^(Q\d+) \([^)]*\) (.+)$/gm)]
  const lecture = /^Lecture (\d+) [^:]*: ([^;\n]*)/m.exec(prompt)
  return {
    families: asked.map(([, id, text]) => ({
      question: text!,
      members: [id!],
      lecture: Number(lecture?.[1] ?? 1),
      concept: lecture?.[2] ?? 'Exam',
    })),
  }
}

/** The question itself, turned into a statement the slides do not hold. */
function answer(prompt: string): unknown {
  const question = prompt.split('\n')[1] ?? ''
  return {
    answer: `Past exams asked: ${question.replace(/\?$/, '.')}`,
    items: 0,
    slide: 0,
    fromSlides: false,
  }
}

/** Fills the form of a definition or a term card; other forms get the fact in every field. */
function fill(request: ModelRequest): Record<string, unknown> {
  const concept = /^Concept: (.+)$/m.exec(request.prompt)?.[1] ?? ''
  const fact = take(/^Fact to test: (.+) \(slide \d+\)$/m.exec(request.prompt)?.[1] ?? '', 20)
  const words = fact.split(' ')
  const keyFrom = Math.max(0, words.length - 2)
  const fields = Object.keys(request.schema.properties ?? {})
  if (fields.includes('answer')) {
    // Quoting the start of a fact of a few words would give the whole answer away.
    const asks =
      words.length > 4
        ? `how does the statement beginning "${take(fact, 3)}" go on?`
        : `which point starts with the letter "${fact.charAt(0).toUpperCase()}"?`
    return {
      question: `${concept}: ${asks}`,
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
      const data = request.context.startsWith('Exam paper:')
        ? questions(request.context)
        : request.prompt.includes('Sort the questions into families')
          ? families(request.prompt)
          : request.prompt.startsWith('A question past exams')
            ? answer(request.prompt)
            : request.task === 'read'
              ? read(request)
              : request.task === 'map'
                ? group(request)
                : request.task === 'split'
                  ? { cards: [fill(request)] }
                  : fill(request)
      request.onUsage(free)
      return data
    },
  }
}

function decide(question: Question, context: string): Answer {
  // Every fact is examinable, some a little more: the sum of its letters decides, so the same
  // slides always give the same cards.
  if (question.type === 'score') {
    const sum = [...context].reduce((total, letter) => total + letter.charCodeAt(0), 0)
    return { type: 'score', score: 1.5 + (sum % 10) / 10 }
  }
  // Sure that no card is about the organisation of the course.
  if (question.type === 'predicate') return { type: 'predicate', probability: 0.1 }
  return { type: 'choice', choice: 'definition' }
}

export function offlineDecisions(delayMs = 0): DecisionsPort {
  return {
    model: 'offline',
    price: { input: 0 },
    async decide(request) {
      await wait(delayMs)
      request.onUsage(free)
      return request.questions.map((question) => decide(question, request.context))
    },
  }
}
