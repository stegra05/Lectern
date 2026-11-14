import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface Launched {
  app: ElectronApplication
  page: Page
  /** The folder that holds the courses of this launch. */
  courses: string
}

/**
 * Starts the built app on the offline models, with its own empty data folder, so a test never
 * touches the student's courses, key or money.
 */
export async function launch(
  options: { courses?: string; delayMs?: number } = {},
): Promise<Launched> {
  const data = await mkdtemp(join(tmpdir(), 'lectern-app-'))
  const courses = options.courses ?? join(data, 'courses')
  const app = await electron.launch({
    args: [join(import.meta.dirname, '..')],
    env: {
      ...process.env,
      LECTERN_FAKE: '1',
      LECTERN_FAKE_DELAY: String(options.delayMs ?? 0),
      LECTERN_DATA: data,
      LECTERN_COURSES: courses,
    },
  })
  const page = await app.firstWindow()
  return { app, page, courses }
}
