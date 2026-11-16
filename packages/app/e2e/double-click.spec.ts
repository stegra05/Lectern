import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch } from './launch.ts'
import { LECTURES, makePdf } from './pdf.ts'

test('a double click on Make my cards leaves the run panel open', async () => {
  const { app, page } = await launch({ delayMs: 80 })
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
    await expect(page.getByRole('heading', { name: 'I am aiming for' })).toBeVisible()

    await page.getByRole('button', { name: 'Make my cards' }).dblclick()
    const phases = page.getByRole('list', { name: 'What Lectern is doing' })
    await expect(phases).toBeVisible()
    // Past the second click and the render after it, the panel is still there.
    await page.waitForTimeout(500)
    await expect(phases).toBeVisible()
  } finally {
    await app.close()
  }
})
