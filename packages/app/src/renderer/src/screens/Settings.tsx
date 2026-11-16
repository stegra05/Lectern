import { useState, type FormEvent } from 'react'
import { version } from '../../../../package.json'
import appIcon from '../assets/icon.svg'
import appIconDark from '../assets/icon-dark.svg'
import { useStore } from '../store.ts'
import { Icon } from '../ui/Icon.tsx'
import { TitleBar } from '../ui/TitleBar.tsx'
import './settings.css'

/** One page: the OpenAI key, then the version. */
export function Settings() {
  const settings = useStore((s) => s.settings)
  const course = useStore((s) => s.course)
  const back = useStore((s) => s.back)
  const closeSettings = useStore((s) => s.closeSettings)
  const saveKey = useStore((s) => s.saveKey)
  const [key, setKey] = useState('')
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'busy' }
    | { kind: 'saved' }
    | { kind: 'failed'; message: string; fix: string }
  >({ kind: 'idle' })
  if (!settings) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!key.trim() || state.kind === 'busy') return
    setState({ kind: 'busy' })
    const result = await saveKey(key.trim())
    if (result.ok) {
      setKey('')
      setState({ kind: 'saved' })
    } else {
      setState({ kind: 'failed', message: result.message, fix: result.fix })
    }
  }

  return (
    <div className="set">
      <TitleBar
        left={
          <button type="button" className="set-back" onClick={closeSettings}>
            <Icon name="chevronLeft" size={13} stroke={1.8} />
            <span>{back === 'course' && course ? course.name : 'Courses'}</span>
          </button>
        }
        centre={<span className="set-window-title">Settings</span>}
      />
      <main className="set-main">
        <header className="set-head">
          <h1 className="t-title">Your OpenAI key</h1>
          <p className="t-secondary">
            Lectern sends your slides to OpenAI to write your cards, using your own key.
          </p>
        </header>
        <div className="set-group set-rows">
          <div className="set-row">
            <span>Key</span>
            {settings.hasKey ? (
              <span className="set-key-ok">
                <Icon name="check" size={13} stroke={1.9} />
                Stored on this computer
              </span>
            ) : (
              <span className="t-secondary">No key stored</span>
            )}
          </div>
        </div>
        <form className="set-group set-key" onSubmit={(e) => void submit(e)}>
          <label htmlFor="set-key-input" className="set-key-label">
            {settings.hasKey ? 'Replace the key' : 'Add your key'}
          </label>
          <div className="set-key-line">
            <input
              id="set-key-input"
              className="field"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-..."
              value={key}
              disabled={state.kind === 'busy'}
              onChange={(e) => {
                setKey(e.target.value)
                if (state.kind !== 'busy') setState({ kind: 'idle' })
              }}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!key.trim() || state.kind === 'busy'}
            >
              {state.kind === 'busy' ? 'Checking key' : 'Save key'}
            </button>
          </div>
          <p className="set-key-note" role="status" hidden={state.kind === 'failed'}>
            {state.kind === 'busy' && 'Checking the key with OpenAI.'}
            {state.kind === 'saved' && 'OpenAI accepted the key. It is stored and in use.'}
            {state.kind === 'idle' && 'Lectern checks the key with OpenAI before it stores it.'}
          </p>
          {state.kind === 'failed' && (
            <div className="set-key-failed" role="alert">
              <Icon name="warning" size={14} stroke={1.6} />
              <p>
                <b>{state.message}</b> {state.fix}
              </p>
            </div>
          )}
        </form>
        <div className="set-group set-about">
          <picture>
            <source srcSet={appIconDark} media="(prefers-color-scheme: dark)" />
            <img src={appIcon} width={96} height={96} alt="" />
          </picture>
          <span className="t-heading">Lectern</span>
          <span className="t-secondary num">Version {version}</span>
        </div>
      </main>
    </div>
  )
}
