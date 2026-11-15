/**
 * The build command. Four course-wide phases, as the run screen shows them, carrying the
 * steps of how cards are created:
 *
 *   read   text and pictures of the slides
 *   map    every slide read on its own, its facts sorted into topics and concepts, their
 *          checks, the kind and worth of each fact and the plan
 *   write  one form per planned card
 *   check  the gate with repair and split, then clashes across the course
 *
 * Only lectures that are not in `course.json` yet are built. Nothing is written until every
 * phase is through, and files of earlier lectures are never touched.
 */

import type { BuildCommand, Emit, EstimateCommand } from './commands.ts'
import { createAsk, type Meter } from './ask.ts'
import { assemble, type CardFile } from './cards/assemble.ts'
import { cardId } from './cards/id.ts'
import { questionAndAnswer } from './cards/question-answer.ts'
import { GOAL_PRESETS, type Draft, type Goal, type Role } from './cards/roles.ts'
import { leansOnSlides, saysNothing, tooLong, validateDraft } from './cards/validate.ts'
import { htmlToText, slideRange, slug, two } from './cards/words.ts'
import { findClashes } from './clash.ts'
import { estimate, LOW_TEXT_CHARS } from './cost.ts'
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
import { createWriter, type CardJob, type Slots } from './writer.ts'

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
    const start = ports.now()
    const result = await work()
    phaseMs[name] = ports.now() - start
    emit({ type: 'phase', phase: name, status: 'done', total })
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
  const { model: askModel, decide } = createAsk(ports, meter, capUsd)
  const writer = createWriter(askModel, preset)
  phaseMs.read = ports.now() - readStart
  emit({ type: 'phase', phase: 'read', status: 'done', total: read.length })

  const accepted: Item[] = []
  const dropped: Item[] = []
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
      lectures: read.map((l) => l.number),
      cards: accepted.length,
      dropped: dropped.length,
      ...meter,
      estimateUsd: estimated.costUsd,
      durationMs: ports.now() - startedAt,
      phaseMs,
    }
    await writeJson(store, `${paths.runs(course)}/${String(run.run).padStart(3, '0')}.json`, run)
  }

  try {
    // What the course already holds: its vocabulary, and the question of every card.
    const earlier = new Map<string, { name: string; lecture: number }>()
    const existingCards: { id: string; card: CardFile }[] = []
    for (const { number } of existing?.lectures ?? []) {
      const lecture = await readJson<Lecture>(store, paths.lecture(course, number))
      for (const concept of lecture?.topics.flatMap((t) => t.concepts) ?? []) {
        if (!earlier.has(concept.id))
          earlier.set(concept.id, { name: concept.name, lecture: number })
      }
      for (const card of await readCards(store, course, number))
        existingCards.push({ id: card.id, card })
    }

    // Every slide of a lecture read on its own, with its picture. The first slide goes ahead and
    // fills the provider's cache with the lecture; the rest read it there.
    const readSlides = async (lecture: ReadLecture) => {
      const all = lecture.text.map((_, s) => s + 1)
      const context = slidesBlock(`Lecture file: ${lecture.file}`, lecture.text, [])
      const slide = (s: number) => ({
        number: s + 1,
        lines: lecture.text[s]!,
        image: lecture.pictures[s]!,
      })
      const first = await askSlide(askModel, context, slide(0), preset.mapRules)
      const rest = await pool(all.slice(1), (n) =>
        askSlide(askModel, context, slide(n - 1), preset.mapRules),
      )
      return [first, ...rest].flat()
    }

    /** The kind of each fact, in requests that carry only the pictures of the slides the facts come from. */
    const kindsOf = async (source: { context: string; images: SlideImage[] }, facts: Fact[]) => {
      const answers: Awaited<ReturnType<typeof decide>> = []
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
          ...(await decide({
            context: source.context,
            images: [...pictured.values()].sort((a, b) => a.slide - b.slide),
            questions: facts.slice(start, end).map((fact) => ask.factKind(fact.text)),
          })),
        )
        start = end
      }
      return answers
    }

    // Past exams: the papers not read before, read into their questions. Saved with the course.
    let examsFile: ExamsFile = (await readJson<ExamsFile>(store, paths.examsFile(course))) ?? {
      papers: [],
    }
    const examTally = { questions: 0, papers: 0, families: 0, fromSlides: 0 }
    const addExamAnswers = async (lectures: OpenLecture[]) => {
      const papers = await pool(freshPapers, async ({ name, pages }) => ({
        file: name,
        questions: await askQuestions(askModel, name.replace(/\.pdf$/i, ''), pages),
      }))
      examsFile = { papers: [...examsFile.papers, ...papers] }
      const questions = papers.flatMap((paper) => paper.questions)
      if (questions.length === 0) return
      // Questions that ask the same thing, each placed in one lecture of this build.
      const places = lectures.map((l) => ({
        number: l.number,
        title: l.title,
        concepts: l.topics.flatMap((t) => t.concepts).map((c) => c.name),
      }))
      const families = await askFamilies(askModel, questions, places)
      const answered = await pool(families, async (family) => {
        const lecture = lectures.find((l) => l.number === family.lecture)!
        const answer = await askAnswer(askModel, lecture, family)
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
        const kinds = await kindsOf(lecture, facts)
        facts.forEach((fact, f) => (fact.kind = chosen(kinds[f], FACT_KINDS, 'definition')))
      }
      const all = [...added.values()].flat()
      Object.assign(examTally, {
        questions: questions.length,
        papers: papers.length,
        families: all.length,
        fromSlides: all.filter((fact) => fact.exam!.fromSlides).length,
      })
    }

    // Map each lecture, label its facts, plan its cards.
    const planned: { lecture: OpenLecture; concept: Concept; fact: Fact; role: Role }[] = []
    const lectures = await phase('map', read.length, async () => {
      const out: OpenLecture[] = []
      for (const [i, lecture] of read.entries()) {
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
        const found = await readSlides(lecture)
        const grouping = await askGroups(askModel, source, found, preset.mapRules, vocabulary)
        const settled = settleMap(fromGroups(found, grouping, factId), ctx)

        // The kind of each fact, closed questions over the lecture.
        const concepts = settled.topics.flatMap((t) => t.concepts)
        const facts = concepts.flatMap((concept) => concept.facts)
        const kinds = await kindsOf(source, facts)
        facts.forEach((fact, f) => {
          fact.kind = chosen(kinds[f], FACT_KINDS, 'definition')
        })
        // How much each fact is worth learning, each fact as the whole input of its own request.
        await pool(
          concepts.flatMap((concept) => concept.facts.map((fact) => ({ concept, fact }))),
          async ({ concept, fact }) => {
            const [answer] = await decide({
              context: factInput(concept.name, fact.text),
              images: [],
              questions: [ask.worth()],
            })
            const worth = score(answer)
            if (worth !== null) fact.worth = Math.round(worth * 100) / 100
          },
        )
        for (const concept of concepts) {
          if (!earlier.has(concept.id))
            earlier.set(concept.id, { name: concept.name, lecture: lecture.number })
        }

        const open: OpenLecture = {
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
        out.push(open)
        emit({
          type: 'progress',
          phase: 'map',
          done: i + 1,
          total: read.length,
          lecture: lecture.number,
        })
      }
      await addExamAnswers(out)
      // One plan for all lectures of the build: the goal's cards go where the facts worth most are.
      plan(out, goal, preset).forEach(({ slots, beyondGoal }, i) => {
        out[i]!.beyondGoal = beyondGoal
        planned.push(...slots.map((slot) => ({ lecture: out[i]!, ...slot })))
      })
      return out
    })
    // Identity is fixed by the plan, before a single word is written.
    const counters = new Map<string, number>()
    const nextId = (lecture: OpenLecture, concept: Concept, role: Role) => {
      const key = `${lecture.number}/${concept.id}/${role}`
      const n = (counters.get(key) ?? 0) + 1
      counters.set(key, n)
      return cardId(lecture.number, concept.id, role, n)
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

    // Fill one form per planned card.
    const items = await phase('write', planned.length, async () => {
      let done = 0
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
        item.slots = await writer.fill(job(item))
        emit({
          type: 'progress',
          phase: 'write',
          done: ++done,
          total: drafted.length,
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
    })

    // The gate with repair and split, then the clashes.
    await phase('check', items.length, async () => {
      let pending = items
      for (let round = 0; pending.length > 0; round++) {
        // The gate: hard limits and the two rules on what a card says.
        const failing: Item[] = []
        const passing: Item[] = []
        for (const item of pending) {
          const text = item.lecture.text
          const pictured = (slide: number) =>
            item.lecture.images.some((image) => image.slide === slide)
          item.problems = validateDraft(draftOf(item), {
            slides: item.concept.slides,
            slideText: (slide) => text[slide - 1]?.join('\n'),
            seenAsImage: pictured,
          })
          // A card within every limit can still lean on the slides or say nothing. Both are
          // asked of what the model wrote, never of a student's own card.
          if (item.problems.length === 0) {
            item.problems = [...leansOnSlides(draftOf(item)), ...saysNothing(draftOf(item))]
          }
          if (item.problems.length > 0) {
            failing.push(item)
            continue
          }
          item.card = assemble(draftOf(item), {
            id: item.id,
            lecture: item.lecture,
            concept: item.concept,
            slideLines: text[item.fact.slide - 1]!,
            ...(item.fact.exam ? { exam: item.fact.exam } : {}),
          })
          passing.push(item)
        }
        // The card check, each card as the whole input of its own request. A card about the
        // organisation of the course is dropped at once: no wording repairs such a fact.
        await pool(passing, async (item) => {
          const { question, answer } = questionAndAnswer(item.card!)
          const [verdict] = await decide({
            context: cardInput(question, answer),
            images: [],
            questions: [ask.organisation()],
          })
          const p = probability(verdict)
          if (p === null || p < ORGANISATION_THRESHOLD) return
          item.problems = [ORGANISATION]
        })
        for (const item of passing) {
          if (item.problems.length > 0) dropped.push(item)
          else accepted.push(item)
        }
        // A split adds cards, so the total is what is in play now, never less than what is done.
        const total = accepted.length + failing.length + dropped.length
        emit({ type: 'progress', phase: 'check', done: accepted.length, total })
        if (round === REPAIRS) {
          dropped.push(...failing)
          break
        }

        // A card that is too long is split into atomic cards. Everything else is filled again.
        const parts = await pool(failing, async (item) => {
          if (!item.part && tooLong(draftOf(item)))
            return writer.split(job(item), item.slots, item.problems)
          item.slots = await writer.repair(job(item), item.slots, item.problems)
          return null
        })
        pending = failing.flatMap((item, i) => {
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
      accepted.sort((a, b) => a.order - b.order)

      // Clashes across the whole course: a new card whose question is word for word one that
      // exists is dropped. No card is rewritten here.
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
    })

    // Save. `course.json` goes last: a lecture counts as built once it is listed there. What
    // this run writes about a lecture replaces what an earlier run that did not finish wrote.
    if (examsFile.papers.length > 0) await writeJson(store, paths.examsFile(course), examsFile)
    const built = new Set(lectures.map((lecture) => lecture.number))
    const decisions: Decision[] = existing?.lectures.length
      ? ((await readJson<Decision[]>(store, paths.decisions(course))) ?? []).filter(
          (decision) => decision.lecture === null || !built.has(decision.lecture),
        )
      : []
    if (!existing?.lectures.length) {
      const { label, cardsPerSlide } = GOAL_PRESETS[goal]
      decisions.push({
        lecture: null,
        kind: 'goal',
        text: `Goal "${label}": the facts worth most get a card, at most ${cardsPerSlide} per slide.`,
      })
    }
    if (examTally.families > 0) {
      const byModel = examTally.families - examTally.fromSlides
      decisions.push({
        lecture: null,
        kind: 'exams',
        text: `${examTally.questions} questions from ${examTally.papers} past papers came down to ${examTally.families} questions that get a card first. The slides answer ${examTally.fromSlides} of them; ${byModel} the model answered from what it knows, and those cards say so.`,
      })
    }
    const summary = []
    const allowed = budget(
      goal,
      lectures.reduce((sum, lecture) => sum + lecture.slides, 0),
    )
    for (const lecture of lectures) {
      const cards = accepted.filter((item) => item.lecture === lecture)
      const lost: Dropped[] = dropped
        .filter((item) => item.lecture === lecture)
        .map((item) => ({
          concept: item.concept.name,
          role: item.role,
          front: item.slots.front,
          problems: item.problems,
        }))
      await writeCards(
        store,
        course,
        lecture.number,
        cards.map((item) => item.card!),
      )
      const { number, title, file, slides, topics, leftOut } = lecture
      const tree: Lecture = { number, title, file, slides, topics, leftOut, dropped: lost }
      await writeJson(store, paths.lecture(course, number), tree)
      decisions.push(
        ...account(lecture, allowed, new Set(cards.map((item) => item.concept)), lost.length),
      )
      const concepts = topics.flatMap((t) => t.concepts).length
      summary.push({ number, title, concepts, cards: cards.length })
    }
    await writeJson(store, paths.decisions(course), decisions)

    await record(false)

    const listed = lectures.map((l) => ({
      number: l.number,
      title: l.title,
      file: l.file,
      sha256: l.sha256,
      slides: l.slides,
    }))
    await writeJson(store, paths.course(course), {
      format: 1,
      name: existing?.name ?? course.split('/').at(-1)!,
      goal,
      lectures: [...(existing?.lectures ?? []), ...listed].sort((a, b) => a.number - b.number),
    } satisfies CourseFile)

    emit({
      type: 'built',
      lectures: summary,
      cards: accepted.length,
      dropped: dropped.length,
      costUsd: meter.costUsd,
      durationMs: ports.now() - startedAt,
    })
  } finally {
    // A build that stopped before this point still records what it spent.
    await record(true).catch(() => undefined)
  }
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
