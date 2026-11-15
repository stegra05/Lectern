import { useStore } from '../store.ts'
import { Icon } from '../ui/Icon.tsx'
import { CardsPanel } from './panels/CardsPanel.tsx'
import { DetailsPanel } from './panels/DetailsPanel.tsx'
import { RunPanel } from './panels/RunPanel.tsx'
import { SetupPanel } from './panels/SetupPanel.tsx'
import './panel.css'

/** The one floating panel on the right. It shows what the store names, or nothing. */
export function SidePanel() {
  const panel = useStore((s) => s.panel)
  const course = useStore((s) => s.course)
  const closePanel = useStore((s) => s.closePanel)
  const runPanelEmpty = useStore((s) => s.panel === 'run' && !s.run && !s.failure)
  // The run panel has nothing to say between runs unless a run failed.
  if (!panel || !course || runPanelEmpty) return null

  const close = (
    <button type="button" className="panel-close" aria-label="Close the panel" onClick={closePanel}>
      <Icon name="close" size={10} stroke={1.8} />
    </button>
  )

  return (
    // The key restarts the slide-in when the panel changes to another kind.
    <aside id="side-panel" key={panel} className="panel material" aria-label={LABELS[panel]}>
      {panel === 'setup' && <SetupPanel close={close} />}
      {panel === 'run' && <RunPanel close={close} />}
      {panel === 'cards' && <CardsPanel close={close} />}
      {panel === 'details' && <DetailsPanel close={close} />}
    </aside>
  )
}

const LABELS = {
  setup: 'Before your cards',
  run: 'Making your cards',
  cards: 'Cards',
  details: 'Course details',
} as const
