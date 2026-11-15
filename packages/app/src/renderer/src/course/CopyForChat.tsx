import { useEffect, useState } from 'react'
import { cardCount, useStore } from '../store.ts'
import { Icon } from '../ui/Icon.tsx'
import './copy.css'

/** The course outline from the engine, or the engine's reason it could not give one. */
async function outline(course: string): Promise<{ markdown: string } | { fix: string }> {
  let markdown: string | null = null
  let fix = 'Try again in a moment.'
  await window.lectern.run({ type: 'outline', course }, (event) => {
    if (event.type === 'outline') markdown = event.markdown
    if (event.type === 'failed') fix = event.fix
  })
  return markdown === null ? { fix } : { markdown }
}

function tutoring(name: string, markdown: string): string {
  return [
    `I am studying the course "${name}" and want you to be my tutor for it.`,
    'Below is the course as an outline: its lectures, topics and concepts, with the flashcards I study from.',
    'Explain concepts from it when I ask. Make practice questions. When you quiz me, ask one question at a time and do not give the answer away before I have tried.',
    "Stay with the course's own terms and definitions, even where other sources use different ones.",
    '',
    markdown,
  ].join('\n')
}

type State =
  { kind: 'idle' } | { kind: 'copying' } | { kind: 'copied' } | { kind: 'failed'; fix: string }

/** Copies the course with a short tutoring prompt, ready to paste into a chat assistant. */
export function CopyForChat() {
  const course = useStore((s) => s.course)
  const panelOpen = useStore((s) => s.panel !== null)
  const [state, setState] = useState<State>({ kind: 'idle' })

  useEffect(() => {
    if (state.kind !== 'copied' && state.kind !== 'failed') return
    const id = setTimeout(() => setState({ kind: 'idle' }), state.kind === 'copied' ? 1800 : 5000)
    return () => clearTimeout(id)
  }, [state])

  if (!course || cardCount(course) === 0) return null

  async function copy() {
    if (!course) return
    setState({ kind: 'copying' })
    const result = await outline(course.id)
    if ('fix' in result) {
      setState({ kind: 'failed', fix: result.fix })
      return
    }
    try {
      await navigator.clipboard.writeText(tutoring(course.name, result.markdown))
      setState({ kind: 'copied' })
    } catch {
      setState({ kind: 'failed', fix: 'Click the window once, then copy again.' })
    }
  }

  return (
    <>
      <button
        type="button"
        className="panel-copy material"
        data-panel={panelOpen}
        disabled={state.kind === 'copying'}
        title="Copy the course and a tutoring prompt for a chat assistant"
        onClick={() => void copy()}
      >
        <Icon name={state.kind === 'copied' ? 'check' : 'chat'} size={15} stroke={1.4} />
        <span aria-live="polite">{state.kind === 'copied' ? 'Copied' : 'Copy for chat'}</span>
      </button>
      {state.kind === 'failed' && (
        <p role="alert" className="panel-copy-note material" data-panel={panelOpen}>
          <b>Could not copy.</b> {state.fix}
        </p>
      )}
    </>
  )
}
