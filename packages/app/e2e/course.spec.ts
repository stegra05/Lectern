import { expect, test } from '@playwright/test'
import { launch, type Launched } from './launch.ts'
import { LATER, LECTURES, makePdf } from './pdf.ts'

/**
 * The whole way of a student through the base product, on the offline models: first run,
 * a new course, two lecture PDFs, the goal, the run with the engine's phases, the result on
 * the track, a lecture as rings, the cards of a concept in the side panel, the card design
 * before the first send, the cards in Anki, and a lecture that arrives later. Anki is the
 * one in memory, so nothing reaches a real collection.
 */
let launched: Launched

test.beforeAll(async () => {
  // A short delay per model call keeps the run on screen long enough to be seen.
  launched = await launch({ delayMs: 80 })
})

test.afterAll(async () => {
  await launched.app.close()
})

test('from creating a course to its cards in Anki, and a lecture added later', async () => {
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

  const status = page.getByRole('region', { name: 'Status' })
  /** Drops PDFs on the window, the way a finished course takes a new lecture. */
  const drop = async (lectures: Record<string, string[][]>) => {
    const files = await Promise.all(
      Object.entries(lectures).map(async ([name, slides]) => ({
        name,
        base64: (await makePdf(slides)).toString('base64'),
      })),
    )
    const dataTransfer = await page.evaluateHandle((dropped) => {
      const transfer = new DataTransfer()
      for (const { name, base64 } of dropped) {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
        transfer.items.add(new File([bytes], name, { type: 'application/pdf' }))
      }
      return transfer
    }, files)
    await page.dispatchEvent('.course-screen', 'drop', { dataTransfer })
  }
  let first = 0

  await test.step('the first send: choose the card design, then the cards are in Anki', async () => {
    await page.getByRole('button', { name: 'Whole course' }).click()
    await expect(page.getByRole('img', { name: 'In Anki, not sent yet' })).toBeVisible()
    const send = status.getByRole('button', { name: /^Send \d+ cards to Anki$/ })
    first = Number(/\d+/.exec((await send.textContent())!)![0])
    await send.click()

    const choice = page.getByRole('dialog', { name: 'Choose how your cards look' })
    await expect(choice).toContainText('Native')
    await choice.getByRole('button', { name: 'Next design: Structure' }).click()
    await expect(choice).toContainText('2 of 6')
    await choice.getByRole('button', { name: `Use this design and send ${first} cards` }).click()

    await expect(status).toContainText(`${first} cards are in Anki, in 2 subdecks`)
    await expect(page.getByRole('img', { name: `In Anki, ${first} cards` })).toBeVisible()
    await expect(status.getByRole('button', { name: /Send/ })).toHaveCount(0)
  })

  await test.step('the chosen design is the one in settings', async () => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('navigation', { name: 'Settings sections' })).toContainText(
      'Structure',
    )
    await page.getByRole('button', { name: 'Entrepreneurship' }).click()
  })

  await test.step('a lecture added later: only its cards are made and sent', async () => {
    await drop(LATER)
    await expect(page.getByRole('img', { name: /Lecture 03 Lean startup, 3 slides/ })).toBeVisible()
    await expect(status).toContainText(`${first} cards already made for 2 lectures`)
    await page.getByRole('button', { name: 'Make cards for 1 new lecture' }).click()

    const send = status.getByRole('button', { name: /^Send \d+ cards? to Anki$/ })
    await expect(send).toBeVisible({ timeout: 60_000 })
    const later = Number(/\d+/.exec((await send.textContent())!)![0])
    expect(later).toBeGreaterThan(0)
    await expect(status).toContainText(`Your ${first} cards there keep their progress`)
    await expect(
      page.getByRole('button', { name: /Open lecture 03 .* ready to send/ }),
    ).toBeVisible()

    // The design was chosen once, so this send asks nothing.
    await send.click()
    await expect(status).toContainText(`${first + later} cards are in Anki, in 3 subdecks`)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})
