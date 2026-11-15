import { useState, type FormEvent } from 'react'
import type { Failure } from '../store.ts'
import { useStore } from '../store.ts'
import { Icon } from '../ui/Icon.tsx'
import { TitleBar } from '../ui/TitleBar.tsx'
import { MiniTrack } from './Courses.tsx'
import './entry.css'

/** The emblem above the welcome: a course of five lectures, the shape every course takes. */
const EMBLEM = [1, 2, 3, 4, 5]

/** Shown once, while no key is stored: what Lectern does, then the provider and the key. */
export function FirstRun() {
  const saveKey = useStore((s) => s.saveKey)
  const openCourses = useStore((s) => s.openCourses)
  const [key, setKey] = useState('')
  const [shown, setShown] = useState(false)
  const [checking, setChecking] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = key.trim()
    if (!trimmed || checking) return
    setChecking(true)
    setFailure(null)
    const result = await saveKey(trimmed)
    if (result.ok) {
      await openCourses()
      return
    }
    setChecking(false)
    setFailure({ message: result.message, fix: result.fix })
  }

  return (
    <div className="entry">
      <TitleBar centre={<span className="entry-wintitle">Lectern</span>} />
      <main className="entry-scroll">
        <div className="first-wrap">
          <form className="first" onSubmit={(event) => void submit(event)} noValidate>
            <div className="first-emblem">
              <MiniTrack lectures={EMBLEM} pending={[]} perRow={5} animate />
            </div>
            <h1 className="t-title">Welcome to Lectern</h1>
            <p className="first-lede">
              State your goal for a course once. Lectern turns your lecture slides into one Anki
              deck for it, with every card checked against the slides, so you can trust it without
              reading every card.
            </p>

            <section className="first-section" aria-labelledby="first-provider">
              <h2 id="first-provider" className="entry-label">
                AI provider
              </h2>
              <div className="group" role="radiogroup" aria-labelledby="first-provider">
                <div className="first-row" role="radio" aria-checked="true">
                  <span className="first-radio" aria-hidden="true" />
                  <span className="first-row-name">OpenAI</span>
                </div>
              </div>
              <p className="entry-note">Other providers follow in a later version.</p>
            </section>

            <section className="first-section">
              <label htmlFor="first-key" className="entry-label">
                OpenAI API key
              </label>
              <div className="group">
                <div className="first-key">
                  <Icon name="key" size={14} />
                  <input
                    id="first-key"
                    className="first-key-input mono"
                    type={shown ? 'text' : 'password'}
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    placeholder="sk-..."
                    spellCheck={false}
                    autoComplete="off"
                    autoFocus
                    readOnly={checking}
                    aria-invalid={failure !== null}
                    aria-describedby={failure ? 'first-failure' : 'first-key-help'}
                  />
                  <button
                    type="button"
                    className="btn btn-quiet btn-accent first-show"
                    onClick={() => setShown(!shown)}
                    aria-pressed={shown}
                  >
                    {shown ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              {failure ? (
                <div id="first-failure" className="entry-failure" role="alert">
                  <Icon name="warning" size={14} />
                  <p>
                    <b>{failure.message}</b> {failure.fix}
                  </p>
                </div>
              ) : (
                <p id="first-key-help" className="entry-note">
                  The key lets Lectern use OpenAI with your own account, and OpenAI bills you
                  directly. Create one at <b className="mono">platform.openai.com</b> under API keys
                  and paste it here. It stays on this computer, in the system's protected storage.
                </p>
              )}
            </section>

            <div className="first-actions">
              {checking && (
                <span className="first-busy" role="status">
                  <span className="entry-spinner" aria-hidden="true" />
                  Checking the key with OpenAI
                </span>
              )}
              <button type="submit" className="btn btn-primary" disabled={checking || !key.trim()}>
                Continue
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
