import { openUrl } from '@tauri-apps/plugin-opener'
import { version } from '../../package.json'
import { IS_TAURI } from './platform'

export const APP_VERSION = version

/** Every page outside the app that Lectern sends people to. */
export const LINKS = {
  geminiKey: 'https://aistudio.google.com/apikey',
  geminiRateLimits: 'https://aistudio.google.com/rate-limit?timeRange=last-28-days',
  geminiProjects: 'https://aistudio.google.com/projects',
  geminiStatus: 'https://aistudio.google.com/status',
  ankiConnect: 'https://ankiweb.net/shared/info/2055492159',
  changelog: 'https://stegra05.github.io/Lectern/changelog.html',
} as const

export interface Link {
  label: string
  url: string
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
