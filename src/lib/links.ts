import { openUrl } from '@tauri-apps/plugin-opener'
import { version } from '../../package.json'
import type { ProviderId } from '../engine/config'
import { IS_TAURI } from './platform'

export const APP_VERSION = version

/** Every page outside the app that Lectern sends people to. */
export const LINKS = {
  ankiConnect: 'https://ankiweb.net/shared/info/2055492159',
  changelog: 'https://stegra05.github.io/Lectern/changelog.html',
} as const

export interface Link {
  label: string
  url: string
}

/** Each provider's console: where a key is made, limits read, billing fixed. */
export const PROVIDER_LINKS: Record<
  ProviderId,
  { console: string; key: string; rateLimits: string; billing: string; status: string }
> = {
  gemini: {
    console: 'Google AI Studio',
    key: 'https://aistudio.google.com/apikey',
    rateLimits: 'https://aistudio.google.com/rate-limit?timeRange=last-28-days',
    billing: 'https://aistudio.google.com/projects',
    status: 'https://aistudio.google.com/status',
  },
  openai: {
    console: 'the OpenAI dashboard',
    key: 'https://platform.openai.com/api-keys',
    rateLimits: 'https://platform.openai.com/settings/organization/limits',
    billing: 'https://platform.openai.com/settings/organization/billing/overview',
    status: 'https://status.openai.com',
  },
  anthropic: {
    console: 'the Claude Console',
    key: 'https://platform.claude.com/settings/keys',
    rateLimits: 'https://platform.claude.com/settings/limits',
    billing: 'https://platform.claude.com/settings/billing',
    status: 'https://status.claude.com',
  },
}

/** Open a page in the default browser; the webview itself never navigates. */
export function openExternal(url: string): void {
  if (!IS_TAURI) {
    window.open(url, '_blank', 'noopener')
    return
  }
  openUrl(url).catch((e: unknown) => console.warn('Could not open link:', e))
}

/** A bug report with the version, and what Lectern showed when there is
 *  something to quote, already filled in. */
export function reportIssueUrl(summary = '', details = ''): string {
  const params = new URLSearchParams({ template: 'bug_report.yml', version: APP_VERSION })
  if (summary) params.set('title', summary)
  if (details) params.set('what-happened', `${details}\n\nWhat I was doing just before:\n`)
  return `https://github.com/stegra05/Lectern/issues/new?${params.toString()}`
}
