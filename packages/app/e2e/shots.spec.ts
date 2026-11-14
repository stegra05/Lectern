import { expect, test, type Page } from '@playwright/test'
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './launch.ts'
import { LECTURES, makePdf } from './pdf.ts'

/**
 * Takes the pictures of every base screen, in light and dark, from the running app.
 *
 *   LECTERN_SHOTS=<folder>         where the pictures go. Without it this file is skipped.
 *   LECTERN_SHOTS_COURSE=<folder>  a finished course folder from a real run. Its result, rings,
 *                                  cards, details and settings are pictured as they are, and its
 *                                  PDFs are used for the files and run screens. Without it the
 *                                  two small test lectures stand in.
 *
 * The app runs on the offline models, so nothing here costs money. A real course is copied
 * first and only the copy is opened.
 */
const out = process.env.LECTERN_SHOTS ? resolve(process.env.LECTERN_SHOTS) : null
const real = process.env.LECTERN_SHOTS_COURSE ? resolve(process.env.LECTERN_SHOTS_COURSE) : null

test.skip(!out, 'Set LECTERN_SHOTS to a folder to take the pictures.')
test.setTimeout(15 * 60_000)

async function shoot(page: Page, name: string): Promise<void> {
  for (const mode of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: mode })
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(out!, `${name}-${mode}.png`) })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

test('pictures of every base screen', async () => {
  await mkdir(out!, { recursive: true })
  const courses = await mkdtemp(join(tmpdir(), 'lectern-shots-'))
  if (real) {
    const copy = join(courses, 'entrepreneurship')
    await cp(real, copy, { recursive: true })
    // A course built from the command line is named after its folder. The app names a course
    // when it creates one, so the copy gets the name a student would have typed.
    const file = join(copy, 'course.json')
    const course = JSON.parse(await readFile(file, 'utf8')) as { name: string }
    await writeFile(file, `${JSON.stringify({ ...course, name: 'Entrepreneurship' }, null, 2)}\n`)
  }
  const { app, page } = await launch({ courses, delayMs: 150 })

  try {
    await expect(page.getByRole('heading', { name: 'Welcome to Lectern' })).toBeVisible()
    await shoot(page, '01-first-run')
    await page.getByPlaceholder('sk-...').fill('sk-offline')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('button', { name: 'New course' }).first()).toBeVisible()

    if (real) {
      await page.locator('.course-card').first().click()
      await expect(page.getByRole('button', { name: /Open lecture 01/ })).toBeVisible()
      await shoot(page, '06-result-track')

      await page.getByRole('button', { name: 'Details' }).click()
      await expect(page.getByRole('heading', { name: 'What I decided' })).toBeVisible()
      await shoot(page, '07-details-decisions')
      await page.getByRole('button', { name: 'Statistics' }).click()
      await expect(page.getByRole('heading', { name: 'Kinds of card' })).toBeVisible()
      await shoot(page, '08-details-statistics')
      await page.getByRole('button', { name: 'Close the panel' }).click()

      await page.getByRole('button', { name: /Open lecture 02/ }).click()
      await expect(page.getByRole('complementary')).toBeVisible()
      // The slide pictures beside the cards are rendered on demand.
      await page.waitForTimeout(2500)
      await shoot(page, '09-lecture-rings')
      // The second concept on the ring, with its cards in the side panel.
      const concepts = page
        .getByRole('region')
        .getByRole('button', { name: /^(?!Open|All|Go).*, \d+ cards?$/ })
      await concepts.nth(1).click()
      await page.waitForTimeout(2500)
      await shoot(page, '10-concept-cards')

      await page.getByRole('button', { name: 'Settings' }).click()
      await expect(page.getByRole('heading', { name: 'Card design' })).toBeVisible()
      await page.waitForTimeout(800)
      await shoot(page, '11-settings-card-design')
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(800)
      await shoot(page, '12-settings-card-design-next')
      await page.getByRole('button', { name: /AI provider/ }).click()
      await shoot(page, '13-settings-provider')
      await page.getByRole('button', { name: 'Entrepreneurship', exact: true }).click()
      await page.getByRole('button', { name: 'Courses' }).click()
    }

    await page.getByRole('button', { name: 'New course' }).first().click()
    await page
      .getByLabel('Name of the new course')
      .fill(real ? 'Entrepreneurship, new' : 'Entrepreneurship')
    await page.keyboard.press('Enter')
    await expect(page.locator('input[type=file]')).toBeAttached()
    await shoot(page, '03-course-empty')

    if (real) {
      const slides = join(real, 'slides')
      const names = (await readdir(slides)).filter((name) => name.endsWith('.pdf')).sort()
      await page.locator('input[type=file]').setInputFiles(names.map((name) => join(slides, name)))
    } else {
      const files = await Promise.all(
        Object.entries(LECTURES).map(async ([name, lecture]) => ({
          name,
          mimeType: 'application/pdf',
          buffer: await makePdf(lecture),
        })),
      )
      await page.locator('input[type=file]').setInputFiles(files)
    }
    await expect(page.getByRole('heading', { name: 'I am aiming for' })).toBeVisible({
      timeout: 120_000,
    })

    await page.getByRole('button', { name: 'Courses' }).click()
    await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()
    await shoot(page, '02-courses')
    await page.locator('.course-card').last().click()

    await page.getByRole('button', { name: 'a top grade' }).click()
    await expect(page.getByRole('region', { name: 'Status' })).toContainText('About $', {
      timeout: 60_000,
    })
    await shoot(page, '04-files-and-goal')

    await page.getByRole('button', { name: 'Make my cards' }).click()
    // Midway: the cards are being written.
    await expect(page.getByRole('list', { name: 'What Lectern is doing' })).toContainText(
      /\d+ of about \d+/,
      {
        timeout: 5 * 60_000,
      },
    )
    await page.waitForTimeout(3000)
    await shoot(page, '05-run-midway')
  } finally {
    await app.close()
  }
})
