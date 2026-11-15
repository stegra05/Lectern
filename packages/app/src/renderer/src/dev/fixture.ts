/**
 * A stand-in for the shell when the interface runs in a plain browser, for design work only.
 * It is never part of the app: `main.tsx` loads it only in a dev build without `window.lectern`.
 *
 * The page's hash picks a scenario: #first-run, #courses, #empty, #setup, #run, #failed,
 * #result, #lecture, #topic, #concept, #large, #details, #stats, #settings.
 *
 * Sending to Anki: #choice (the card designs before the first send), #sending, #no-anki,
 * #sent (all of the course in Anki) and #added (the last two lectures not sent yet).
 *
 * The card form: #edit (a definition), #edit-contrast, #edit-problem (what the engine refused),
 * #write (a card of the student's own) and #write-gap.
 *
 * The real course of `dev/real.ts`, with its long titles and dense lectures: #real (the track),
 * #real-details, #dense (lecture 02, 16 concepts, one selected) and #huge (lecture 01, 51
 * concepts). Any scenario ending in -closed closes the side panel at the end, as #dense-closed.
 */

import type {
  Bridge,
  Card,
  Command,
  Concept,
  CourseView,
  Design,
  Event,
  Lecture,
  Settings,
  Slots,
} from '../../../shared/contract.ts'
import { useStore } from '../store.ts'
import { REAL_CARDS, REAL_SLIDES, REAL_TITLES, REAL_TOPICS } from './real.ts'

const TITLES = [
  'What and who',
  'Effectuation',
  'Opportunity recognition',
  'Business model',
  'Lean startup',
  'Entrepreneurial marketing',
  'Financing',
  'Teams',
  'Growth',
  'Legal forms and IP',
  'Corporate entrepreneurship',
]
const SLIDES = [38, 46, 41, 44, 58, 39, 47, 33, 52, 43, 31]

const two = (n: number) => String(n).padStart(2, '0')
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

function qa(
  lecture: number,
  concept: Concept,
  n: number,
  role: string,
  front: string,
  back: string,
  slide: number,
  more: Record<string, string> = {},
): Card {
  return {
    id: `${two(lecture)}-${concept.id}-${role}-${n}`,
    note: 'qa',
    concept: concept.id,
    slide,
    fields: {
      Front: front,
      Back: back,
      Role: role,
      Slots: '',
      Code: '',
      Typed: '',
      Lecture: two(lecture),
      Topic: TITLES[lecture - 1]!,
      Source: `Lecture ${lecture}, slide ${slide}`,
      Asked: '',
      Part: '',
      Extra: '',
      Excerpt: 'Risk: the distribution of outcomes is known. Uncertainty: it is not.',
      Slide: `<img src="l${two(lecture)}-s${slide}.png">`,
      Diagram: '',
      Key: concept.name,
      ...more,
    },
  }
}

function concept(name: string, slides: number[]): Concept {
  return {
    id: slug(name),
    name,
    slides,
    // Counted once the lecture's cards exist, see `counted`.
    cards: 0,
    facts: slides.map((slide) => ({
      text: `${name}, as slide ${slide} states it`,
      slide,
      kind: 'definition',
    })),
  }
}

/** Lecture 02 as the canvas draws it: three topics, seven concepts. */
function effectuation(): Lecture {
  const knight = concept('Knight: risk vs uncertainty', [14, 15, 16])
  const causation = concept('Causation vs effectuation', [17, 18, 19])
  const bird = concept('Bird in hand', [21, 22])
  const loss = concept('Affordable loss', [23, 24])
  const quilt = concept('Crazy quilt', [25, 26])
  const lemonade = concept('Lemonade', [27, 28])
  const pilot = concept('Pilot in the plane', [29, 30])
  const cards: Card[] = [
    qa(
      2,
      knight,
      1,
      'definition',
      'Knight (1921): what is risk?',
      'An outcome whose <mark>probability can be calculated or known</mark>, e.g. opening a hairdresser shop.',
      14,
      { Extra: 'Knight sets risk against uncertainty, where the probabilities cannot be known.' },
    ),
    qa(
      2,
      knight,
      2,
      'definition',
      'Knight (1921): what is uncertainty?',
      'An outcome whose <mark>probability cannot be known</mark>, because the future is not yet formed.',
      14,
    ),
    qa(
      2,
      knight,
      3,
      'contrast',
      'Risk versus uncertainty: what can you know about the outcomes?',
      '<ul><li><mark>probabilities known</mark></li><li><mark>probabilities unknowable</mark></li></ul>',
      15,
      { Slots: '<span>Risk</span><span>Uncertainty</span>' },
    ),
    qa(
      2,
      knight,
      4,
      'case',
      'A new product for a market that does not exist yet: risk or uncertainty?',
      '<mark>Uncertainty</mark>',
      15,
      { Typed: 'uncertainty' },
    ),
    qa(
      2,
      knight,
      5,
      'reverse',
      'Which kind of situation can you plan with expected values?',
      '<mark>Risk</mark>',
      16,
      { Typed: 'risk' },
    ),
    {
      id: '02-knight-risk-vs-uncertainty-cloze-6',
      note: 'cloze',
      concept: knight.id,
      slide: 16,
      fields: {
        Text: 'Under {{c1::uncertainty}}, prediction fails, so the entrepreneur relies on {{c2::control}}.',
        Role: 'cloze',
        Typed: 'on',
        Lecture: '02',
        Topic: 'Effectuation',
        Source: 'Lecture 2, slide 16',
        Asked: '',
        Part: '',
        Extra: '',
        Excerpt: 'To the extent we can control the future, we do not need to predict it.',
        Slide: '<img src="l02-s16.png">',
        Diagram: '',
        Key: knight.name,
      },
    },
    ...fill(2, causation, 9),
    ...fill(2, bird, 8),
    ...fill(2, loss, 8),
    ...fill(2, quilt, 7),
    ...fill(2, lemonade, 7),
    ...fill(2, pilot, 7),
  ]
  return {
    number: 2,
    title: 'Effectuation',
    file: '02_Effectuation.pdf',
    slides: 46,
    sent: 0,
    inAnki: [],
    topics: [
      { name: 'Deciding under uncertainty', concepts: [knight, causation] },
      { name: 'Start with what you have', concepts: [bird, loss, quilt] },
      { name: 'Shape the future', concepts: [lemonade, pilot] },
    ],
    leftOut: [
      { slide: 1, reason: 'title' },
      { slide: 2, reason: 'agenda' },
      { slide: 3, reason: 'recap' },
      { slide: 46, reason: 'reading list' },
    ],
    dropped: [
      {
        concept: 'Crazy quilt',
        role: 'why',
        front: 'Why do effectual entrepreneurs seek commitments from partners early?',
        problems: ['answer has 31 words; the limit is 25'],
      },
    ],
    cards,
  }
}

/** Writes the number of cards onto each concept, as the engine does. */
function counted(lecture: Lecture): Lecture {
  for (const topic of lecture.topics) {
    for (const c of topic.concepts) {
      c.cards = lecture.cards.filter((card) => card.concept === c.id).length
    }
  }
  return lecture
}

const ROLES = ['definition', 'contrast', 'name-two', 'case', 'reverse', 'chain', 'why']

/** Plain sample cards for a concept. */
function fill(lecture: number, c: Concept, count: number): Card[] {
  return Array.from({ length: count }, (_, i) => {
    const role = ROLES[i % ROLES.length]!
    const slide = c.slides[i % c.slides.length]!
    if (role === 'contrast' || role === 'name-two' || role === 'why' || role === 'chain') {
      return qa(
        lecture,
        c,
        i + 1,
        role,
        `${c.name}: which two points matter here?`,
        '<ul><li><mark>the first point</mark> in a few words</li><li><mark>the second point</mark> in a few words</li></ul>',
        slide,
        role === 'contrast' ? { Slots: '<span>One side</span><span>Other side</span>' } : {},
      )
    }
    if (role === 'case' || role === 'reverse') {
      return qa(
        lecture,
        c,
        i + 1,
        role,
        `Which concept describes this situation from the lecture?`,
        `<mark>${c.name}</mark>`,
        slide,
      )
    }
    return qa(
      lecture,
      c,
      i + 1,
      role,
      `What is meant by ${c.name.toLowerCase()}?`,
      `A short answer that names <mark>the key term</mark> and one example.`,
      slide,
    )
  })
}

/** A lecture with made-up topics and concepts that add up to the given number of cards. */
function sample(number: number, cards: number, topics: number, concepts: number): Lecture {
  const title = TITLES[number - 1]!
  const all = Array.from({ length: concepts }, (_, i) =>
    concept(`${title} concept ${i + 1}`, [5 + i * 2, 6 + i * 2]),
  )
  const per = Math.floor(cards / concepts)
  const made = all.flatMap((c, i) => fill(number, c, i === 0 ? cards - per * (concepts - 1) : per))
  return {
    number,
    title,
    file: `${two(number)}_${title.replace(/ /g, '_')}.pdf`,
    slides: SLIDES[number - 1]!,
    sent: 0,
    inAnki: [],
    topics: Array.from({ length: topics }, (_, t) => ({
      name: `${title}, part ${t + 1}`,
      concepts: all.filter((_, i) => i % topics === t),
    })),
    leftOut: [
      { slide: 1, reason: 'title' },
      { slide: 2, reason: 'agenda' },
    ],
    dropped: [],
    cards: made,
  }
}

const CARDS = [32, 52, 38, 44, 54, 34, 44, 30, 18, 40, 26]
const TOPICS = [3, 3, 3, 3, 4, 2, 3, 2, 2, 3, 2]

function built(): CourseView {
  const lectures = TITLES.map((_, i) =>
    counted(
      i === 1
        ? effectuation()
        : sample(i + 1, CARDS[i]!, TOPICS[i]!, i === 4 ? 12 : TOPICS[i]! * 2),
    ),
  )
  return {
    id: 'entrepreneurship',
    name: 'Entrepreneurship',
    goal: 'top',
    lectures,
    pending: [],
    exams: [],
    decisions: [
      {
        lecture: null,
        kind: 'goal',
        text: 'Goal "top grade": the facts worth most get a card, at most 1.8 per slide.',
      },
      {
        lecture: 5,
        kind: 'recurring',
        text: 'Lean startup got the most cards, 54: the most slides, six methods to apply.',
      },
      {
        lecture: 2,
        kind: 'no-card',
        text: 'The five effectual principles get a list card, so you recall them in order.',
      },
      {
        lecture: 9,
        kind: 'left-out',
        text: "No cards for the guest lecture in 09 Growth: one company's story, no new concept.",
      },
      {
        lecture: 2,
        kind: 'dropped',
        text: 'One card in 02 Effectuation was left out: its answer stayed too long after two rewrites.',
      },
    ],
    runs: [
      {
        run: 1,
        startedAt: '2026-11-14T09:12:00.000Z',
        model: 'gpt-6-luna',
        decisionModel: 'gpt-6-luna',
        preset: 'placeholder',
        calls: 430,
        decisions: 2100,
        inputTokens: 3_100_000,
        cachedInputTokens: 2_400_000,
        outputTokens: 210_000,
        phaseMs: { read: 9_000, map: 190_000, write: 610_000, check: 81_000 },
        goal: 'top',
        lectures: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        cards: 412,
        dropped: 1,
        estimateUsd: 0.38,
        costUsd: 0.41,
        durationMs: 890_000,
      },
    ],
  }
}

/** A lecture of the real course from its topics, concepts and card counts. */
function realLecture(
  number: number,
  title: string,
  topics: [string, [string, number][]][],
): Lecture {
  let slide = 2
  const made = topics.map(([name, concepts]) => ({
    name,
    concepts: concepts.map(([c, n]) => ({ concept: concept(c, [slide++]), cards: n })),
  }))
  return {
    number,
    title,
    file: `${two(number)}_${title.replace(/ /g, '_')}.pdf`,
    slides: REAL_SLIDES[number - 1]!,
    sent: 0,
    inAnki: [],
    topics: made.map((t) => ({ name: t.name, concepts: t.concepts.map((c) => c.concept) })),
    leftOut: [],
    dropped: [],
    cards: made.flatMap((t) => t.concepts.flatMap((c) => fill(number, c.concept, c.cards))),
  }
}

/** The real course: its titles and card counts, and the real topics of lectures 01 and 02. */
function real(): CourseView {
  const lectures = REAL_TITLES.map((title, i) => {
    const topics = REAL_TOPICS[i + 1]
    if (topics) return counted(realLecture(i + 1, title, topics))
    return counted({ ...sample(i + 1, REAL_CARDS[i]!, 4, 12), title, slides: REAL_SLIDES[i]! })
  })
  return { ...built(), lectures }
}

function waiting(): CourseView {
  return {
    id: 'entrepreneurship',
    name: 'Entrepreneurship',
    goal: 'good',
    lectures: [],
    pending: TITLES.map((title, i) => ({
      number: i + 1,
      file: `${two(i + 1)}_${title.replace(/ /g, '_')}.pdf`,
      title,
      slides: SLIDES[i]!,
    })),
    exams: [
      { file: 'Exam Winter 2024-25.pdf', questions: null },
      { file: 'Exam Summer 2025.pdf', questions: null },
    ],
    decisions: [],
    runs: [],
  }
}

const empty = (): CourseView => ({
  id: 'analysis-2',
  name: 'Analysis 2',
  goal: 'good',
  lectures: [],
  pending: [],
  exams: [],
  decisions: [],
  runs: [],
})

const LIMITS = { front: 20, answer: 25, extra: 40, gapSentence: 45 }

const text = (html: string) => html.replace(/<[^>]+>/g, '')

/** A rough stand-in for the engine's reading of a card into slots. Enough for a picture. */
function slotsOf(card: Card): Slots {
  const f = card.fields
  const items = [...(f.Back ?? '').matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]!)
  const answers = (items.length > 0 ? items : [f.Back ?? '']).map((html) => ({
    text: text(html),
    key: /<mark>(.*?)<\/mark>/.exec(html)?.[1] ?? '',
  }))
  return {
    role: (f.Role ?? 'definition') as Slots['role'],
    front: text(f.Front ?? ''),
    answers,
    labels: [...(f.Slots ?? '').matchAll(/<span>(.+?)<\/span>/g)].map((m) => m[1]!),
    hidden: [],
    extra: text(f.Extra ?? ''),
    code: f.Code ?? '',
  }
}

const blank = (role: 'definition' | 'cloze' = 'definition'): Slots => ({
  role,
  front: '',
  answers: role === 'definition' ? [{ text: '', key: '' }] : [],
  labels: [],
  hidden: [],
  extra: '',
  code: '',
})

export function installFixture(): void {
  const hash = location.hash.replace('#', '') || 'result'
  const scenario = hash.replace(/-closed$/, '')
  const settings: Settings = {
    provider: 'openai',
    hasKey: scenario !== 'first-run',
    design: 'native',
    designChosen: scenario !== 'choice',
  }
  let course =
    scenario === 'empty'
      ? empty()
      : ['setup', 'run', 'failed'].includes(scenario)
        ? waiting()
        : ['real', 'real-details', 'dense', 'huge'].includes(scenario)
          ? real()
          : built()
  // How much of the course is in Anki: all of it, or all but the last two lectures.
  if (scenario === 'sent' || scenario === 'added') {
    const upTo = scenario === 'sent' ? course.lectures.length : course.lectures.length - 2
    course = {
      ...course,
      lectures: course.lectures.map((l, i) => ({
        ...l,
        sent: i < upTo ? l.cards.length : 0,
        inAnki: i < upTo ? l.cards.map((card) => card.id) : [],
      })),
    }
  }

  const answer = (command: Command, emit: (event: Event) => void): Promise<void> => {
    switch (command.type) {
      case 'courses':
        emit({
          type: 'courses',
          courses: [
            {
              id: 'entrepreneurship',
              name: 'Entrepreneurship',
              goal: 'top',
              built: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
              pending: [],
              cards: 412,
            },
            {
              id: 'analysis-2',
              name: 'Analysis 2',
              goal: 'good',
              built: [1, 2, 3, 4, 5],
              pending: [6],
              cards: 214,
            },
            {
              id: 'physiology',
              name: 'Human Physiology',
              goal: 'good',
              built: [],
              pending: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
              cards: 0,
            },
          ],
        })
        break
      case 'create':
        course = { ...empty(), name: command.name, id: slug(command.name) }
        emit({ type: 'created', course: course.id })
        break
      case 'add':
        course = { ...waiting(), name: course.name, id: course.id }
        emit({ type: 'added', course: course.id, files: command.files.map((f) => f.name) })
        break
      case 'course':
        emit({
          type: 'course',
          course: {
            ...course,
            lectures: course.lectures.map((l) => {
              const { inAnki, ...rest } = l
              return { ...rest, sent: inAnki.length, cards: l.cards.length }
            }),
          },
        })
        break
      case 'cards':
        emit({
          type: 'cards',
          lecture: command.lecture,
          cards: course.lectures.find((l) => l.number === command.lecture)?.cards ?? [],
          sent: course.lectures.find((l) => l.number === command.lecture)?.inAnki ?? [],
        })
        break
      case 'slots': {
        const card = course.lectures.flatMap((l) => l.cards).find((c) => c.id === command.card)
        emit({ type: 'slots', slots: card ? slotsOf(card) : blank(command.role), limits: LIMITS })
        break
      }
      case 'edit':
      case 'write':
        // The form of the picture stays open with what the engine would say.
        emit({
          type: 'refused',
          problems: [
            { field: 'front', message: 'It has 23 words. The limit is 20.' },
            { field: 'key', message: 'The key term must be a part of the answer, word for word.' },
          ],
        })
        break
      case 'remove':
        emit({ type: 'removed', card: command.card })
        break
      case 'estimate': {
        const cards = { pass: 150, good: 280, top: 410 }[command.goal ?? 'good']
        emit({
          type: 'estimate',
          lectures: 11,
          slides: 472,
          cards,
          costUsd: cards / 1000,
          // As the engine rounds it: up to the next 5 cents, in euros.
          costEur: Math.ceil((cards / 1000) * 0.9 * 20 - 1e-9) / 20,
          capUsd: (cards / 1000) * 3,
        })
        break
      }
      case 'build':
        emit({
          type: 'estimate',
          lectures: 11,
          slides: 472,
          cards: 410,
          costUsd: 0.41,
          costEur: 0.4,
          capUsd: 1.23,
        })
        emit({ type: 'phase', phase: 'read', status: 'started', total: 11 })
        emit({ type: 'phase', phase: 'read', status: 'done', total: 11 })
        emit({ type: 'phase', phase: 'map', status: 'started', total: 11 })
        if (scenario === 'failed') {
          emit({
            type: 'failed',
            message: 'OpenAI did not accept the key.',
            fix: 'Open Settings, paste the key again, then make your cards once more.',
          })
          break
        }
        emit({ type: 'phase', phase: 'map', status: 'done', total: 11 })
        emit({ type: 'phase', phase: 'write', status: 'started', total: 410 })
        emit({ type: 'progress', phase: 'write', done: 187, total: 410, lecture: 5 })
        // Stays midway for the picture.
        return new Promise(() => {})
      case 'outline':
        emit({
          type: 'outline',
          markdown:
            '# Entrepreneurship\n\n## 02 Effectuation\n\n### Deciding under uncertainty\n\n#### Knight: risk vs uncertainty\n\n- Q: Knight (1921): what is risk?\n  A: An outcome whose probability can be calculated or known.\n',
        })
        break
      case 'slide':
        emit({
          type: 'failed',
          message: 'There is no slide picture in the fixture.',
          fix: 'Run the app.',
        })
        break
      case 'send':
        if (scenario === 'no-anki') {
          emit({
            type: 'failed',
            message: 'Anki is not open.',
            fix: 'Open Anki and wait until you see your decks, then try again. If Anki is open, restart it once so the AnkiConnect add-on starts.',
          })
          break
        }
        emit({ type: 'sending', lecture: 4, done: 139, total: 412 })
        // Stays midway for the picture.
        return new Promise(() => {})
      case 'restyle':
        emit({ type: 'restyled', noteTypes: [] })
        break
    }
    return Promise.resolve()
  }

  const bridge: Bridge = {
    run: answer,
    settings: () => Promise.resolve({ ...settings }),
    setDesign: (design: Design) => {
      settings.design = design
      return Promise.resolve({ ...settings })
    },
    saveKey: (key) => {
      if (!key.startsWith('sk-')) {
        return Promise.resolve({
          ok: false,
          message: 'OpenAI did not accept this key.',
          fix: 'Copy the whole key from platform.openai.com, it starts with sk-.',
        })
      }
      settings.hasKey = true
      return Promise.resolve({ ok: true })
    },
    platform: 'darwin',
  }
  window.lectern = bridge

  // Walk the store to the scenario once the app has started.
  const store = useStore
  const unsubscribe = store.subscribe((state) => {
    if (state.screen !== 'courses') return
    unsubscribe()
    void (async () => {
      const s = store.getState()
      if (scenario === 'courses' || scenario === 'first-run') return
      await s.openCourse(course.id)
      if (scenario === 'run' || scenario === 'failed') void store.getState().build()
      if (['choice', 'sending', 'no-anki'].includes(scenario)) void store.getState().send()
      if (scenario === 'lecture') store.getState().openLecture(2)
      if (scenario === 'topic') {
        store.getState().openLecture(2)
        store.getState().selectTopic('Start with what you have')
      }
      if (scenario === 'concept') {
        store.getState().openLecture(2)
        store.getState().selectConcept('knight-risk-vs-uncertainty')
      }
      if (scenario.startsWith('edit') || scenario.startsWith('write')) {
        store.getState().openLecture(2)
        store.getState().selectConcept('knight-risk-vs-uncertainty')
        const cards = store.getState().course!.lectures[1]!.cards
        const role = scenario === 'edit-contrast' ? 'contrast' : 'definition'
        if (scenario.startsWith('edit')) {
          await store.getState().editCard(cards.find((card) => card.fields.Role === role)!)
        } else {
          await store.getState().writeCard('knight-risk-vs-uncertainty')
        }
        if (scenario === 'write-gap') await store.getState().setEditorKind('cloze')
        if (scenario === 'edit-problem') await store.getState().saveCard()
      }
      if (scenario === 'large') store.getState().openLecture(5)
      if (scenario === 'details') store.getState().openDetails('decisions')
      if (scenario === 'stats') store.getState().openDetails('statistics')
      if (scenario === 'settings') store.getState().openSettings()
      if (scenario === 'real-details') store.getState().openDetails('decisions')
      if (scenario === 'dense') {
        store.getState().openLecture(2)
        store.getState().selectConcept('alex-krapp-case')
      }
      if (scenario === 'huge') store.getState().openLecture(1)
      if (hash.endsWith('-closed')) store.getState().closePanel()
    })()
  })
}
