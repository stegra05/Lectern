/**
 * The engine words its failures for the command line too. Where the app differs, the fix is
 * said here, once, by the reason the engine gives.
 */
import type { Event } from '@lectern/engine'

const KEY_IN_SETTINGS = 'Check your OpenAI key in Settings, then try again.'

export function inAppWords(event: Event): Event {
  return event.type === 'failed' && event.reason === 'key'
    ? { ...event, fix: KEY_IN_SETTINGS }
    : event
}
