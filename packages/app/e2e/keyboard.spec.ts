import { expect, test, type Locator } from '@playwright/test'
import { launch, type Launched } from './launch.ts'
import { LECTURES, makePdf } from './pdf.ts'

/**
 * A student who uses the keyboard only, from a new course to a changed card. The one thing
 * that is not a key is the file dialog of the system, which the test stubs by setting the
 * files of the input behind it.
 */
let launched: Launched

test.beforeAll(async () => {
  launched = await launch()
})

test.afterAll(async () => {
  await launched.app.close()
})

test('a new course to a changed card, with the keyboard only', async () => {
  const { page } = launched
  const panel = page.getByRole('complementary')

  /** Tabs until the element has the focus. */
  const tabTo = async (target: Locator) => {
    for (let i = 0; i < 80; i++) {
      if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return
      await page.keyboard.press('Tab')
    }
    throw new Error(`Tab never reached the element`)
  }

  await test.step('first run and a new course', async () => {
    await page.getByPlaceholder('sk-...').fill('sk-offline-test')
    await tabTo(page.getByRole('button', { name: 'Continue' }))
    await page.keyboard.press('Enter')
    await tabTo(page.getByRole('button', { name: 'New course' }))
    await page.keyboard.press('Enter')
    await page.keyboard.type('Entrepreneurship')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('navigation', { name: 'Location' })).toContainText(
      'Entrepreneurship',
    )
  })

  await test.step('a lecture from the dialog, then the cards', async () => {
    const [name, slides] = Object.entries(LECTURES)[0]!
    await tabTo(page.getByRole('button', { name: 'Choose PDFs' }))
    await page
      .getByLabel('Lecture PDFs', { exact: true })
      .setInputFiles([{ name, mimeType: 'application/pdf', buffer: await makePdf(slides) }])
    await expect(panel.getByRole('button', { name: 'Add PDFs' })).toBeVisible()
    await tabTo(page.getByRole('button', { name: 'Make my cards' }))
    await page.keyboard.press('Enter')
    await expect(page.getByRole('region', { name: 'Status' })).toContainText(/\d+ cards/, {
      timeout: 60_000,
    })
  })

  await test.step('a card: the form takes the focus, Escape gives it back', async () => {
    await tabTo(page.getByRole('button', { name: /Open lecture 01/ }))
    await page.keyboard.press('Enter')
    const edit = panel.getByRole('button', { name: /^Edit the card:/ }).first()
    await tabTo(edit)
    await page.keyboard.press('Enter')
    await expect(panel.getByLabel('Question')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(panel.getByRole('heading', { name: 'Edit this card' })).toHaveCount(0)
    await expect(edit).toBeFocused()
  })

  await test.step('a card: change it and save it', async () => {
    await page.keyboard.press('Enter')
    await expect(panel.getByLabel('Question')).toBeFocused()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('What decides how much to put into a venture?')
    await tabTo(panel.getByRole('button', { name: 'Save card' }))
    await page.keyboard.press('Space')
    await expect(panel.getByRole('heading', { name: 'Edit this card' })).toHaveCount(0)
    await expect(panel).toContainText('What decides how much to put into a venture?')
    await expect(
      panel.getByRole('button', { name: /^Edit the card: What decides how much/ }),
    ).toBeFocused()
  })

  await test.step('Escape closes the panel', async () => {
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
  })
})
