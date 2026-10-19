/**
 * Every error the student can see is described here, once.
 *
 * The engine throws errors that say what kind of failure happened (a
 * LlmError kind, an Anki transport or API error, a pdf.js exception);
 * this module turns them into a title, a sentence that names the fix, and
 * the action or link that carries it out. The error banner, toasts and
 * desktop notifications all render from the same Problem.
 */

import { AnkiApiError, AnkiTransportError } from '../engine/anki'
import { PROVIDERS, RATE_LIMIT_MAX_RETRIES } from '../engine/config'
import { LlmError } from '../engine/llm'
import { LINKS, PROVIDER_LINKS, reportIssueUrl, type Link } from './links'

/** What Lectern was doing when the error happened. */
export type Activity =
  | 'generating'
  | 'requesting'
  | 'reading_deck'
  | 'sending'
  | 'styling'
  | 'opening_pdf'
  | 'updating'
  | 'saving_key'
  | 'opening_anki'

export interface Problem {
  title: string
  /** What happened and what to do about it, in full sentences. */
  body: string
  /** A fix the app can take the student to. */
  fix?: 'settings' | 'check_anki'
  /** Whether doing the same thing again can work. */
  retry: boolean
  link?: Link
}

/** Titles for errors Lectern does not recognise, by what it was doing. */
const FALLBACK_TITLE: Record<Activity, string> = {
  generating: 'Generation stopped',
  requesting: 'The request for more cards failed',
  reading_deck: 'Lectern could not read the deck from Anki',
  sending: 'Sending to Anki failed',
  styling: 'The card design could not be applied',
  opening_pdf: 'Lectern could not open this PDF',
  updating: 'The update failed',
  saving_key: 'The API key could not be saved',
  opening_anki: 'Lectern could not open Anki',
}

const ANKICONNECT: Link = { label: 'Get AnkiConnect', url: LINKS.ankiConnect }

export function describeProblem(error: unknown, activity: Activity): Problem {
  if (error instanceof LlmError) return describeLlm(error, activity)

  if (error instanceof AnkiTransportError) {
    return {
      title: 'Anki isn’t reachable',
      body: 'Open Anki with the AnkiConnect add-on installed, then try again.',
      fix: 'check_anki',
      retry: true,
      link: ANKICONNECT,
    }
  }
  if (error instanceof AnkiApiError) {
    return {
      title: FALLBACK_TITLE[activity],
      body: `Anki refused it: “${ankiDetail(error)}”`,
      retry: true,
    }
  }

  const name = error instanceof Error ? error.name : ''
  if (name === 'PasswordException') {
    return {
      title: 'This PDF is password-protected',
      body: 'Save a copy without the password (printing it to a new PDF works), then open that.',
      retry: false,
    }
  }
  if (name === 'InvalidPDFException') {
    return {
      title: 'This file isn’t a readable PDF',
      body: 'It may be damaged or only partly downloaded. Try exporting or downloading it again.',
      retry: false,
    }
  }

  return unknownProblem(error, activity)
}

function describeLlm(error: LlmError, activity: Activity): Problem {
  const name = PROVIDERS[error.provider].label
  const links = PROVIDER_LINKS[error.provider]
  const rateLimits: Link = { label: 'See your rate limits', url: links.rateLimits }
  switch (error.kind) {
    case 'key_rejected':
      return {
        title: `${name} rejected the API key`,
        body: `Check the key in Settings, or create a new one in ${links.console}.`,
        fix: 'settings',
        retry: true,
        link: { label: 'Get a key', url: links.key },
      }
    case 'quota_daily':
      return {
        title: `Your ${name} key’s daily quota is used up`,
        body: 'Waiting a few minutes won’t help today. The quota resets tomorrow.',
        retry: false,
        link: rateLimits,
      }
    case 'rate_limited':
      return {
        title: `${name} is rate-limiting your key`,
        body:
          `The per-minute limit stayed spent through ${RATE_LIMIT_MAX_RETRIES} retries, ` +
          'which usually means a low usage tier. Wait a few minutes, then try again.',
        retry: true,
        link: rateLimits,
      }
    case 'spending_cap':
      return {
        title: `Your ${name} account is out of budget`,
        body: `A spending cap or the balance stopped the run. Check billing in ${links.console}.`,
        retry: false,
        link: { label: 'Open billing', url: links.billing },
      }
    case 'server':
      return {
        title: `${name} is having trouble`,
        body:
          `Its servers kept failing through ${RATE_LIMIT_MAX_RETRIES} retries. ` +
          `This is on ${name}’s side, so try again in a few minutes.`,
        retry: true,
        link: { label: `Check ${name}’s status`, url: links.status },
      }
    case 'network':
      return {
        title: `Lectern can’t reach ${name}`,
        body: 'The connection kept dropping. Check your internet connection, then try again.',
        retry: true,
      }
    case 'bad_response':
      return {
        title: `${name} sent back something Lectern couldn’t read`,
        body: 'This is usually a one-off, and trying again tends to fix it.',
        retry: true,
      }
    case 'pdf_rejected':
      return {
        title: `${name} couldn’t process this PDF`,
        body:
          'It may be damaged, or scanned pages without any text. ' +
          'Try exporting it again, or pick a different file.',
        retry: false,
      }
    case 'pdf_timeout':
      return {
        title: `${name} took too long to read the PDF`,
        body: 'Large or image-heavy PDFs can time out. Try again, or split the lecture into parts.',
        retry: true,
      }
    case 'refused':
      return {
        title: `${name} declined this material`,
        body: 'Its safety checks stopped the request. A different model in Settings may accept it.',
        fix: 'settings',
        retry: false,
      }
    case 'request_rejected':
      return unknownProblem(error, activity, `${name} refused the request: “${error.message}”`)
  }
}

function unknownProblem(error: unknown, activity: Activity, body?: string): Problem {
  const raw = error instanceof Error ? error.message : String(error)
  const title = FALLBACK_TITLE[activity]
  return {
    title,
    body: body ?? sentence(raw || 'Lectern did not get an explanation.'),
    retry: true,
    link: {
      label: 'Report this problem',
      url: reportIssueUrl(title, `Lectern showed: “${title}. ${raw}”`),
    },
  }
}

/** Why one card did not reach Anki, for its line in the activity log. */
export function describeSyncFailure(error: Error): string {
  if (error instanceof AnkiTransportError) return 'Anki stopped answering'
  if (error instanceof AnkiApiError) {
    const detail = ankiDetail(error)
    if (/duplicate/i.test(detail)) return 'Anki already has this card'
    if (/empty/i.test(detail)) return 'Anki sees an empty card'
    if (/model was not found/i.test(detail)) return 'The note type is missing in Anki'
    if (/deck was not found/i.test(detail)) return 'The deck is missing in Anki'
    return `Anki refused it: “${detail}”`
  }
  return sentence(error.message)
}

/** The cause of a wait in two words, for the sidebar countdown. */
export function waitCause(status: number): string {
  return status === 429 ? 'Rate limit' : status === 0 ? 'Connection lost' : 'Server error'
}

/** AnkiConnect's own words, without the "AnkiConnect error for addNote:" wrapper. */
const ankiDetail = (error: AnkiApiError): string =>
  error.message.replace(/^AnkiConnect error for \w+: /, '')

const sentence = (text: string): string => {
  const trimmed = text.trim()
  return /[.!?”]$/.test(trimmed) ? trimmed : `${trimmed}.`
}
