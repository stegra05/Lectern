import { expect, test, type Page } from '@playwright/test'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './launch.ts'
import { makePdf } from './pdf.ts'

/**
 * Pictures of what the store keeps for the student, in light, from the running app.
 *
 *   LECTERN_SHOTS=<folder>  where the pictures go. Without it this file is skipped.
 */
const out = process.env.LECTERN_SHOTS ? resolve(process.env.LECTERN_SHOTS) : null

test.skip(!out, 'Set LECTERN_SHOTS to a folder to take the pictures.')

async function shoot(page: Page, name: string): Promise<void> {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out!, `${name}-light.png`) })
}

test('a build that failed while the student was on the list', async () => {
  await mkdir(out!, { recursive: true })
  const courses = await mkdtemp(join(tmpdir(), 'lectern-shots-'))
  const folder = join(courses, 'Statistics')
  await mkdir(join(folder, 'slides'), { recursive: true })
  await writeFile(
    join(folder, 'course.json'),
    JSON.stringify({ format: 1, name: 'Statistics', goal: 'good', lectures: [] }),
  )
  await writeFile(join(folder, 'slides', '01.pdf'), await makePdf([['Lecture'], ['Slide']]))
  const { app, page } = await launch({ courses, delayMs: 400 })
  try {
    await page.getByPlaceholder('sk-...').fill('sk-offline')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.locator('.course-card').first().click()
    await expect(page.getByRole('button', { name: 'Make my cards' })).toBeVisible()
    // The build cannot write its result, so it fails while the student waits on the list.
    await chmod(folder, 0o555)
    await page.getByRole('button', { name: 'Make my cards' }).click()
    await page.getByRole('button', { name: 'Courses' }).first().click()
    await expect(page.locator('.course-card')).toHaveCount(1)
    await page.waitForTimeout(4000)
    await chmod(folder, 0o755)
    await page.locator('.course-card').first().click()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await shoot(page, 'failure-kept-for-course')
  } finally {
    await chmod(folder, 0o755)
    await app.close()
  }
})
