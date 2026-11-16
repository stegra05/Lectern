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

test('pictures of course cards of every length', async () => {
  await mkdir(out!, { recursive: true })
  const courses = await mkdtemp(join(tmpdir(), 'lectern-shots-'))
  const lengths = {
    Ethics: 1,
    Statistics: 5,
    'Linear Algebra': 12,
    Marketing: 30,
    'Entrepreneurship and Innovation Management': 60,
  }
  for (const [i, [name, count]] of Object.entries(lengths).entries()) {
    // The last two lectures of a course are PDFs still waiting for cards.
    const built = count > 1 ? count - 2 : count
    const id = `course-${i}`
    const lectures = Array.from({ length: built }, (_, n) => ({
      number: n + 1,
      title: `Lecture ${n + 1}`,
      file: `${String(n + 1).padStart(2, '0')}.pdf`,
      sha256: '',
      slides: 1,
    }))
    await mkdir(join(courses, id, 'slides'), { recursive: true })
    await writeFile(
      join(courses, id, 'course.json'),
      JSON.stringify({ format: 1, name, goal: 'good', lectures }),
    )
    for (let n = 1; n <= count; n++)
      await writeFile(join(courses, id, 'slides', `${String(n).padStart(2, '0')}.pdf`), '')
  }
  const { app, page } = await launch({ courses })
  try {
    await page.getByPlaceholder('sk-...').fill('sk-offline')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.locator('.course-card')).toHaveCount(5)
    await shoot(page, '02-courses-lengths-1100x720')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(900, 600),
    )
    await shoot(page, '02-courses-lengths-900x600')
    await page.locator('.course-card').last().scrollIntoViewIfNeeded()
    await shoot(page, '02-courses-lengths-900x600-scrolled')
  } finally {
    await app.close()
  }
})

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
  const { app, page } = await launch({ courses, delayMs: 600 })

  try {
    await expect(page.getByRole('heading', { name: 'Welcome to Lectern' })).toBeVisible()
    // The small track at the top draws itself once.
    await page.waitForTimeout(2000)
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
      await expect(page.getByRole('heading', { name: 'What it cost' })).toBeVisible()
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
      await expect(page.getByRole('heading', { name: 'Your OpenAI key' })).toBeVisible()
      await shoot(page, '11-settings')
      await page.getByRole('button', { name: 'Entrepreneurship', exact: true }).click()
      await page.getByRole('button', { name: 'Courses' }).click()
    }

    await page.getByRole('button', { name: 'New course' }).first().click()
    await page
      .getByLabel('Name of the new course')
      .fill(real ? 'Entrepreneurship, new' : 'Entrepreneurship')
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('Lecture PDFs', { exact: true })).toBeAttached()
    await shoot(page, '03-course-empty')

    if (real) {
      const slides = join(real, 'slides')
      const names = (await readdir(slides)).filter((name) => name.endsWith('.pdf')).sort()
      await page
        .getByLabel('Lecture PDFs', { exact: true })
        .setInputFiles(names.map((name) => join(slides, name)))
    } else {
      const files = await Promise.all(
        Object.entries(LECTURES).map(async ([name, lecture]) => ({
          name,
          mimeType: 'application/pdf',
          buffer: await makePdf(lecture),
        })),
      )
      await page.getByLabel('Lecture PDFs', { exact: true }).setInputFiles(files)
    }
    await expect(page.getByRole('heading', { name: 'I am aiming for' })).toBeVisible({
      timeout: 120_000,
    })

    await page.getByRole('button', { name: 'Courses' }).click()
    await expect(page.getByRole('heading', { name: 'Courses' })).toBeVisible()
    await shoot(page, '02-courses')
    await page.locator('.course-card').last().click()

    await page.getByRole('button', { name: 'a top grade' }).click()
    await expect(page.getByRole('region', { name: 'Status' })).toContainText(
      /About [\d,]+ (cents|€)|Under 5 cents|No cost/,
      {
        timeout: 60_000,
      },
    )
    await shoot(page, '04-files-and-goal')

    await page.getByRole('button', { name: 'Make my cards' }).click()
    // Midway: the cards are being written. The offline models answer fast, so the page is
    // watched every 10 ms: a slower check lets the whole phase go by.
    await page.waitForFunction(
      () =>
        /\d+ of about \d+/.test(
          document.querySelector('[aria-label="What Lectern is doing"]')?.textContent ?? '',
        ),
      undefined,
      { polling: 10, timeout: 60_000 },
    )
    await shoot(page, '05-run-midway')
  } finally {
    await app.close()
  }
})

test('picture of a formula card in the side panel', async () => {
  await mkdir(out!, { recursive: true })
  const { app, page } = await launch()
  try {
    await page.getByPlaceholder('sk-...').fill('sk-offline')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'New course' }).click()
    await page.getByLabel('Name of the new course').fill('Entrepreneurship')
    await page.keyboard.press('Enter')
    const folder = await mkdtemp(join(tmpdir(), 'lectern-shots-'))
    for (const [name, slides] of Object.entries(LECTURES))
      await writeFile(join(folder, name), await makePdf(slides))
    await page.getByLabel('Folder of lecture PDFs').setInputFiles(folder)
    await page.getByRole('button', { name: 'Make my cards' }).click()
    await expect(page.getByRole('region', { name: 'Status' })).toContainText(/\d+ cards/, {
      timeout: 60_000,
    })
    await page.getByRole('button', { name: /^(Open|Go to) lecture 02/ }).click()
    const panel = page.getByRole('complementary')
    await page.getByRole('button', { name: /^Affordable loss, \d+ cards?$/ }).click()
    await panel.getByRole('button', { name: 'Add your own card' }).click()
    await panel.getByLabel('Question').fill('What is the energy of a mass \\(m\\)?')
    await panel.getByLabel('Answer').fill('Energy is \\[ E = mc^2 \\]')
    await panel.getByLabel('Key term, in bold').fill('Energy')
    await panel.getByRole('button', { name: 'Add card' }).click()
    await expect(panel.locator('.katex-display')).toBeVisible()
    await shoot(page, '09-formula-card')
  } finally {
    await app.close()
  }
})

test('pictures of a course folder added whole', async () => {
  await mkdir(out!, { recursive: true })
  const folder = await mkdtemp(join(tmpdir(), 'lectern-shots-folder-'))
  const [first, second] = Object.entries(LECTURES)
  await mkdir(join(folder, 'Week 2'), { recursive: true })
  await mkdir(join(folder, 'Übungen'), { recursive: true })
  await writeFile(join(folder, first![0]), await makePdf(first![1]))
  await writeFile(join(folder, 'Week 2', second![0]), await makePdf(second![1]))
  await writeFile(join(folder, 'Übungen', 'Blatt 1.pdf'), await makePdf([['Name three risks']]))
  await writeFile(join(folder, 'Week 3.pptx'), 'not a pdf')
  await writeFile(join(folder, 'Scan.pdf'), await makePdf([[]]))
  // Each decision takes a while, so the sort stays on screen long enough for its picture.
  const { app, page } = await launch({ delayMs: 4000 })

  try {
    await page.getByPlaceholder('sk-...').fill('sk-offline')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'New course' }).first().click()
    await page.getByLabel('Name of the new course').fill('Entrepreneurship')
    await page.keyboard.press('Enter')
    await page.getByLabel('Folder of lecture PDFs').setInputFiles(folder)
    await expect(page.getByRole('region', { name: 'Status' })).toContainText(
      'Looking at your files',
    )
    await shoot(page, '12-folder-adding')
    const panel = page.getByRole('complementary')
    await expect(panel.getByRole('heading', { name: 'Left out' })).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(1500)
    await shoot(page, '13-folder-left-out')

    await panel.getByRole('button', { name: 'Add Blatt 1 as a lecture' }).click()
    await expect(page.getByRole('img', { name: /Lecture 03 Blatt 1/ })).toBeVisible()
    await panel.getByText('Lecture files').click()
    await page.waitForTimeout(1500)
    await shoot(page, '14-lecture-files-moves')
  } finally {
    await app.close()
  }
})
