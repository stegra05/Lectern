import { useEffect, useRef } from 'react'
import { plural } from '../lecture.ts'
import { aboutCard, DesignCarousel } from '../screens/DesignCarousel.tsx'
import { unsentCount, useStore } from '../store.ts'
import './choice.css'

/**
 * Before the first send, once: the six card designs on a card of the course. Taking one makes
 * it the design of all courses and sends the cards.
 */
export function CardChoice() {
  const course = useStore((s) => s.course)
  const settings = useStore((s) => s.settings)
  const choosing = useStore((s) => s.choosing)
  const chooseAndSend = useStore((s) => s.chooseAndSend)
  const cancelChoice = useStore((s) => s.cancelChoice)
  const take = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!choosing) return
    // In a low window the sheet scrolls. The focus must not scroll its heading away.
    take.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelChoice()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [choosing, cancelChoice])

  if (!choosing || !course || !settings) return null
  const about = aboutCard(course)

  return (
    <div className="choice-veil" onClick={cancelChoice}>
      <div
        className="choice"
        role="dialog"
        aria-modal="true"
        aria-labelledby="choice-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="choice-head">
          <h2 id="choice-title" className="t-title">
            Choose how your cards look
          </h2>
          <p className="t-secondary">{about}, as it will look in Anki. Six designs to browse.</p>
        </header>
        <DesignCarousel
          current={settings.design}
          course={course}
          width={250}
          height={330}
          footer={(design) => (
            <footer className="choice-foot">
              <p className="t-secondary">You can change this later in Settings.</p>
              <button type="button" className="btn" onClick={cancelChoice}>
                Cancel
              </button>
              <button
                type="button"
                ref={take}
                className="btn btn-primary"
                onClick={() => void chooseAndSend(design.id)}
              >
                Use this design and send {plural(unsentCount(course), 'card')}
              </button>
            </footer>
          )}
        />
      </div>
    </div>
  )
}
