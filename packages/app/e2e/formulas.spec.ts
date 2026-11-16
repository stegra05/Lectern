import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch } from './launch.ts'
import { LECTURES, makePdf } from './pdf.ts'

test('a formula card is typeset in the side panel, offline', async () => {
  const { app, page } = await launch()
  try {
    await page.getByPlaceholder('sk-...').fill('sk-offline-test')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'New course' }).click()
    await page.getByLabel('Name of the new course').fill('Entrepreneurship')
    await page.keyboard.press('Enter')
    const folder = test.info().outputPath('Entrepreneurship')
    await mkdir(folder, { recursive: true })
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

    const card = panel.getByRole('listitem').filter({ hasText: 'Yours' })
    await expect(card.locator('.katex')).toHaveCount(2)
    await expect(card.locator('.katex-display')).toHaveCount(1)
    await expect(card).not.toContainText('\\(')
    await expect(card).not.toContainText('\\[')
    // The formula is drawn in the colour of the text around it.
    const colours = await card.evaluate((row) => [
      getComputedStyle(row.querySelector('.cards-back')!).color,
      getComputedStyle(row.querySelector('.katex-display .katex')!).color,
    ])
    expect(colours[1]).toBe(colours[0])
  } finally {
    await app.close()
  }
})
