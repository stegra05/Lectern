import { expect, test } from '@playwright/test'
import { launch, type Launched } from './launch.ts'
import { LECTURES, makePdf } from './pdf.ts'

/**
 * The whole way of a student through the base product, on the offline models: first run,
 * a new course, two lecture PDFs, the goal, the run with the engine's phases, the result on
 * the track, a lecture as rings, and the cards of a concept in the side panel.
 */
let launched: Launched

test.beforeAll(async () => {
  // A short delay per model call keeps the run on screen long enough to be seen.
  launched = await launch({ delayMs: 80 })
})

test.afterAll(async () => {
  await launched.app.close()
})

test('from creating a course to its cards in the side panel', async () => {
  const { page } = launched

  await test.step('first run: provider and key', async () => {
    await expect(page.getByRole('heading', { name: 'Welcome to Lectern' })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'OpenAI' })).toBeChecked()
    await page.getByPlaceholder('sk-...').fill('sk-offline-test')
    await page.getByRole('button', { name: 'Continue' }).click()
  })

  await test.step('courses: create one', async () => {
    await expect(page.getByRole('heading', { name: 'Start your first course' })).toBeVisible()
    await page.getByRole('button', { name: 'New course' }).click()
    await page.getByLabel('Name of the new course').fill('Entrepreneurship')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('navigation', { name: 'Location' })).toContainText(
      'Entrepreneurship',
    )
  })

  await test.step('files: two lectures land on the track, the goal is asked', async () => {
    const files = await Promise.all(
      Object.entries(LECTURES).map(async ([name, slides]) => ({
        name,
        mimeType: 'application/pdf',
        buffer: await makePdf(slides),
      })),
    )
    await page.locator('input[type=file]').setInputFiles(files)
    await expect(page.getByRole('img', { name: /Lecture 01 Introduction, 4 slides/ })).toBeVisible()
    await expect(page.getByRole('img', { name: /Lecture 02 Effectuation, 4 slides/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'I am aiming for' })).toBeVisible()
    await page.getByRole('button', { name: 'a top grade' }).click()
    await expect(page.getByRole('button', { name: 'a top grade' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  await test.step('the run: the engine’s four phases', async () => {
    await page.getByRole('button', { name: 'Make my cards' }).click()
    const phases = page.getByRole('list', { name: 'What Lectern is doing' })
    await expect(phases.getByRole('listitem')).toHaveCount(4)
    await expect(phases).toContainText('Read')
    await expect(phases).toContainText('Writ')
    await expect(phases).toContainText('Check')
  })

  await test.step('the result: cards on the track', async () => {
    const status = page.getByRole('region', { name: 'Status' })
    await expect(status).toContainText(/\d+ cards/, { timeout: 60_000 })
    await expect(status).toContainText('2 lectures')
    await expect(page.getByRole('button', { name: /Open lecture 01/ })).toBeVisible()
  })

  await test.step('a lecture as rings, its cards in the side panel', async () => {
    await page.getByRole('button', { name: /Open lecture 02/ }).click()
    const panel = page.getByRole('complementary')
    await expect(panel).toContainText('Effectuation')
    await page.getByRole('button', { name: /Affordable loss/ }).click()
    await expect(panel.getByRole('heading', { name: 'Affordable loss' })).toBeVisible()
    const cards = panel.getByRole('listitem')
    await expect(cards.first()).toBeVisible()
    expect(await cards.count()).toBeGreaterThan(0)
    // The card is made of the slide's own words.
    await expect(panel).toContainText('afford to lose')
  })
})
