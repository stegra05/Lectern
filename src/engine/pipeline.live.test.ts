/**
 * Full end-to-end live test: real PDF → real agentic pipeline → real Anki
 * sync via AnkiConnect. LECTERN_LIVE_MODEL picks the model (default Gemini
 * 3.8 Flash); the run needs that provider's key, and the Anki leg
 * additionally a running Anki with AnkiConnect.
 *
 *   GEMINI_API_KEY=... pnpm vitest run src/engine/pipeline.live.test.ts
 *   LECTERN_LIVE_MODEL=claude-haiku-5-5 ANTHROPIC_API_KEY=... pnpm vitest run …
 *
 * The Anki leg writes into the deck "Lectern E2E" and removes the created
 * notes and deck afterwards.
 */

import { readFile } from 'node:fs/promises'
import { describe, expect, it, onTestFinished } from 'vitest'
import { AnkiClient, checkConnection, resolveModelNames, syncCards } from './anki'
import { createClient } from './clients'
import { DEFAULT_SETTINGS, providerOf, type ProviderId } from './config'
import { runPipeline } from './pipeline'
import { buildCardTags } from './tags'
import type { Card, PipelineEvent, Settings } from './types'

const MODEL = process.env.LECTERN_LIVE_MODEL ?? 'gemini-3.8-flash'
const KEY_ENV: Record<ProviderId, string> = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
}
const apiKey = process.env[KEY_ENV[providerOf(MODEL)]]
const PDF_PATH =
  process.env.LECTERN_TEST_PDF ??
  '/Users/stef/Archive/code/apps/lectern-v1/LecternApp/resources/test_script.pdf'
const E2E_DECK = 'Lectern E2E'

describe.skipIf(!apiKey)('pipeline live E2E', () => {
  it(
    'turns a PDF into gated, grounded cards and syncs them to Anki',
    { timeout: 600_000 },
    async () => {
      const pdfBytes = new Uint8Array(await readFile(PDF_PATH))

      // Metadata via pdf.js (legacy build — the standard one needs a DOM).
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const doc = await pdfjs.getDocument({ data: pdfBytes.slice() }).promise
      let textChars = 0
      for (let p = 1; p <= doc.numPages; p++) {
        const text = await (await doc.getPage(p)).getTextContent()
        for (const item of text.items) if ('str' in item) textChars += item.str.length
      }
      const pdfInfo = { pageCount: doc.numPages, textChars, imageCount: 0 }
      expect(pdfInfo.pageCount).toBeGreaterThan(0)

      const events: PipelineEvent[] = []
      const outcome = await runPipeline({
        pdfBytes,
        pdfInfo,
        fileName: 'test_script.pdf',
        density: 'overview',
        model: MODEL,
        apiKey: apiKey ?? '',
        fetchFn: fetch,
        emit: (e) => {
          events.push(e)
          // The test must not leave the lecture in the provider account.
          if (e.type === 'document_uploaded') {
            const client = createClient(e.provider, apiKey ?? '', fetch)
            onTestFinished(() => client.deleteDocument(e.document))
          }
          if (e.type === 'log') console.log(`[${e.level}] ${e.message}`)
          if (e.type === 'phase') console.log(`--- phase: ${e.phase}`)
          if (e.type === 'done') console.log(`DONE: ${e.summary}`)
        },
      })

      // The deck exists and is grounded.
      expect(outcome.cards.length).toBeGreaterThan(0)
      const planned = events.find((e) => e.type === 'concept_map')
      expect(outcome.cards.length).toBeLessThanOrEqual(
        planned?.type === 'concept_map' ? planned.sizing.totalCardCap : 0,
      )
      for (const card of outcome.cards) {
        expect(card.sourcePages.length).toBeGreaterThan(0)
        expect(card.rationale).toBeTruthy()
        expect(card.sourceExcerpt).toBeTruthy()
        expect(card.qualityScore).toBeGreaterThanOrEqual(60)
        expect(Object.values(card.fields).join('')).not.toContain('**') // no Markdown
      }

      // The concept map and coverage ledger did their jobs.
      expect(outcome.conceptMap.concepts.length).toBeGreaterThan(0)
      expect(outcome.coverage.pageCoveragePercent).toBeGreaterThan(0)
      expect(outcome.usage.inputTokens).toBeGreaterThan(0)
      expect(outcome.usage.costUsd).toBeGreaterThan(0)
      console.log(
        `cards=${outcome.cards.length} coverage=${Math.round(outcome.coverage.pageCoveragePercent)}% ` +
          `cost=$${outcome.usage.costUsd.toFixed(3)} reason=${outcome.terminationReason}`,
      )

      // Event stream sanity: phases in order, one accepted event per card.
      const phases = events.filter((e) => e.type === 'phase').map((e) => e.phase)
      expect(phases[0]).toBe('uploading')
      expect(phases).toContain('mapping')
      expect(phases).toContain('generating')
      expect(phases.at(-1)).toBe('complete')

      // ---- Anki leg (skipped politely if Anki isn't running) ------------------
      const settings: Settings = { ...DEFAULT_SETTINGS }
      const client = new AnkiClient(settings.ankiUrl, fetch)
      const health = await checkConnection(client)
      if (!health.ok) {
        console.warn('Anki not reachable — skipping the sync leg.')
        return
      }

      const models = await resolveModelNames(client, settings)
      console.log(`resolved note types: basic=${models.basic} cloze=${models.cloze}`)

      const tagsFor = (card: Card) =>
        buildCardTags({
          template: settings.tagTemplate,
          deck: E2E_DECK,
          slideSet: outcome.conceptMap.slideSetName,
          topic: card.slideTopic,
          defaultTag: 'lectern-e2e',
          enableDefaultTag: true,
        })

      const result = await syncCards(client, outcome.cards, E2E_DECK, settings, tagsFor, (p) =>
        console.log(`sync ${p.done}/${p.total}`),
      )
      console.log(
        `created=${result.created} updated=${result.updated} failed=${result.failures.length}`,
      )
      for (const f of result.failures) console.warn(`  sync failure: ${f.front}: ${f.error}`)
      expect(result.created).toBeGreaterThan(0)
      expect(result.failures.length).toBe(0)

      // Verify the notes really exist in Anki, then clean up.
      const noteIds = [...result.noteIds.values()]
      const infos = await client.notesInfo(noteIds)
      expect(infos.length).toBe(noteIds.length)
      await client.deleteNotes(noteIds)
      // Remove the now-empty deck (raw action — not part of the app's API surface).
      await fetch(settings.ankiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deleteDecks',
          version: 6,
          params: { decks: [E2E_DECK], cardsToo: true },
        }),
      })
      console.log('cleaned up E2E notes and deck')
    },
  )
})
