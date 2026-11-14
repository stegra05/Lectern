import { useState, type FormEvent } from 'react'
import { version } from '../../../../package.json'
import appIcon from '../assets/icon.svg'
import appIconDark from '../assets/icon-dark.svg'
import type { CourseView, Design } from '../../../shared/contract.ts'
import { CARD_DESIGNS } from '../cards/designs.ts'
import { DesignCarousel } from './DesignCarousel.tsx'
import { useStore } from '../store.ts'
import { Icon, type IconName } from '../ui/Icon.tsx'
import { TitleBar } from '../ui/TitleBar.tsx'
import './settings.css'

type Section = 'design' | 'provider' | 'about'

export function Settings() {
  const settings = useStore((s) => s.settings)
  const course = useStore((s) => s.course)
  const back = useStore((s) => s.back)
  const closeSettings = useStore((s) => s.closeSettings)
  const [section, setSection] = useState<Section>('design')
  if (!settings) return null

  const design = CARD_DESIGNS.find((d) => d.id === settings.design) ?? CARD_DESIGNS[0]!
  const sections: { id: Section; icon: IconName; name: string; detail: string }[] = [
    { id: 'design', icon: 'card', name: 'Card design', detail: design.name },
    {
      id: 'provider',
      icon: 'key',
      name: 'AI provider',
      detail: settings.hasKey ? 'OpenAI, key stored' : 'OpenAI, no key yet',
    },
    { id: 'about', icon: 'info', name: 'About', detail: `Version ${version}` },
  ]

  return (
    <div className="set">
      <TitleBar centre={<span className="set-window-title">Settings</span>} />
      <nav className="set-nav" aria-label="Settings sections">
        <button type="button" className="set-back" onClick={closeSettings}>
          <Icon name="chevronLeft" size={13} stroke={1.8} />
          <span>{back === 'course' && course ? course.name : 'Courses'}</span>
        </button>
        <h1 className="t-title set-nav-title">Settings</h1>
        <ul className="set-sections">
          {sections.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="set-section"
                aria-current={section === s.id ? 'page' : undefined}
                onClick={() => setSection(s.id)}
              >
                <span className="set-section-icon">
                  <Icon name={s.icon} size={17} stroke={1.4} />
                </span>
                <span className="set-section-text">
                  <b>{s.name}</b>
                  <span>{s.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="set-nav-foot">Changes save on their own.</p>
      </nav>
      <main className="set-main">
        {section === 'design' && <DesignPane current={settings.design} course={course} />}
        {section === 'provider' && <ProviderPane hasKey={settings.hasKey} />}
        {section === 'about' && <AboutPane />}
      </main>
    </div>
  )
}

/* ---------- Card design ---------- */

function DesignPane({ current, course }: { current: Design; course: CourseView | null }) {
  const setDesign = useStore((s) => s.setDesign)
  const restyleFailure = useStore((s) => s.restyleFailure)
  const [busy, setBusy] = useState(false)

  const use = async (design: Design) => {
    setBusy(true)
    try {
      await setDesign(design)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="set-head">
        <h2 className="t-title">Card design</h2>
        <p className="t-secondary">
          Applies to all your courses. Cards already in Anki change their look too; their wording
          and your progress stay.
        </p>
      </header>
      {restyleFailure && (
        <div className="set-key-failed" role="alert">
          <Icon name="warning" size={14} stroke={1.6} />
          <p>
            <b>{restyleFailure.message}</b> New cards will use this design. To change the cards
            already in Anki, open Anki and choose the design again.
          </p>
        </div>
      )}
      <section className="set-group set-designs" aria-labelledby="set-design-name">
        <DesignCarousel
          current={current}
          course={course}
          width={300}
          height={410}
          action={(design) =>
            design.id === current && !restyleFailure ? (
              <span className="set-in-use">
                <Icon name="check" size={14} stroke={1.9} />
                In use
              </span>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void use(design.id)}
              >
                Use this design
              </button>
            )
          }
        />
      </section>
    </>
  )
}

/* ---------- AI provider ---------- */

function ProviderPane({ hasKey }: { hasKey: boolean }) {
  const saveKey = useStore((s) => s.saveKey)
  const [key, setKey] = useState('')
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'busy' }
    | { kind: 'saved' }
    | { kind: 'failed'; message: string; fix: string }
  >({ kind: 'idle' })

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
    <>
      <header className="set-head">
        <h2 className="t-title">AI provider</h2>
        <p className="t-secondary">
          Lectern sends your slides to OpenAI to write your cards, using your own key.
        </p>
      </header>
      <div className="set-group set-rows">
        <div className="set-row">
          <span>Provider</span>
          <span className="t-secondary">OpenAI</span>
        </div>
        <div className="set-row">
          <span>Key</span>
          {hasKey ? (
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
          {hasKey ? 'Replace the key' : 'Add your key'}
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
    </>
  )
}

/* ---------- About ---------- */

function AboutPane() {
  return (
    <>
      <header className="set-head">
        <h2 className="t-title">About</h2>
      </header>
      <div className="set-group set-about">
        <picture>
          <source srcSet={appIconDark} media="(prefers-color-scheme: dark)" />
          <img src={appIcon} width={96} height={96} alt="" />
        </picture>
        <span className="t-heading">Lectern</span>
        <span className="t-secondary num">Version {version}</span>
      </div>
    </>
  )
}
