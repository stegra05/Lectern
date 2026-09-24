import type { ReactNode } from 'react'
import { LINKS } from '../lib/links'
import { useLectern } from '../state/store'
import { ExternalLink } from './ExternalLink'

/**
 * The two prerequisites, said before the first PDF rather than after it.
 * Each row says what it is needed for, so an offline Anki does not read as
 * a reason not to start: generating needs only the key, sending needs Anki.
 * Disappears once both are in place.
 */
export function SetupChecklist() {
  const hasApiKey = useLectern((s) => s.hasApiKey)
  const ankiStatus = useLectern((s) => s.ankiStatus)
  const openSettings = useLectern((s) => s.openSettings)
  const refreshAnki = useLectern((s) => s.refreshAnki)

  const ankiReady = ankiStatus === 'connected'
  if (hasApiKey && ankiReady) return null

  return (
    <div className="border-desk-edge/60 bg-desk-raised/50 rise-in mx-auto mt-8 max-w-sm divide-y divide-desk-edge/60 rounded-md border">
      <Row
        done={hasApiKey}
        title={hasApiKey ? 'Gemini API key saved' : 'Add a Gemini API key'}
        note={
          hasApiKey ? (
            'Kept in your keychain.'
          ) : (
            <>
              Needed to generate.{' '}
              <ExternalLink href={LINKS.geminiKey} className="hover:text-chalk">
                Free from Google AI Studio
              </ExternalLink>
            </>
          )
        }
        action={
          !hasApiKey && (
            <button onClick={() => openSettings(true)} className="btn-secondary px-2.5 py-1.5">
              Add key
            </button>
          )
        }
      />
      <Row
        done={ankiReady}
        waiting={ankiStatus === 'checking' || ankiStatus === 'unknown'}
        title={ankiReady ? 'Anki is connected' : 'Open Anki with AnkiConnect'}
        note={
          ankiReady ? (
            'Cards can be sent.'
          ) : (
            <>
              Needed to send cards, not to generate them.{' '}
              <ExternalLink href={LINKS.ankiConnect} className="hover:text-chalk">
                Get AnkiConnect
              </ExternalLink>
            </>
          )
        }
        action={
          !ankiReady && (
            <button
              onClick={() => void refreshAnki()}
              disabled={ankiStatus === 'checking'}
              className="btn-secondary px-2.5 py-1.5"
            >
              {ankiStatus === 'checking' ? 'Checking…' : 'Check again'}
            </button>
          )
        }
      />
    </div>
  )
}

function Row({
  done,
  waiting = false,
  title,
  note,
  action,
}: {
  done: boolean
  waiting?: boolean
  title: string
  note: ReactNode
  action: ReactNode
}) {
  const dot = done ? 'bg-sage' : waiting ? 'bg-chalk-dim animate-pulse' : 'bg-brick-soft'
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span aria-hidden className={`mt-1 size-1.5 shrink-0 self-start rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-xs ${done ? 'text-chalk-dim' : 'text-chalk'}`}>{title}</p>
        <p className="text-chalk-dim mt-0.5 text-2xs">{note}</p>
      </div>
      {action}
    </div>
  )
}
