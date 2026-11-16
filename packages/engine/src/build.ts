/**
 * The build command. Four phases, as the run screen shows them, carrying the steps of how
 * cards are created:
 *
 *   read   text and pictures of the slides
 *   map    every slide read on its own, its facts sorted into topics and concepts, the kind
 *          and worth of each fact, the past exam questions and the plan
 *   write  one form per planned card
 *   check  the gate with repair and split, then clashes with every card of the course
 *
 * Read and map run over all new lectures at once: the plan shares the goal's cards out over
 * the whole build. Write and check then run lecture by lecture, and each lecture is saved as
 * soon as it is through, so a stopped run keeps what it finished. A lecture counts as built
 * once `course.json` lists it, which is written last. Only lectures that are not in
 * `course.json` yet are built, and files of earlier lectures are never touched.
 */

import type { BuildCommand, Emit, EstimateCommand, Event } from './commands.ts'
import { createAsk, type AskModel, type Decide, type Meter } from './ask.ts'
import { assemble, type CardFile } from './cards/assemble.ts'
import { cardId } from './cards/id.ts'
import { questionAndAnswer } from './cards/question-answer.ts'
import { GOAL_PRESETS, type Draft, type Goal, type Role } from './cards/roles.ts'
import { leansOnSlides, saysNothing, tooLong, validateDraft } from './cards/validate.ts'
import { htmlToText, slideRange, slug, two } from './cards/words.ts'
import { findClashes } from './clash.ts'
import { estimate, LOW_TEXT_CHARS, shownEuros } from './cost.ts'
import {
  assignNumbers,
  inCourseOrder,
  paths,
  readCards,
  readJson,
  titleFromFile,
  writeCards,
  writeJson,
  type Concept,
  type CourseFile,
  type Decision,
  type Dropped,
  type Fact,
  type Lecture,
  type Run,
} from './course.ts'
import {
  ask,
  cardInput,
  chosen,
  FACT_KINDS,
  factInput,
  ORGANISATION_THRESHOLD,
  probability,
  score,
} from './decide.ts'
import { EngineError } from './errors.ts'
import {
  askAnswer,
  askFamilies,
  askQuestions,
  type Answer,
  type ExamsFile,
  type Family,
} from './exams.ts'
import { askGroups, askSlide, factId, slidesBlock } from './mapper.ts'
import { budget, plan } from './plan.ts'
import { MAX_DECISION_IMAGES, type Ports, type SlideImage } from './ports.ts'
import { CONCEPT as preset } from './presets.ts'
import { slideText } from './slides.ts'
import { fromGroups, settleMap } from './tree.ts'
import { createWriter, type CardJob, type Slots, type Writer } from './writer.ts'

/** How often a rejected card is filled again before it is dropped. */
const REPAIRS = 2
/** A card that is too long becomes at most this many atomic cards. */
const SPLIT_INTO = 3
/** Model calls that run at the same time in the write and check phases. */
const PARALLEL = 4
/** Why a card about the lecturer, dates or grading is dropped. No wording repairs such a fact. */
const ORGANISATION = 'is about the organisation of the course, not its subject'

type Phase = 'read' | 'map' | 'write' | 'check'

/** A new lecture after reading: its text and its pictures, nothing judged yet. */
interface ReadLecture {
  number: number
  file: string
  sha256: string
  text: string[][]
  /** Every slide as a picture, for reading each slide on its own. */
  pictures: SlideImage[]
  /** The pictures of the slides with little text: the model sees these with every request. */
  images: SlideImage[]
}

/** A new lecture on its way through the build. */
interface OpenLecture extends Lecture, ReadLecture {
  /** The whole lecture as every card writer call sees it. */
  context: string
  beyondGoal: Concept[]
}

/** One card on its way through the gate. Its identity is fixed, its wording may change. */
interface Item {
  id: string
  /** Position in the plan; the parts of a split card follow their parent. */
  order: number
  lecture: OpenLecture
  concept: Concept
  fact: Fact
  role: Role
  slots: Slots
  /** A part of a split card. It is never split again. */
  part: boolean
  problems: string[]
  card?: CardFile
}

/** Concepts the course knows, by id: the one name it uses and the lecture that introduced it. */
type Vocabulary = Map<string, { name: string; lecture: number }>

/** One planned card: this fact of this concept of this lecture, as this card type. */
interface Planned {
  lecture: OpenLecture
  concept: Concept
  fact: Fact
  role: Role
}

/** The id of the next card of this concept and card type in this lecture. */
type NextId = (lecture: OpenLecture, concept: Concept, role: Role) => string

/** Cards after the checks, in the order of the plan, and the cards dropped on the way. */
interface Checked {
  accepted: Item[]
  dropped: Item[]
}

/** The course as this build leaves it, saved again each time a lecture is finished. */
interface Saved {
  file: CourseFile
  decisions: Decision[]
  /** Every card of the course, for the clash check of the next lecture. */
  cards: { id: string; card: CardFile }[]
}

/** A past paper not read before: its name and its pages. */
interface Paper {
  name: string
  pages: string[][]
}

/** The past papers as the course keeps them, and what this build made of them. */
interface Exams {
  file: ExamsFile
  tally: { questions: number; papers: number; families: number; fromSlides: number }
}

type BuiltLecture = Extract<Event, { type: 'built' }>['lectures'][number]

/** What every step of a build works with. */
interface Build {
  ports: Ports
  emit: Emit
  course: string
  model: AskModel
  decide: Decide
  writer: Writer
}

/** What both `estimate` and `build` need first: the course, its new lectures, the estimate. */
async function survey(ports: Ports, command: BuildCommand | EstimateCommand) {
  const { store } = ports
  const course = command.course
  const existing = await readJson<CourseFile>(store, paths.course(course))
  const goal: Goal = command.goal ?? existing?.goal ?? 'good'

  const files = inCourseOrder(await store.list(paths.slides(course)))
  if (files.length === 0) {
    throw new EngineError(
      `No PDF found in ${paths.slides(course)}.`,
      'Put one PDF per lecture into the slides folder of the course.',
    )
  }
  const known = new Set(existing?.lectures.map((l) => l.file))
  const fresh = files.filter((f) => !known.has(f))
  const numbers = assignNumbers(existing?.lectures.map((l) => l.number) ?? [], fresh)

  const lectures: ReadLecture[] = []
  for (const [i, file] of fresh.entries()) {
    const bytes = await store.readBytes(`${paths.slides(course)}/${file}`)
    const text = await slideText(ports.pdf, bytes)
    const pictures = await ports.pdf.renderSlides(
      bytes,
      text.map((_, s) => s + 1),
    )
    // Slides with little text are figures, formulas or scans: the model gets to see them.
    const images = pictures.filter((_, s) => text[s]!.join(' ').length < LOW_TEXT_CHARS)
    lectures.push({
      number: numbers[i]!,
      file,
      sha256: await sha256(bytes),
      text,
      pictures,
      images,
    })
  }
  const sizes = lectures.map((l) => ({
    chars: l.text.flat().join(' ').length,
    slides: l.text.length,
    images: l.images.length,
  }))
  // Past papers not read before. Only these are asked about: the questions of older papers
  // already have their cards.
  const read = (await readJson<ExamsFile>(store, paths.examsFile(course)))?.papers ?? []
  const names = (await store.list(paths.exams(course)))
    .filter((name) => /\.pdf$/i.test(name) && !read.some((p) => p.file === name))
    .sort()
  const papers = await Promise.all(
    names.map(async (name) => ({
      name,
      pages: await ports.pdf.readSlides(await store.readBytes(`${paths.exams(course)}/${name}`)),
    })),
  )
  const prices = { model: ports.model.price, decisions: ports.decisions.price }
  // Questions are placed in the lectures of this build, so without new lectures none are asked.
  const exams = {
    papers: lectures.length > 0 ? papers.length : 0,
    chars: papers.reduce((sum, paper) => sum + paper.pages.flat().join(' ').length, 0),
  }
  return {
    course,
    existing,
    goal,
    lectures,
    papers,
    estimate: estimate(sizes, goal, prices, exams),
  }
}

export async function estimateCourse(
  ports: Ports,
  command: EstimateCommand,
  emit: Emit,
): Promise<void> {
  emit({ type: 'estimate', ...(await survey(ports, command)).estimate })
}

export async function build(ports: Ports, command: BuildCommand, emit: Emit): Promise<void> {
  const { store } = ports
  const startedAt = ports.now()
  const phaseMs = { read: 0, map: 0, write: 0, check: 0 }
  const phase = async <T>(name: Phase, total: number, work: () => Promise<T>): Promise<T> => {
    emit({ type: 'phase', phase: name, status: 'started', total })
    const result = await timed(name, work)
    emit({ type: 'phase', phase: name, status: 'done', total })
    return result
  }
  /** Adds the time `work` takes to the phase: write and check run once per lecture. */
  const timed = async <T>(name: Phase, work: () => Promise<T>): Promise<T> => {
    const start = ports.now()
    const result = await work()
    phaseMs[name] += ports.now() - start
    return result
  }

  const meter: Meter = {
    calls: 0,
    decisions: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  }

  // Read all lectures. The estimate is known before the first paid call.
  emit({ type: 'phase', phase: 'read', status: 'started', total: 0 })
  const readStart = ports.now()
  const {
    course,
    existing,
    goal,
    lectures: read,
    papers: freshPapers,
    estimate: estimated,
  } = await survey(ports, command)
  if (read.length === 0) {
    emit({ type: 'phase', phase: 'read', status: 'done', total: 0 })
    emit({ type: 'built', lectures: [], cards: 0, dropped: 0, costUsd: 0, durationMs: 0 })
    return
  }
  const capUsd = command.capUsd ?? estimated.capUsd
  emit({ type: 'estimate', ...estimated, capUsd })
  const { model, decide } = createAsk(ports, meter, capUsd)
  const b: Build = { ports, emit, course, model, decide, writer: createWriter(model, preset) }
  phaseMs.read = ports.now() - readStart
  emit({ type: 'phase', phase: 'read', status: 'done', total: read.length })

  /** What the build has saved so far: its lectures, listed in `course.json`. */
  const done = { lectures: [] as BuiltLecture[], dropped: 0 }
  const cardsDone = () => done.lectures.reduce((sum, l) => sum + l.cards, 0)
  /**
   * The run's record, with what it spent. Written once: when the build is through, or when it
   * stopped, so that money spent on a run that failed still shows.
   */
  let recorded = false
  const record = async (failed: boolean) => {
    if (recorded) return
    recorded = true
    const run: Run = {
      run: (await store.list(paths.runs(course))).length + 1,
      startedAt: new Date(startedAt).toISOString(),
      model: ports.model.model,
      decisionModel: ports.decisions.model,
      ...(failed ? { failed: true as const } : {}),
      goal,
      lectures: done.lectures.map((l) => l.number),
      cards: cardsDone(),
      dropped: done.dropped,
      ...meter,
      costEur: shownEuros(meter.costUsd),
      estimateUsd: estimated.costUsd,
      durationMs: ports.now() - startedAt,
      phaseMs,
    }
    await writeJson(store, `${paths.runs(course)}/${String(run.run).padStart(3, '0')}.json`, run)
  }

  try {
    const before = await courseSoFar(b, existing)

    // Map each lecture, label its facts, add the exam questions, plan the cards of all.
    const { lectures, exams, planned } = await phase('map', read.length, async () => {
      const lectures: OpenLecture[] = []
      for (const [i, lecture] of read.entries()) {
        lectures.push(await mapLecture(b, lecture, before.earlier))
        emit({
          type: 'progress',
          phase: 'map',
          done: i + 1,
          total: read.length,
          lecture: lecture.number,
        })
      }
      const exams = await addExamAnswers(b, freshPapers, lectures)
      return { lectures, exams, planned: planCards(lectures, goal) }
    })

    const saved: Saved = {
      file: {
        format: 1,
        name: existing?.name ?? course.split('/').at(-1)!,
        goal,
        lectures: existing?.lectures ?? [],
      },
      decisions: await courseDecisions(b, existing, goal, lectures),
      cards: before.existingCards,
    }
    const allowed = budget(
      goal,
      lectures.reduce((sum, lecture) => sum + lecture.slides, 0),
    )

    // Write and check one lecture after the other, so the two phases overlap. A lecture is saved
    // as soon as it is through. Identity is fixed by the plan, before a single word is written.
    const nextId = createIds()
    const written = { done: 0, total: planned.length }
    emit({ type: 'phase', phase: 'write', status: 'started', total: planned.length })
    for (const [i, lecture] of lectures.entries()) {
      const slots = planned.filter((slot) => slot.lecture === lecture)
      const later = planned.filter((slot) => lectures.indexOf(slot.lecture) > i).length
      const items = await timed('write', () => fillCards(b, slots, nextId, written))
      if (i === lectures.length - 1)
        emit({ type: 'phase', phase: 'write', status: 'done', total: planned.length })
      if (i === 0) emit({ type: 'phase', phase: 'check', status: 'started', total: planned.length })

      const settled = cardsDone() + done.dropped
      const checked = await timed('check', async () => {
        const checked = await checkCards(b, items, nextId, (passed, total) =>
          emit({
            type: 'progress',
            phase: 'check',
            done: cardsDone() + passed,
            total: settled + total + later,
          }),
        )
        dropClashes(saved.cards, checked)
        return checked
      })

      done.lectures.push(await saveLecture(b, saved, lecture, checked, allowed))
      done.dropped += checked.dropped.length
      // The papers count as read once the last lecture is saved: a stopped run asks them again.
      if (i === lectures.length - 1) await saveExams(b, saved, exams)
      // `course.json` goes last: a lecture counts as built once it is listed there.
      saved.file.lectures = [...saved.file.lectures, listing(lecture)].sort(
        (x, y) => x.number - y.number,
      )
      await writeJson(store, paths.course(course), saved.file)
    }
    emit({ type: 'phase', phase: 'check', status: 'done', total: planned.length })

    await record(false)
    emit({
      type: 'built',
      lectures: done.lectures,
      cards: cardsDone(),
      dropped: done.dropped,
      costUsd: meter.costUsd,
      durationMs: ports.now() - startedAt,
    })
  } catch (error) {
    // A stopped run keeps the lectures it saved, and its record says what it cost.
    await record(true).catch(() => undefined)
    throw error
  }
}

/** What the course already holds: its vocabulary, and the question of every card. */
async function courseSoFar(b: Build, existing: CourseFile | null) {
  const { store } = b.ports
  const earlier: Vocabulary = new Map()
  const existingCards: { id: string; card: CardFile }[] = []
  for (const { number } of existing?.lectures ?? []) {
    const lecture = await readJson<Lecture>(store, paths.lecture(b.course, number))
    for (const concept of lecture?.topics.flatMap((t) => t.concepts) ?? []) {
      if (!earlier.has(concept.id)) earlier.set(concept.id, { name: concept.name, lecture: number })
    }
    for (const card of await readCards(store, b.course, number))
      existingCards.push({ id: card.id, card })
  }
  return { earlier, existingCards }
}

/**
 * One lecture mapped: read slide by slide, its facts sorted and settled into topics and
 * concepts, every fact given its kind and its worth. New concepts join `earlier`.
 */
async function mapLecture(
  b: Build,
  lecture: ReadLecture,
  earlier: Vocabulary,
): Promise<OpenLecture> {
  const source = {
    context: slidesBlock(`Lecture file: ${lecture.file}`, lecture.text, lecture.images),
    images: lecture.images,
  }
  const ctx = {
    slides: lecture.text.length,
    earlier,
    fallbackTitle: titleFromFile(lecture.file, lecture.number),
  }
  const vocabulary = [...earlier.values()].map((concept) => concept.name)
  const found = await readSlides(b, lecture)
  const grouping = await askGroups(b.model, source, found, preset.mapRules, vocabulary)
  const settled = settleMap(fromGroups(found, grouping, factId), ctx)

  // The kind of each fact, closed questions over the lecture.
  const concepts = settled.topics.flatMap((t) => t.concepts)
  const facts = concepts.flatMap((concept) => concept.facts)
  const kinds = await kindsOf(b, source, facts)
  facts.forEach((fact, f) => {
    fact.kind = chosen(kinds[f], FACT_KINDS, 'definition')
  })
  await askWorth(b, concepts)
  for (const concept of concepts) {
    if (!earlier.has(concept.id))
      earlier.set(concept.id, { name: concept.name, lecture: lecture.number })
  }

  return {
    ...lecture,
    title: settled.title,
    slides: lecture.text.length,
    topics: settled.topics,
    leftOut: settled.leftOut,
    dropped: [],
    context: slidesBlock(
      `Lecture ${two(lecture.number)} ${settled.title}`,
      lecture.text,
      lecture.images,
    ),
    beyondGoal: [],
  }
}

/**
 * Every slide of a lecture read on its own, with its picture. The first slide goes ahead and
 * fills the provider's cache with the lecture; the rest read it there.
 */
async function readSlides(b: Build, lecture: ReadLecture) {
  const all = lecture.text.map((_, s) => s + 1)
  const context = slidesBlock(`Lecture file: ${lecture.file}`, lecture.text, [])
  const slide = (s: number) => ({
    number: s + 1,
    lines: lecture.text[s]!,
    image: lecture.pictures[s]!,
  })
  const first = await askSlide(b.model, context, slide(0), preset.mapRules)
  const rest = await pool(all.slice(1), (n) =>
    askSlide(b.model, context, slide(n - 1), preset.mapRules),
  )
  return [first, ...rest].flat()
}

/** The kind of each fact, in requests that carry only the pictures of the slides the facts come from. */
async function kindsOf(b: Build, source: { context: string; images: SlideImage[] }, facts: Fact[]) {
  const answers: Awaited<ReturnType<Decide>> = []
  for (let start = 0; start < facts.length;) {
    const pictured = new Map<number, SlideImage>()
    let end = start
    for (; end < facts.length; end++) {
      const slide = facts[end]!.slide
      const image = source.images.find((candidate) => candidate.slide === slide)
      if (!image || pictured.has(slide)) continue
      if (pictured.size === MAX_DECISION_IMAGES) break
      pictured.set(slide, image)
    }
    answers.push(
      ...(await b.decide({
        context: source.context,
        images: [...pictured.values()].sort((x, y) => x.slide - y.slide),
        questions: facts.slice(start, end).map((fact) => ask.factKind(fact.text)),
      })),
    )
    start = end
  }
  return answers
}

/** How much each fact is worth learning, each fact as the whole input of its own request. */
async function askWorth(b: Build, concepts: Concept[]): Promise<void> {
  await pool(
    concepts.flatMap((concept) => concept.facts.map((fact) => ({ concept, fact }))),
    async ({ concept, fact }) => {
      const [answer] = await b.decide({
        context: factInput(concept.name, fact.text),
        images: [],
        questions: [ask.worth()],
      })
      const worth = score(answer)
      if (worth !== null) fact.worth = Math.round(worth * 100) / 100
    },
  )
}

/**
 * Past exams: the papers not read before, read into their questions, then the questions sorted
 * into families, each answered as a fact of the lecture it belongs to. Saved with the course.
 */
async function addExamAnswers(b: Build, fresh: Paper[], lectures: OpenLecture[]): Promise<Exams> {
  const { store } = b.ports
  const saved: ExamsFile = (await readJson<ExamsFile>(store, paths.examsFile(b.course))) ?? {
    papers: [],
  }
  const tally = { questions: 0, papers: 0, families: 0, fromSlides: 0 }
  const papers = await pool(fresh, async ({ name, pages }) => ({
    file: name,
    questions: await askQuestions(b.model, name.replace(/\.pdf$/i, ''), pages),
  }))
  const file: ExamsFile = { papers: [...saved.papers, ...papers] }
  const questions = papers.flatMap((paper) => paper.questions)
  if (questions.length === 0) return { file, tally }
  // Questions that ask the same thing, each placed in one lecture of this build.
  const places = lectures.map((l) => ({
    number: l.number,
    title: l.title,
    concepts: l.topics.flatMap((t) => t.concepts).map((c) => c.name),
  }))
  const families = await askFamilies(b.model, questions, places)
  const answered = await pool(families, async (family) => {
    const lecture = lectures.find((l) => l.number === family.lecture)!
    const answer = await askAnswer(b.model, lecture, family)
    return { family, lecture, answer }
  })
  const added = new Map<OpenLecture, Fact[]>()
  for (const { family, lecture, answer } of answered) {
    if (answer.answer.trim() === '') continue
    const fact = examFact(lecture, family, answer)
    added.set(lecture, [...(added.get(lecture) ?? []), fact])
  }
  // The kind of each answer, as for every other fact.
  for (const [lecture, facts] of added) {
    const kinds = await kindsOf(b, lecture, facts)
    facts.forEach((fact, f) => (fact.kind = chosen(kinds[f], FACT_KINDS, 'definition')))
  }
  const all = [...added.values()].flat()
  Object.assign(tally, {
    questions: questions.length,
    papers: papers.length,
    families: all.length,
    fromSlides: all.filter((fact) => fact.exam!.fromSlides).length,
  })
  return { file, tally }
}

/** One plan for all lectures of the build: the goal's cards go where the facts worth most are. */
function planCards(lectures: OpenLecture[], goal: Goal): Planned[] {
  const planned: Planned[] = []
  plan(lectures, goal, preset).forEach(({ slots, beyondGoal }, i) => {
    lectures[i]!.beyondGoal = beyondGoal
    planned.push(...slots.map((slot) => ({ lecture: lectures[i]!, ...slot })))
  })
  return planned
}

/** Card ids, counted per lecture, concept and card type. */
function createIds(): NextId {
  const counters = new Map<string, number>()
  return (lecture, concept, role) => {
    const key = `${lecture.number}/${concept.id}/${role}`
    const n = (counters.get(key) ?? 0) + 1
    counters.set(key, n)
    return cardId(lecture.number, concept.id, role, n)
  }
}

const job = (item: Item): CardJob => ({
  context: item.lecture.context,
  images: item.lecture.images,
  concept: item.concept,
  fact: item.fact,
  role: item.role,
})

const draftOf = (item: Item): Draft => ({
  concept: item.concept.name,
  role: item.role,
  slide: item.fact.slide,
  ...item.slots,
})

/** Fill one form per planned card. `written` counts the cards of the whole build. */
async function fillCards(
  b: Build,
  planned: Planned[],
  nextId: NextId,
  written: { done: number; total: number },
): Promise<Item[]> {
  const empty: Slots = { front: '', answers: [], labels: [], extra: '', code: '' }
  const drafted: Item[] = planned.map((slot, order) => ({
    ...slot,
    id: nextId(slot.lecture, slot.concept, slot.role),
    order,
    slots: empty,
    part: false,
    problems: [],
  }))
  const fill = async (item: Item) => {
    item.slots = await b.writer.fill(job(item))
    b.emit({
      type: 'progress',
      phase: 'write',
      done: ++written.done,
      total: written.total,
      lecture: item.lecture.number,
    })
  }
  // The provider caches the lecture per card type. The first card of each type in a lecture
  // goes ahead and fills that cache; the rest then read the lecture at the cached price.
  const first = new Map<string, Item>()
  for (const item of drafted) {
    const key = `${item.lecture.number}/${item.role}`
    if (!first.has(key)) first.set(key, item)
  }
  const ahead = new Set(first.values())
  await pool([...ahead], fill)
  await pool(
    drafted.filter((item) => !ahead.has(item)),
    fill,
  )
  return drafted
}

/**
 * The gate, the card check and the repair, in rounds. What fails is repaired or split and
 * checked again, at most `REPAIRS` times, then dropped. After each round `progress` hears how
 * many cards passed and how many are in play.
 */
async function checkCards(
  b: Build,
  items: Item[],
  nextId: NextId,
  progress: (passed: number, total: number) => void,
): Promise<Checked> {
  const accepted: Item[] = []
  const dropped: Item[] = []
  let pending = items
  for (let round = 0; pending.length > 0; round++) {
    const failing: Item[] = []
    const passing: Item[] = []
    for (const item of pending) (passesRules(item) ? passing : failing).push(item)
    await checkOrganisation(b, passing)
    for (const item of passing) {
      if (item.problems.length > 0) dropped.push(item)
      else accepted.push(item)
    }
    // A split adds cards, so the total is what is in play now, never less than what is done.
    progress(accepted.length, accepted.length + failing.length + dropped.length)
    if (round === REPAIRS) {
      dropped.push(...failing)
      break
    }
    pending = await rewrite(b, failing, nextId, dropped)
  }
  accepted.sort((x, y) => x.order - y.order)
  return { accepted, dropped }
}

/**
 * The gate: hard limits and the two rules on what a card says. A card that passes is assembled;
 * one that does not keeps its problems. A card within every limit can still lean on the slides
 * or say nothing. Both are asked of what the model wrote, never of a student's own card.
 */
function passesRules(item: Item): boolean {
  const text = item.lecture.text
  item.problems = validateDraft(draftOf(item), {
    slides: item.concept.slides,
    slideText: (slide) => text[slide - 1]?.join('\n'),
    seenAsImage: (slide) => item.lecture.images.some((image) => image.slide === slide),
  })
  if (item.problems.length === 0) {
    item.problems = [...leansOnSlides(draftOf(item)), ...saysNothing(draftOf(item))]
  }
  if (item.problems.length > 0) return false
  item.card = assemble(draftOf(item), {
    id: item.id,
    lecture: item.lecture,
    concept: item.concept,
    slideLines: text[item.fact.slide - 1]!,
    ...(item.fact.exam ? { exam: item.fact.exam } : {}),
  })
  return true
}

/**
 * The card check, each card as the whole input of its own request. A card about the
 * organisation of the course is marked at once: no wording repairs such a fact.
 */
async function checkOrganisation(b: Build, passing: Item[]): Promise<void> {
  await pool(passing, async (item) => {
    const { question, answer } = questionAndAnswer(item.card!)
    const [verdict] = await b.decide({
      context: cardInput(question, answer),
      images: [],
      questions: [ask.organisation()],
    })
    const p = probability(verdict)
    if (p === null || p < ORGANISATION_THRESHOLD) return
    item.problems = [ORGANISATION]
  })
}

/**
 * A card that is too long is split into atomic cards. Everything else is filled again. Returns
 * the cards to check next; a card that cannot be split is dropped.
 */
async function rewrite(
  b: Build,
  failing: Item[],
  nextId: NextId,
  dropped: Item[],
): Promise<Item[]> {
  const parts = await pool(failing, async (item) => {
    if (!item.part && tooLong(draftOf(item)))
      return b.writer.split(job(item), item.slots, item.problems)
    item.slots = await b.writer.repair(job(item), item.slots, item.problems)
    return null
  })
  return failing.flatMap((item, i) => {
    const split = parts[i]
    if (!split) return [item]
    if (split.length === 0) {
      dropped.push(item)
      return []
    }
    return split.slice(0, SPLIT_INTO).map((slots, k) => ({
      ...item,
      // The first part keeps the id, so the plan's card is still there.
      id: k === 0 ? item.id : nextId(item.lecture, item.concept, item.role),
      order: item.order + k / (SPLIT_INTO + 1),
      slots,
      part: true,
    }))
  })
}

/**
 * Clashes with every card of the course so far, those of earlier lectures of this build
 * included: a new card whose question is word for word one that exists is dropped. No card is
 * rewritten here.
 */
function dropClashes(existingCards: { id: string; card: CardFile }[], checked: Checked): void {
  const { accepted, dropped } = checked
  const text = (card: CardFile) => htmlToText(card.fields.Front ?? card.fields.Text ?? '')
  const clashes = findClashes(
    existingCards.map(({ id, card }) => ({ id, text: text(card) })),
    accepted.map((item) => ({ id: item.id, text: text(item.card!) })),
  )
  for (const [id, other] of clashes.same) {
    const item = accepted.splice(
      accepted.findIndex((candidate) => candidate.id === id),
      1,
    )[0]!
    item.problems = [`asks the same question as ${other}`]
    dropped.push(item)
  }
}

/**
 * The decisions that exist before the first lecture is saved: those of earlier builds, without
 * what an earlier run that did not finish wrote about a lecture of this one, and on the first
 * build the goal.
 */
async function courseDecisions(
  b: Build,
  existing: CourseFile | null,
  goal: Goal,
  lectures: OpenLecture[],
): Promise<Decision[]> {
  if (existing?.lectures.length) {
    const built = new Set(lectures.map((lecture) => lecture.number))
    return ((await readJson<Decision[]>(b.ports.store, paths.decisions(b.course))) ?? []).filter(
      (decision) => decision.lecture === null || !built.has(decision.lecture),
    )
  }
  const { label, cardsPerSlide } = GOAL_PRESETS[goal]
  return [
    {
      lecture: null,
      kind: 'goal',
      text: `Goal "${label}": the facts worth most get a card, at most ${cardsPerSlide} per slide.`,
    },
  ]
}

/**
 * Save one finished lecture: its cards, its tree, and the decisions of the course so far. Its
 * cards join the course, so the next lecture's clash check sees them. Returns the lecture's
 * line of the `built` event.
 */
async function saveLecture(
  b: Build,
  saved: Saved,
  lecture: OpenLecture,
  { accepted, dropped }: Checked,
  allowed: number,
): Promise<BuiltLecture> {
  const { store } = b.ports
  const lost: Dropped[] = dropped.map((item) => ({
    concept: item.concept.name,
    role: item.role,
    front: item.slots.front,
    problems: item.problems,
  }))
  const cards = accepted.map((item) => item.card!)
  await writeCards(store, b.course, lecture.number, cards)
  const { number, title, file, slides, topics, leftOut } = lecture
  const tree: Lecture = { number, title, file, slides, topics, leftOut, dropped: lost }
  await writeJson(store, paths.lecture(b.course, number), tree)
  saved.decisions.push(
    ...account(lecture, allowed, new Set(accepted.map((item) => item.concept)), lost.length),
  )
  await writeJson(store, paths.decisions(b.course), saved.decisions)
  saved.cards.push(...cards.map((card) => ({ id: card.id, card })))
  const concepts = topics.flatMap((t) => t.concepts).length
  return { number, title, concepts, cards: cards.length }
}

/** The past papers and what this build made of them, saved with the last lecture. */
async function saveExams(b: Build, saved: Saved, { file, tally }: Exams): Promise<void> {
  const { store } = b.ports
  if (file.papers.length > 0) await writeJson(store, paths.examsFile(b.course), file)
  if (tally.families === 0) return
  const byModel = tally.families - tally.fromSlides
  saved.decisions.push({
    lecture: null,
    kind: 'exams',
    text: `${tally.questions} questions from ${tally.papers} past papers came down to ${tally.families} questions that get a card first. The slides answer ${tally.fromSlides} of them; ${byModel} the model answered from what it knows, and those cards say so.`,
  })
  await writeJson(store, paths.decisions(b.course), saved.decisions)
}

/** A lecture as `course.json` lists it. */
function listing(lecture: OpenLecture): CourseFile['lectures'][number] {
  const { number, title, file, sha256, slides } = lecture
  return { number, title, file, sha256, slides }
}

/** The decisions of one lecture, written by code from what happened. */
function account(
  lecture: OpenLecture,
  allowed: number,
  withCards: Set<Concept>,
  dropped: number,
): Decision[] {
  const name = `${two(lecture.number)} ${lecture.title}`
  const out: Decision[] = []
  const add = (kind: Decision['kind'], text: string) =>
    out.push({ lecture: lecture.number, kind, text })
  const names = (concepts: Concept[]) => concepts.map((c) => `"${c.name}"`).join(', ')

  const byReason = new Map<string, number[]>()
  for (const { slide, reason } of lecture.leftOut) {
    byReason.set(reason, [...(byReason.get(reason) ?? []), slide])
  }
  for (const [reason, slides] of byReason) {
    add('left-out', `No cards for ${slideRange(slides)} in ${name}: ${reason.toLowerCase()}.`)
  }
  if (lecture.beyondGoal.length > 0) {
    add(
      'beyond-goal',
      `No cards in ${name} for ${names(lecture.beyondGoal)}: the goal allows ${allowed} cards in this build, and other facts are worth more.`,
    )
  }
  const concepts = lecture.topics.flatMap((t) => t.concepts)
  for (const concept of concepts.filter((c) => c.since !== undefined)) {
    add(
      'recurring',
      `"${concept.name}" comes up again in ${name}: one more card on top of lecture ${two(concept.since!)}.`,
    )
  }
  const bare = concepts.filter((c) => !withCards.has(c) && !lecture.beyondGoal.includes(c))
  if (bare.length > 0)
    add('no-card', `No card in ${name} for ${names(bare)}: no card passed the checks.`)
  if (dropped > 0) {
    const what = dropped === 1 ? '1 card' : `${dropped} cards`
    add('dropped', `${what} dropped in ${name}. The reasons are listed with the lecture.`)
  }
  return out
}

/**
 * The answer to a family of exam questions as a fact of its lecture: under the concept it
 * names, or a new concept in the lecture's last topic. An answer the slides do not hold sits on
 * the first slide of its concept, so the card still has a place.
 */
function examFact(lecture: OpenLecture, family: Family, answer: Answer): Fact {
  const concepts = lecture.topics.flatMap((topic) => topic.concepts)
  const name = family.concept || family.question
  let concept = concepts.find((c) => c.name.toLowerCase() === name.toLowerCase())
  if (!concept) {
    let id = slug(name) || 'exam-question'
    while (concepts.some((c) => c.id === id)) id = `${id}-2`
    concept = { id, name, slides: [], facts: [] }
    lecture.topics.at(-1)!.concepts.push(concept)
  }
  const onSlide = answer.fromSlides && answer.slide >= 1 && answer.slide <= lecture.slides
  const slide = onSlide ? answer.slide : (concept.slides[0] ?? 1)
  const fact: Fact = {
    text: answer.answer.trim(),
    slide,
    kind: 'definition',
    ...(answer.items > 0 ? { items: answer.items } : {}),
    exam: { question: family.question, papers: family.papers, fromSlides: onSlide },
  }
  // First in its concept, so that of two cards asking the same, the exam's is kept.
  concept.facts.unshift(fact)
  if (!concept.slides.includes(slide))
    concept.slides = [...concept.slides, slide].sort((a, b) => a - b)
  return fact
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Runs `work` over all items, a few at a time, and keeps the order of the results. After the
 * first failure no further item is started, so a stopped run stops spending.
 */
async function pool<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let next = 0
  let failed = false
  const worker = async () => {
    while (next < items.length && !failed) {
      const i = next++
      try {
        results[i] = await work(items[i]!)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker))
  return results
}
