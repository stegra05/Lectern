import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface Launched {
  app: ElectronApplication
  page: Page
  /** The folder that holds the courses of this launch. */
  courses: string
  /** The notes that are in the in-memory Anki now. */
  notes(): Promise<AnkiNote[]>
}

export interface AnkiNote {
  id: number
  deck: string
  fields: Record<string, string>
}

/**
 * Starts the built app on the offline models, with its own empty data folder and its window
 * hidden, so a test never touches the student's courses, key, money or desktop.
 */
export async function launch(
  options: { courses?: string; delayMs?: number } = {},
): Promise<Launched> {
  const data = await mkdtemp(join(tmpdir(), 'lectern-app-'))
  const courses = options.courses ?? join(data, 'courses')
  // In CI the window is on the virtual display, where it disturbs nobody. A window not shown
  // draws no frames there, and Playwright waits 2 s for them before every action.
  const show = Boolean(process.env.CI)
  const app = await electron.launch({
    args: [join(import.meta.dirname, '..')],
    env: {
      ...process.env,
      LECTERN_FAKE: '1',
      LECTERN_FAKE_DELAY: String(options.delayMs ?? 0),
      LECTERN_DATA: data,
      LECTERN_COURSES: courses,
      LECTERN_SHOW: show ? '1' : '0',
    },
  })
  const page = await app.firstWindow()
  // The reference size of the design kit, whatever the last window size on this computer was.
  // A window to be shown appears only after its first paint, so the test waits for it.
  await app.evaluate(async ({ BrowserWindow }, show) => {
    const window = BrowserWindow.getAllWindows()[0]
    window?.setContentSize(1100, 720)
    if (window && show && !window.isVisible())
      await new Promise<void>((resolve) => window.once('show', () => resolve()))
  }, show)
  const notes = async (): Promise<AnkiNote[]> =>
    JSON.parse(
      await readFile(join(data, 'anki-notes.json'), 'utf8').catch(() => '[]'),
    ) as AnkiNote[]
  return { app, page, courses, notes }
}
