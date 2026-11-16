import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './launch.ts'
import { makePdf } from './pdf.ts'

/**
 * Pictures of the lecture rings in awkward cases, in light and dark, from a course written
 * straight into the course folder.
 *
 *   LECTERN_SHOTS=<folder>  where the pictures go. Without it this file is skipped.
 */
const out = process.env.LECTERN_SHOTS ? resolve(process.env.LECTERN_SHOTS) : null

test.skip(!out, 'Set LECTERN_SHOTS to a folder to take the pictures.')

const LONG = 'Wahrscheinlichkeitsrechnungsgrundlagen'

/** A lecture of `topics` topics with `concepts` concepts each, two cards per concept. */
function lecture(number: number, title: string, topics: number, concepts: number) {
  const tree = Array.from({ length: topics }, (_, t) => ({
    name: `Topic ${t + 1}`,
    concepts: Array.from({ length: concepts }, (_, c) => ({
      id: `l${number}-t${t}-c${c}`,
      name: `Concept ${t + 1}.${c + 1}`,
      slides: [2],
      facts: [],
    })),
  }))
  const cards = tree.flatMap((topic) =>
    topic.concepts.flatMap((concept) =>
      [1, 2].map((n) => ({
        id: `${concept.id}-${n}`,
        note: 'qa',
        concept: concept.id,
        slide: 2,
        fields: {
          Front: `What is ${concept.name}?`,
          Back: `${concept.name} is a thing worth knowing.`,
          Role: 'definition',
          Lecture: String(number).padStart(2, '0'),
          Source: `Lecture ${number}, slide 2`,
          Key: concept.name,
        },
      })),
    ),
  )
  return { number, title, tree, cards }
}

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
  const courses = await mkdtemp(join(tmpdir(), 'lectern-map-'))
  const folder = join(courses, 'Maps')
  const lectures = [lecture(1, LONG, 3, 3), lecture(2, 'Effectuation', 4, 4)]
  const pdf = await makePdf([[LONG], ['Slide']])
  await mkdir(join(folder, 'slides'), { recursive: true })
  const files = lectures.map((l) => `${String(l.number).padStart(2, '0')}_${l.title}.pdf`)
  await writeFile(
    join(folder, 'course.json'),
    JSON.stringify({
      format: 1,
      name: 'Maps',
      goal: 'good',
      lectures: lectures.map((l, i) => ({
        number: l.number,
        title: l.title,
        file: files[i],
        sha256: createHash('sha256').update(pdf).digest('hex'),
        slides: 2,
      })),
    }),
  )
  for (const [i, l] of lectures.entries()) {
    await writeFile(join(folder, 'slides', files[i]!), pdf)
    const dir = join(folder, 'lectures', String(l.number).padStart(2, '0'))
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'lecture.json'),
      JSON.stringify({
        number: l.number,
        title: l.title,
        file: files[i],
        slides: 2,
        topics: l.tree,
        leftOut: [],
        dropped: [],
      }),
    )
    await writeFile(join(dir, 'cards.yaml'), JSON.stringify(l.cards))
  }

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
