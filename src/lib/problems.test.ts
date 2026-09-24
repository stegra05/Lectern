import { describe, expect, it } from 'vitest'
import { AnkiApiError, AnkiTransportError } from '../engine/anki'
import { GeminiError } from '../engine/gemini'
import { LINKS } from './links'
import { describeProblem, describeSyncFailure } from './problems'

describe('describeProblem', () => {
  it('sends a rejected key to Settings, with a way to get a new one', () => {
    const problem = describeProblem(new GeminiError('bad key', 400, 'key_rejected'), 'generating')
    expect(problem.fix).toBe('settings')
    expect(problem.retry).toBe(true)
    expect(problem.link?.url).toBe(LINKS.geminiKey)
  })

  it('offers no retry when a daily quota is spent', () => {
    const problem = describeProblem(new GeminiError('per day', 429, 'quota_daily'), 'generating')
    expect(problem.retry).toBe(false)
    expect(problem.link?.url).toBe(LINKS.geminiRateLimits)
  })

  it('names an unreachable Anki and how to fix it, whatever Lectern was doing', () => {
    const problem = describeProblem(new AnkiTransportError('Failed to reach'), 'sending')
    expect(problem.title).toBe('Anki isn’t reachable')
    expect(problem.fix).toBe('check_anki')
    expect(problem.link?.url).toBe(LINKS.ankiConnect)
  })

  it('quotes Anki without the AnkiConnect wrapper', () => {
    const error = new AnkiApiError('AnkiConnect error for createDeck: deck name is invalid')
    expect(describeProblem(error, 'sending').body).toBe('Anki refused it: “deck name is invalid”')
  })

  it('recognises a password-protected PDF by its pdf.js exception', () => {
    const error = Object.assign(new Error('No password given'), { name: 'PasswordException' })
    expect(describeProblem(error, 'opening_pdf').title).toBe('This PDF is password-protected')
  })

  it('falls back to what Lectern was doing, and offers a pre-filled report', () => {
    const problem = describeProblem(new Error('something odd'), 'requesting')
    expect(problem.title).toBe('The request for more cards failed')
    expect(problem.body).toBe('something odd.')
    const url = new URL(problem.link?.url ?? '')
    expect(url.searchParams.get('template')).toBe('bug_report.yml')
    expect(url.searchParams.get('version')).toMatch(/^\d+\.\d+\.\d+$/)
    expect(url.searchParams.get('what-happened')).toContain('something odd')
  })
})

describe('describeSyncFailure', () => {
  it('says what a duplicate means', () => {
    const error = new AnkiApiError(
      'AnkiConnect error for addNote: cannot create note because it is a duplicate',
    )
    expect(describeSyncFailure(error)).toBe('Anki already has this card')
  })

  it('tells a silent Anki apart from a refusal', () => {
    expect(describeSyncFailure(new AnkiTransportError('timeout'))).toBe('Anki stopped answering')
  })
})
