import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { launch } from './launch.ts'
import { lecture, writeCourse } from './course-fixture.ts'

/**
 * Pictures of the lecture rings in awkward cases, in light and dark, from a course written
 * straight into the course folder.
 *
 *   LECTERN_SHOTS=<folder>  where the pictures go. Without it this file is skipped.
 */
const out = process.env.LECTERN_SHOTS ? resolve(process.env.LECTERN_SHOTS) : null

test.skip(!out, 'Set LECTERN_SHOTS to a folder to take the pictures.')

const LONG = 'Wahrscheinlichkeitsrechnungsgrundlagen'

async function shoot(page: Page, name: string): Promise<void> {
  for (const mode of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: mode })
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(out!, `${name}-${mode}.png`) })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

test('the rings in awkward cases', async () => {
  await mkdir(out!, { recursive: true })
  const courses = await writeCourse([lecture(1, LONG, 3, 3), lecture(2, 'Effectuation', 4, 4)])
  const { app, page } = await launch({ courses })
  try {
    await page.getByPlaceholder('sk-...').fill('sk-offline')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.locator('.course-card').first().click()

    await page.getByRole('button', { name: /Open lecture 01/ }).click()
    await expect(page.getByRole('button', { name: /^All cards of lecture 01/ })).toBeVisible()
    await page.waitForTimeout(1500)
    await page.mouse.move(5, 300)
    await shoot(page, 'map-long-title')

    // The smallest window the app allows, the panel open, four topics of four concepts.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(900, 600),
    )
    await page.getByRole('button', { name: /Go to lecture 02/ }).click()
    await expect(page.getByRole('button', { name: /^All cards of lecture 02/ })).toBeVisible()
    await page.mouse.move(5, 300)
    await page.waitForTimeout(1500)
    await shoot(page, 'map-small-window')
  } finally {
    await app.close()
  }
})
