/**
 * Model evaluation on real lectures: every variant runs the full pipeline on
 * every test PDF (no Anki leg), and the run is scored on what the benchmarks
 * do not cover: coverage, cards the gate rejected and why, review edits,
 * cost and wall-clock time. Spends real money, so it runs only on request:
 *
 *   LECTERN_EVAL=1 LECTERN_EVAL_PDFS=slides.pdf,script.pdf \
 *     GEMINI_API_KEY=... OPENAI_API_KEY=... ANTHROPIC_API_KEY=... \
 *     pnpm vitest run src/engine/models.eval.test.ts
 *
 * LECTERN_EVAL_ONLY=luna,haiku limits the run to the named variants.
 * Results go to eval-results/<timestamp>/ (git-ignored): the table in
 * summary.md, and per run the finished deck with the activity log, for
 * reading the cards themselves.
 * A variant whose provider has no key is skipped.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createClient } from './clients'
import { providerOf, type EffortPlan, type ProviderId } from './config'
import type { DocumentRef } from './llm'
import { conceptTarget } from './pacing'
import { runPipeline } from './pipeline'
import type { Card, PdfInfo, PipelineEvent, RejectionReason } from './types'

const PDFS = (process.env.LECTERN_EVAL_PDFS?.split(',') ?? [])
  .map((path) => path.trim())
  .filter((path) => path !== '')

interface Variant {
  name: string
  model: string
  effort?: EffortPlan
}

/** The loops at one level up from the shared plan: medium to generate, high
 *  to review. Never above high, for the first-token latency. */
const DEEPER_LOOPS: EffortPlan = { generating: 'medium', reflecting: 'high' }

const VARIANTS: Variant[] = [
  { name: 'gemini-flash', model: 'gemini-3.8-flash' },
  { name: 'luna', model: 'gpt-6-luna' },
  { name: 'luna-deeper', model: 'gpt-6-luna', effort: DEEPER_LOOPS },
  { name: 'haiku', model: 'claude-haiku-5-5' },
  { name: 'haiku-deeper', model: 'claude-haiku-5-5', effort: DEEPER_LOOPS },
  { name: 'sonnet', model: 'claude-sonnet-5-5' },
]

const KEYS: Record<ProviderId, string | undefined> = {
  gemini: process.env.GEMINI_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
}

interface RunResult {
  variant: string
  pdf: string
  error?: string
  seconds: number
  costUsd: number
  concepts: number
  conceptTarget: string
  cards: number
  cap: number
  pageCoverage: number
  conceptCoverage: number
  accepted: number
  rejected: number
  rejectReasons: Partial<Record<RejectionReason, number>>
  review: string
  rounds: number
  termination: string
  /** The deck and the activity log, as Markdown. */
  transcript: string
}

/** The run as the student would read it: log lines in order, then every
 *  card with what it cites. */
function transcriptOf(events: PipelineEvent[], cards: Card[], concepts: string[]): string {
  const log = events.flatMap((e) => {
    if (e.type === 'log') return [`- [${e.level}] ${e.message}${e.quote ? `\n  > ${e.quote}` : ''}`]
    if (e.type === 'card_rejected') return [`- [rejected: ${e.reasons.join(', ')}] ${e.front}`]
    return []
  })
  const deck = cards.map((card, i) => {
    const fields = Object.entries(card.fields)
      .map(([name, value]) => `  - **${name}:** ${value}`)
      .join('\n')
    return (
      `${i + 1}. ${card.modelName} · ${card.slideTopic ?? 'no topic'} · pages ${card.sourcePages.join(', ')}\n` +
      `${fields}\n  - *excerpt:* ${card.sourceExcerpt ?? ''}\n  - *rationale:* ${card.rationale ?? ''}` +
      (card.qualityIssues.length > 0 ? `\n  - *gate flags:* ${card.qualityIssues.join(', ')}` : '')
    )
  })
  return (
    `## Concepts\n\n${concepts.join('; ')}\n\n## Activity log\n\n${log.join('\n')}\n\n` +
    `## Deck\n\n${deck.join('\n\n')}\n`
  )
}

async function pdfInfoOf(bytes: Uint8Array): Promise<PdfInfo> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
  const pageTexts: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const text = await (await doc.getPage(p)).getTextContent()
    pageTexts.push(text.items.map((item) => ('str' in item ? item.str : '')).join(' '))
  }
  const textChars = pageTexts.reduce((n, t) => n + t.length, 0)
  return { pageCount: doc.numPages, textChars, imageCount: 0, pageTexts }
}

async function runOne(variant: Variant, pdfPath: string): Promise<RunResult> {
  const provider = providerOf(variant.model)
  const key = KEYS[provider] ?? ''
  const bytes = new Uint8Array(await readFile(pdfPath))
  const pdfInfo = await pdfInfoOf(bytes)
  const target = conceptTarget(pdfInfo)
  const events: PipelineEvent[] = []
  const uploads: DocumentRef[] = []
  const started = Date.now()
  const base = {
    variant: variant.name,
    pdf: pdfPath.split('/').at(-1) ?? pdfPath,
    conceptTarget: `${target.min}-${target.max}`,
  }

  try {
    const outcome = await runPipeline({
      pdfBytes: bytes,
      pdfInfo,
      fileName: base.pdf,
      model: variant.model,
      effort: variant.effort,
      apiKey: key,
      fetchFn: fetch,
      emit: (e) => {
        events.push(e)
        if (e.type === 'document_uploaded') uploads.push(e.document)
      },
    })
    const rejectReasons: Partial<Record<RejectionReason, number>> = {}
    let rejected = 0
    for (const e of events) {
      if (e.type !== 'card_rejected') continue
      rejected++
      for (const reason of e.reasons) rejectReasons[reason] = (rejectReasons[reason] ?? 0) + 1
    }
    const review =
      events
        .filter((e) => e.type === 'log')
        .map((e) => e.message)
        .find((m) => m.startsWith('Quality pass')) ?? 'no review'
    const rounds = Math.max(0, ...events.map((e) => (e.type === 'progress' ? e.round : 0)))
    const cap = events.find((e) => e.type === 'concept_map')
    return {
      ...base,
      seconds: Math.round((Date.now() - started) / 1000),
      costUsd: outcome.usage.costUsd,
      concepts: outcome.conceptMap.concepts.length,
      cards: outcome.cards.length,
      cap: cap?.type === 'concept_map' ? cap.sizing.totalCardCap : 0,
      pageCoverage: Math.round(outcome.coverage.pageCoveragePercent),
      conceptCoverage: Math.round(outcome.coverage.effectiveConceptCoveragePercent),
      accepted: events.filter((e) => e.type === 'card_accepted').length,
      rejected,
      rejectReasons,
      review: review.replace('Quality pass: ', ''),
      rounds,
      termination: outcome.terminationReason,
      transcript: transcriptOf(
        events,
        outcome.cards,
        outcome.conceptMap.concepts.map((c) => `${c.name} (${c.importance})`),
      ),
    }
  } catch (e) {
    return {
      ...base,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      seconds: Math.round((Date.now() - started) / 1000),
      costUsd: 0,
      concepts: 0,
      cards: 0,
      cap: 0,
      pageCoverage: 0,
      conceptCoverage: 0,
      accepted: 0,
      rejected: 0,
      rejectReasons: {},
      review: '',
      rounds: 0,
      termination: 'error',
      transcript: transcriptOf(events, [], []),
    }
  } finally {
    // An eval must not leave lectures in the provider account either.
    const client = createClient(provider, key, fetch)
    await Promise.all(uploads.map((d) => client.deleteDocument(d).catch(() => undefined)))
  }
}

function table(results: RunResult[]): string {
  const header =
    '| variant | pdf | s | $ | concepts (target) | cards/cap | pages % | concepts % | ' +
    'accepted | rejected (reasons) | review | rounds | end |'
  const rule = `|${header
    .split('|')
    .slice(1, -1)
    .map(() => '---')
    .join('|')}|`
  const rows = results.map((r) =>
    r.error
      ? `| ${r.variant} | ${r.pdf} | ${r.seconds} | | | | | | | | ${r.error.replaceAll('|', '/')} | | error |`
      : `| ${r.variant} | ${r.pdf} | ${r.seconds} | ${r.costUsd.toFixed(3)} | ` +
        `${r.concepts} (${r.conceptTarget}) | ${r.cards}/${r.cap} | ${r.pageCoverage} | ` +
        `${r.conceptCoverage} | ${r.accepted} | ${r.rejected} ` +
        `(${Object.entries(r.rejectReasons)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ')}) | ${r.review} | ${r.rounds} | ${r.termination} |`,
  )
  return [header, rule, ...rows].join('\n')
}

const only = process.env.LECTERN_EVAL_ONLY?.split(',').map((name) => name.trim())
const variants = VARIANTS.filter(
  (v) => KEYS[providerOf(v.model)] && (!only || only.includes(v.name)),
)

describe.skipIf(!process.env.LECTERN_EVAL || PDFS.length === 0)(
  'model evaluation (live, costs money)',
  () => {
    it('runs every variant on every lecture', { timeout: 3_600_000 }, async () => {
      // Variants run side by side; one variant's lectures run in turn.
      const results = (
        await Promise.all(
          variants.map(async (variant) => {
            const own: RunResult[] = []
            for (const pdf of PDFS) own.push(await runOne(variant, pdf))
            return own
          }),
        )
      ).flat()

      const dir = join(process.cwd(), 'eval-results', new Date().toISOString().replaceAll(':', '-'))
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'summary.md'),
        `# Model eval ${new Date().toISOString()}\n\n${table(results)}\n`,
      )
      for (const r of results) {
        await writeFile(
          join(dir, `${r.variant}__${r.pdf.replace(/\.pdf$/, '')}.md`),
          `# ${r.variant} on ${r.pdf}\n\n${r.error ?? ''}\n\n${r.transcript}`,
        )
      }
      console.log(`${table(results)}\n\nwritten to ${dir}`)
      expect(results.length).toBe(variants.length * PDFS.length)
    })
  },
)
