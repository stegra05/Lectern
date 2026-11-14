/**
 * The build command. Four course-wide phases, as the run screen shows them, carrying the
 * seven steps of how cards are created:
 *
 *   read   text and pictures of the slides, the course profile (1), the kind of each slide (2)
 *   map    topics, concepts and facts (3), their checks, the kind of each fact and the plan (4)
 *   write  one form per planned card (5)
 *   check  the gate with repair and split (6), then clashes across the course (7)
 *
 * Only lectures that are not in `course.json` yet are built. Nothing is written until every
 * phase is through, and files of earlier lectures are never touched.
 */

import type { BuildCommand, Emit, EstimateCommand } from './api.ts'
import { createAsk, type Meter } from './ask.ts'
import { assemble, type CardFile } from './cards/assemble.ts'
import { cardId } from './cards/id.ts'
import { GOAL_PRESETS, type Draft, type Goal, type Role } from './cards/roles.ts'
import { COPY_RUN, copiedRun, groundedByRule, tooLong, validateDraft } from './cards/validate.ts'
import { htmlToText, slideRange, two } from './cards/words.ts'
import { findClashes, similarity } from './clash.ts'
import { estimate, LOW_TEXT_CHARS } from './cost.ts'
import {
  assignNumbers,
  inCourseOrder,
  paths,
  readCards,
  readJson,
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
  chosen,
  FACT_KINDS,
  probability,
  PROFILE_KINDS,
  SLIDE_KINDS,
  type Calibrations,
  type SlideKind,
} from './decide.ts'
import { EngineError } from './errors.ts'
import { askMap, slidesBlock } from './mapper.ts'
import { questionAndAnswer } from './outline.ts'
import { plan } from './plan.ts'
import type { Ports, SlideImage } from './ports.ts'
import { presetFor } from './presets.ts'
import { settleMap, unusedSlides } from './tree.ts'
import { createWriter, type CardJob, type Slots } from './writer.ts'

/** How often a rejected card is filled again before it is dropped. */
const REPAIRS = 2
/** A card that is too long becomes at most this many atomic cards. */
const SPLIT_INTO = 3
/** Model calls that run at the same time in the write and check phases. */
const PARALLEL = 4
/** Two concept names sharing this share of their words may be the same concept. */
const SAME_NAME = 0.5
/** How much text of the course the profile question reads. */
const PROFILE_CHARS = 6000

type Phase = 'read' | 'map' | 'write' | 'check'

/** A new lecture after reading: its text, its pictures, nothing judged yet. */
interface ReadLecture {
  number: number
  file: string
  sha256: string
  text: string[][]
  images: SlideImage[]
}

/** A new lecture on its way through the build. */
interface OpenLecture extends Lecture, ReadLecture {
  /** The whole lecture as every card writer call sees it. */
  context: string
  outsideCore: Concept[]
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
  flags: string[]
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
    const text = await ports.pdf.readSlides(bytes)
    // Slides with little text are figures, formulas or scans: the model gets to see them.
    const low = text.flatMap((lines, s) => (lines.join(' ').length < LOW_TEXT_CHARS ? [s + 1] : []))
    const images = low.length > 0 ? await ports.pdf.renderSlides(bytes, low) : []
    lectures.push({ number: numbers[i]!, file, sha256: await sha256(bytes), text, images })
  }
  const sizes = lectures.map((l) => ({
    chars: l.text.flat().join(' ').length,
    slides: l.text.length,
    images: l.images.length,
  }))
  const prices = { model: ports.model.price, decisions: ports.decisions.price }
  return { course, existing, goal, lectures, estimate: estimate(sizes, goal, prices) }
}

export async function estimateCourse(
  ports: Ports,
  command: EstimateCommand,
  emit: Emit,
): Promise<void> {
  emit({ type: 'estimate', ...(await survey(ports, command)).estimate })
}

export async function build(
  ports: Ports,
  calibrations: Calibrations,
  command: BuildCommand,
  emit: Emit,
): Promise<void> {
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

  const meter: Meter = { calls: 0, decisions: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }

  // Read all lectures. The estimate is known before the first paid call.
  emit({ type: 'phase', phase: 'read', status: 'started', total: 0 })
  const readStart = ports.now()
  const {
    course,
    existing,
    goal,
    lectures: read,
    estimate: estimated,
  } = await survey(ports, command)
  if (read.length === 0) {
    emit({ type: 'phase', phase: 'read', status: 'done', total: 0 })
    emit({
      type: 'built',
      lectures: [],
      cards: 0,
      dropped: 0,
      flagged: 0,
      costUsd: 0,
      durationMs: 0,
    })
    return
  }
  emit({ type: 'estimate', ...estimated })
  const { model: askModel, decide } = createAsk(ports, meter, estimated.capUsd)

  // Step 1: the profile of the course, once. It picks the preset.
  let profile = existing?.profile
  if (command.profile) profile = { kind: command.profile, confidence: null }
  if (!profile) {
    const sample = read
      .flatMap((l) => l.text.flat())
      .join('\n')
      .slice(0, PROFILE_CHARS)
    const [answer] = await decide({ context: sample, images: [], questions: [ask.profile()] })
    profile = {
      kind: chosen(answer, PROFILE_KINDS, 'concept'),
      confidence: answer?.type === 'choice' ? answer.confidence : 0,
    }
  }
  emit({ type: 'profile', ...profile })
  const preset = presetFor(profile.kind)
  const writer = createWriter(askModel, preset)

  // Step 2: the kind of every slide, one request per lecture.
  const kinds = new Map<ReadLecture, SlideKind[]>()
  for (const [i, lecture] of read.entries()) {
    const context = slidesBlock(`Lecture file: ${lecture.file}`, lecture.text, lecture.images)
    const questions = lecture.text.map((_, s) => ask.slideKind(s + 1))
    const answers = await decide({ context, images: lecture.images, questions })
    kinds.set(
      lecture,
      answers.map((answer) => chosen(answer, SLIDE_KINDS, 'content')),
    )
    emit({ type: 'progress', phase: 'read', done: i + 1, total: read.length })
  }
  phaseMs.read = ports.now() - readStart
  emit({ type: 'phase', phase: 'read', status: 'done', total: read.length })

  // What the course already holds: its vocabulary, and the question of every card.
  const earlier = new Map<string, { name: string; lecture: number }>()
  const existingCards: { id: string; card: CardFile }[] = []
  for (const { number } of existing?.lectures ?? []) {
    const lecture = await readJson<Lecture>(store, paths.lecture(course, number))
    for (const concept of lecture?.topics.flatMap((t) => t.concepts) ?? []) {
      if (!earlier.has(concept.id)) earlier.set(concept.id, { name: concept.name, lecture: number })
    }
    for (const card of await readCards(store, course, number))
      existingCards.push({ id: card.id, card })
  }

  // Steps 3 and 4: map each lecture, check it, label its facts, plan its cards.
  const planned: { lecture: OpenLecture; concept: Concept; fact: Fact; role: Role }[] = []
  const lectures = await phase('map', read.length, async () => {
    const out: OpenLecture[] = []
    for (const [i, lecture] of read.entries()) {
      const slideKinds = kinds.get(lecture)!
      const source = {
        context: slidesBlock(`Lecture file: ${lecture.file}`, lecture.text, lecture.images),
        images: lecture.images,
      }
      const ctx = {
        kinds: slideKinds,
        contentOnly: calibrations.slideKind.calibrated,
        earlier,
        fallbackTitle:
          lecture.file.replace(/\.pdf$/i, '').replace(/^[\d\s._-]+/, '') ||
          `Lecture ${lecture.number}`,
      }
      const vocabulary = [...earlier.values()].map((concept) => concept.name)
      let settled = settleMap(await askMap(askModel, source, vocabulary), ctx)
      if (settled.problems.length > 0) {
        settled = settleMap(await askMap(askModel, source, vocabulary, settled.problems), ctx)
      }

      // Closed questions about the map, all in one request over the lecture.
      let concepts = settled.topics.flatMap((t) => t.concepts)
      const pairs = concepts
        .filter((concept) => concept.since === undefined)
        .flatMap((concept) =>
          [...earlier]
            .filter(([, known]) => similarity(concept.name, known.name) >= SAME_NAME)
            .map(([id, known]) => ({ concept, id, known })),
        )
      const facts = concepts.flatMap((concept) => concept.facts)
      const answers = await decide({
        ...source,
        questions: [
          ...concepts.map((concept) => ask.conceptBelongs(concept.name)),
          ...pairs.map(({ concept, known }) => ask.sameConcept(concept.name, known.name)),
          ...facts.map((fact) => ask.factKind(fact.text)),
        ],
      })
      const gone = new Set<Concept>()
      concepts.forEach((concept, c) => {
        const p = probability(answers[c])
        if (p === null || p >= calibrations.conceptBelongs.threshold) return
        if (calibrations.conceptBelongs.calibrated) gone.add(concept)
        else flag(concept, 'may not belong to this lecture')
      })
      pairs.forEach(({ concept, id, known }, k) => {
        const p = probability(answers[concepts.length + k])
        if (p === null || p < calibrations.sameConcept.threshold || concept.since !== undefined)
          return
        if (!calibrations.sameConcept.calibrated) {
          flag(concept, `may be the same as "${known.name}" from lecture ${two(known.lecture)}`)
        } else if (concepts.some((other) => other.id === id)) {
          gone.add(concept)
        } else {
          Object.assign(concept, { id, name: known.name, since: known.lecture })
        }
      })
      facts.forEach((fact, f) => {
        fact.kind = chosen(answers[concepts.length + pairs.length + f], FACT_KINDS, 'definition')
      })
      const topics = settled.topics
        .map((topic) => ({
          ...topic,
          concepts: topic.concepts.filter((concept) => !gone.has(concept)),
        }))
        .filter((topic) => topic.concepts.length > 0)
      concepts = topics.flatMap((t) => t.concepts)
      for (const concept of concepts) {
        if (!earlier.has(concept.id))
          earlier.set(concept.id, { name: concept.name, lecture: lecture.number })
      }

      const { slots, outsideCore } = plan(topics, goal, preset)
      const open: OpenLecture = {
        ...lecture,
        title: settled.title,
        slides: lecture.text.length,
        topics,
        leftOut: unusedSlides(topics, slideKinds),
        dropped: [],
        context: slidesBlock(
          `Lecture ${two(lecture.number)} ${settled.title}`,
          lecture.text,
          lecture.images,
        ),
        outsideCore,
      }
      planned.push(...slots.map((slot) => ({ lecture: open, ...slot })))
      out.push(open)
      emit({ type: 'progress', phase: 'map', done: i + 1, total: read.length })
    }
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

  // Step 5: fill one form per planned card.
  const items = await phase('write', planned.length, async () => {
    let done = 0
    const empty: Slots = { front: '', answers: [], labels: [], extra: '', code: '', diagram: null }
    const drafted: Item[] = planned.map((slot, order) => ({
      ...slot,
      id: nextId(slot.lecture, slot.concept, slot.role),
      order,
      slots: empty,
      part: false,
      problems: [],
      flags: [],
    }))
    await pool(drafted, async (item) => {
      item.slots = await writer.fill(job(item))
      emit({ type: 'progress', phase: 'write', done: ++done, total: drafted.length })
    })
    return drafted
  })

  // Steps 6 and 7.
  const accepted: Item[] = []
  const dropped: Item[] = []
  await phase('check', items.length, async () => {
    let pending = items
    for (let round = 0; pending.length > 0; round++) {
      // The gate: hard limits, then the copy check, then the slide check.
      const failing: Item[] = []
      const passing: Item[] = []
      for (const item of pending) {
        const text = item.lecture.text
        const pictured = (slide: number) =>
          item.lecture.images.some((image) => image.slide === slide)
        item.flags = []
        item.problems = validateDraft(draftOf(item), {
          slides: item.concept.slides,
          slideText: (slide) => text[slide - 1]?.join('\n'),
          seenAsImage: pictured,
        })
        if (item.problems.length > 0) {
          failing.push(item)
          continue
        }
        const slideLines = text[item.fact.slide - 1]!
        item.card = assemble(draftOf(item), {
          id: item.id,
          lecture: item.lecture,
          concept: item.concept,
          slideLines,
        })
        if (copiedRun(draftOf(item), slideLines.join(' ')) >= COPY_RUN) {
          item.flags.push('copies a long run of slide text')
        }
        passing.push(item)
      }
      for (const lecture of lectures) {
        const unsure = passing.filter((item) => {
          if (item.lecture !== lecture) return false
          const slide = item.fact.slide
          const seen = lecture.images.some((image) => image.slide === slide)
          return seen || !groundedByRule(draftOf(item), lecture.text[slide - 1]!.join('\n'))
        })
        const questions = unsure.map((item) => {
          const { question, answer } = questionAndAnswer(item.card!)
          return ask.supported(item.fact.slide, question, answer)
        })
        const answers = await decide({
          context: lecture.context,
          images: lecture.images,
          questions,
        })
        unsure.forEach((item, i) => {
          const p = probability(answers[i])
          if (p === null || p >= calibrations.supported.threshold) return
          if (calibrations.supported.calibrated) {
            item.problems = [
              `slide ${item.fact.slide} does not support this answer; take the answer from the slide`,
            ]
          } else {
            item.flags.push('the answer may not be on its slide')
          }
        })
      }
      for (const item of passing) (item.problems.length > 0 ? failing : accepted).push(item)
      emit({ type: 'progress', phase: 'check', done: accepted.length, total: items.length })
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

    // Step 7: clashes across the whole course. No card is rewritten here.
    const text = (card: CardFile) => htmlToText(card.fields.Front ?? card.fields.Text ?? '')
    const byId = new Map([
      ...existingCards.map(({ id, card }) => [id, card] as const),
      ...accepted.map((i) => [i.id, i.card!] as const),
    ])
    const clashes = findClashes(
      existingCards.map(({ id, card }) => ({ id, text: text(card) })),
      accepted.map((item) => ({ id: item.id, text: text(item.card!) })),
    )
    const out = new Map<string, string>(
      clashes.same.map(([id, other]) => [id, `asks the same question as ${other}`]),
    )
    const said = (id: string) => {
      const { question, answer } = questionAndAnswer(byId.get(id)!)
      return `${question} ${answer}`
    }
    const answers = await decide({
      context: 'Flashcards of one university course.',
      images: [],
      questions: clashes.alike.map(([id, other]) => ask.sameCard(said(id), said(other))),
    })
    clashes.alike.forEach(([id, other], i) => {
      const p = probability(answers[i])
      const { calibrated, threshold } = calibrations.sameCard
      if (p === null || p < threshold / 2) return
      const item = accepted.find((candidate) => candidate.id === id)!
      // From the threshold on the pair is a duplicate; just below it, a near twin.
      if (p < threshold) item.flags.push(`looks like ${other}`)
      else if (calibrated) out.set(id, `tests the same thing as ${other}`)
      else item.flags.push(`may test the same thing as ${other}`)
    })
    for (const [id, reason] of out) {
      const item = accepted.splice(
        accepted.findIndex((candidate) => candidate.id === id),
        1,
      )[0]!
      item.problems = [reason]
      dropped.push(item)
    }
  })

  // Save. `course.json` goes last: a lecture counts as built once it is listed there.
  const decisions: Decision[] = (await readJson<Decision[]>(store, paths.decisions(course))) ?? []
  if (!existing?.lectures.length) {
    const depth = GOAL_PRESETS[goal]
    const coverage = depth.coverage === 'core' ? 'the core concepts' : 'every concept'
    const facts = depth.facts === 1 ? 'one card each' : `up to ${depth.facts} cards each`
    decisions.push({
      lecture: null,
      kind: 'goal',
      text: `Goal "${depth.label}": ${coverage}, ${facts}.`,
    })
    decisions.push({
      lecture: null,
      kind: 'profile',
      text: `Read as a ${profile.kind} course. Cards follow the "${preset.id}" preset.`,
    })
  }
  const summary = []
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
      cards.map((item) =>
        item.flags.length > 0 ? { ...item.card!, flags: item.flags } : item.card!,
      ),
    )
    const { number, title, file, slides, topics, leftOut } = lecture
    const tree: Lecture = { number, title, file, slides, topics, leftOut, dropped: lost }
    await writeJson(store, paths.lecture(course, number), tree)
    decisions.push(...account(lecture, new Set(cards.map((item) => item.concept)), lost.length))
    const concepts = topics.flatMap((t) => t.concepts).length
    summary.push({ number, title, concepts, cards: cards.length })
  }
  await writeJson(store, paths.decisions(course), decisions)

  const durationMs = ports.now() - startedAt
  const run: Run = {
    run: (await store.list(paths.runs(course))).length + 1,
    startedAt: new Date(startedAt).toISOString(),
    model: ports.model.model,
    decisionModel: ports.decisions.model,
    goal,
    lectures: lectures.map((l) => l.number),
    cards: accepted.length,
    dropped: dropped.length,
    ...meter,
    estimateUsd: estimated.costUsd,
    durationMs,
    phaseMs,
  }
  await writeJson(store, `${paths.runs(course)}/${String(run.run).padStart(3, '0')}.json`, run)

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
    profile,
    lectures: [...(existing?.lectures ?? []), ...listed].sort((a, b) => a.number - b.number),
  } satisfies CourseFile)

  emit({
    type: 'built',
    lectures: summary,
    cards: accepted.length,
    dropped: dropped.length,
    flagged: accepted.filter((item) => item.flags.length > 0).length,
    costUsd: meter.costUsd,
    durationMs,
  })
}

function flag(concept: Concept, text: string): void {
  concept.flags = [...(concept.flags ?? []), text]
}

/** The decisions of one lecture, written by code from what happened. */
function account(lecture: OpenLecture, withCards: Set<Concept>, dropped: number): Decision[] {
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
  if (lecture.outsideCore.length > 0) {
    add(
      'outside-core',
      `No cards in ${name} for ${names(lecture.outsideCore)}: outside the core, and the goal is to pass.`,
    )
  }
  const concepts = lecture.topics.flatMap((t) => t.concepts)
  for (const concept of concepts.filter((c) => c.since !== undefined)) {
    add(
      'recurring',
      `"${concept.name}" comes up again in ${name}: one more card on top of lecture ${two(concept.since!)}.`,
    )
  }
  const bare = concepts.filter((c) => !withCards.has(c) && !lecture.outsideCore.includes(c))
  if (bare.length > 0)
    add('no-card', `No card in ${name} for ${names(bare)}: no card passed the checks.`)
  if (dropped > 0) {
    const what = dropped === 1 ? '1 card' : `${dropped} cards`
    add('dropped', `${what} dropped in ${name}. The reasons are listed with the lecture.`)
  }
  return out
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
