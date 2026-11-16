import { expect, test } from '@playwright/test'
import { launch, type Launched } from './launch.ts'
import { LATER, LECTURES, makePdf } from './pdf.ts'

/**
 * The whole way of a student through the base product, on the offline models: first run,
 * a new course, two lecture PDFs, the goal, a past exam paper, the run with the engine's phases,
 * the result on the track, the paper's question as a card, a lecture as rings, the cards of a concept in the side panel, changing, writing
 * and removing a card, the cards in Anki, changing and removing a card that was sent, and a
 * lecture that arrives later. Anki is the one in memory, which writes its notes to the data
 * folder on every change, so the test reads what reached it and nothing reaches a real
 * collection.
 */
let launched: Launched

test.beforeAll(async () => {
  // A short delay per model call keeps the run on screen long enough to be seen.
  launched = await test.step('launch the app', () => launch({ delayMs: 80 }))
})

test.afterAll(async () => {
  await launched.app.close()
})

test('from creating a course to its cards in Anki, and a lecture added later', async () => {
  const { page } = launched

  await test.step('first run: the key', async () => {
    await expect(page.getByRole('heading', { name: 'Welcome to Lectern' })).toBeVisible()
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
    await page.locator('.map-empty input[type=file]').setInputFiles(files)
    await expect(page.getByRole('img', { name: /Lecture 01 Introduction, 4 slides/ })).toBeVisible()
    await expect(page.getByRole('img', { name: /Lecture 02 Effectuation, 4 slides/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'I am aiming for' })).toBeVisible()
    // The goal changes what is made: the estimate of cards differs between goals.
    const note = page.getByRole('complementary').getByText(/About \d+ cards?\./)
    const cards = async (): Promise<number> =>
      Number(/About (\d+) card/.exec((await note.textContent()) ?? '')?.[1])
    await expect(note).toBeVisible()
    const good = await cards()
    await page.getByRole('button', { name: 'a pass' }).click()
    await expect.poll(cards).not.toBe(good)
    const pass = await cards()
    await page.getByRole('button', { name: 'a top grade' }).click()
    await expect.poll(cards).not.toBe(pass)
    expect(pass).toBeLessThan(good)
    expect(await cards()).toBeGreaterThan(good)
    await expect(page.getByRole('button', { name: 'a top grade' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  await test.step('past exams: a paper is added in the setup and waits for the cards', async () => {
    const paper = await makePdf([['Exam Winter 2025/26', '1) What is a minimum viable product?']])
    await page
      .getByLabel('Past exam papers')
      .setInputFiles([
        { name: 'Exam Winter 2025-26.pdf', mimeType: 'application/pdf', buffer: paper },
      ])
    const panel = page.getByRole('complementary')
    await expect(panel).toContainText('Exam Winter 2025-26')
    await expect(panel).toContainText('read with these cards')
    await expect(panel.getByRole('button', { name: 'Add more past exams' })).toBeVisible()
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

  await test.step('past exams: the paper’s question has a card in the first lecture', async () => {
    await page.getByRole('button', { name: /Open lecture 01/ }).click()
    await page.getByRole('button', { name: /^Entrepreneurship, \d+ cards?$/ }).click()
    await expect(page.getByRole('complementary')).toContainText(
      'An answer to this past exam question',
    )
  })

  await test.step('a lecture as rings, its cards in the side panel', async () => {
    await page.getByRole('button', { name: /^(Open|Go to) lecture 02/ }).click()
    const panel = page.getByRole('complementary')
    await expect(panel).toContainText('Effectuation')
    // The concept on the map. The edit button of a card can name the concept too.
    await page.getByRole('button', { name: /^Affordable loss, \d+ cards?$/ }).click()
    await expect(panel.getByRole('heading', { name: 'Affordable loss' })).toBeVisible()
    const cards = panel.getByRole('listitem')
    await expect(cards.first()).toBeVisible()
    expect(await cards.count()).toBeGreaterThan(0)
    // The card is made of the slide's own words.
    await expect(panel).toContainText('afford to lose')
  })

  await test.step('a card: change it, be told what is over the limit, write one, remove one', async () => {
    const panel = page.getByRole('complementary')
    const rows = panel.getByRole('listitem')
    const before = await rows.count()

    await panel
      .getByRole('button', { name: /^Edit the card:/ })
      .first()
      .click()
    await expect(panel.getByRole('heading', { name: 'Edit this card' })).toBeVisible()
    const question = panel.getByLabel('Question')
    await question.fill(`What ${'really '.repeat(20)}counts?`)
    await expect(panel).toContainText('22 of 20 words')
    await panel.getByRole('button', { name: 'Save card' }).click()
    await expect(panel.getByRole('alert')).toHaveText('It has 22 words. The limit is 20.')
    await question.fill('What decides how much to put into a venture?')
    await panel.getByRole('button', { name: 'Save card' }).click()
    await expect(panel.getByRole('heading', { name: 'Affordable loss' })).toBeVisible()
    await expect(panel).toContainText('What decides how much to put into a venture?')
    await expect(rows).toHaveCount(before)

    await panel.getByRole('button', { name: 'Add your own card' }).click()
    await expect(panel.getByRole('heading', { name: 'Add your own card' })).toBeVisible()
    await expect(panel.getByLabel('Concept')).toHaveValue(/affordable-loss/)
    await panel.getByLabel('Question').fill('Why does a small loss matter to a founder?')
    await panel.getByLabel('Answer').fill('It keeps the venture alive for the next try.')
    await panel.getByRole('button', { name: 'Add card' }).click()
    await expect(panel.getByRole('alert')).toContainText('Name the key term')
    await panel.getByLabel('Key term, in bold').fill('alive for the next try')
    await panel.getByRole('button', { name: 'Add card' }).click()
    await expect(rows).toHaveCount(before + 1)
    await expect(rows.last()).toContainText('Yours')
    await expect(rows.last()).toContainText('Why does a small loss matter to a founder?')

    await panel.getByRole('button', { name: /^Edit the card: What decides/ }).click()
    await panel.getByRole('button', { name: 'Remove card' }).click()
    await expect(panel).toContainText('Remove this card?')
    await panel.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(rows).toHaveCount(before)
    await expect(panel).not.toContainText('What decides how much to put into a venture?')
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

  await test.step('the first send: the cards are in Anki', async () => {
    await page.getByRole('button', { name: 'Whole course' }).click()
    await expect(page.getByRole('img', { name: 'In Anki, not sent yet' })).toBeVisible()
    const send = status.getByRole('button', { name: /^Send \d+ cards to Anki$/ })
    first = Number(/\d+/.exec((await send.textContent())!)![0])
    await send.click()

    await expect(status).toContainText(`${first} cards are in Anki, in 2 subdecks`)
    await expect(page.getByRole('img', { name: `In Anki, ${first} cards` })).toBeVisible()
    await expect(status.getByRole('button', { name: /Send/ })).toHaveCount(0)
    // What reached Anki: one note per card, in the subdeck of its lecture.
    const notes = await launched.notes()
    expect(notes).toHaveLength(first)
    expect(new Set(notes.map((n) => n.deck)).size).toBe(2)
  })

  await test.step('a card that is in Anki says so before it is changed', async () => {
    await page.getByRole('button', { name: /Open lecture 02/ }).click()
    const panel = page.getByRole('complementary')
    await panel
      .getByRole('button', { name: /^Edit the card:/ })
      .first()
      .click()
    await expect(panel).toContainText('This card is in Anki. Saving changes it there too')
    await panel
      .getByLabel('Extra line, optional')
      .fill('Sarasvathy calls this effectual reasoning.')
    await panel.getByRole('button', { name: 'Save card' }).click()
    await expect(panel.getByRole('heading', { name: 'Edit this card' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Whole course' }).click()
    await expect(status).toContainText(`${first} cards are in Anki, in 2 subdecks`)
    // The change reached the note in Anki, and no note was added.
    const notes = await launched.notes()
    expect(notes).toHaveLength(first)
    expect(
      notes.filter((n) =>
        Object.values(n.fields).some((v) =>
          v.includes('Sarasvathy calls this effectual reasoning.'),
        ),
      ),
    ).toHaveLength(1)
  })

  await test.step('a card that is in Anki is removed there too', async () => {
    await page.getByRole('button', { name: /Open lecture 02/ }).click()
    const panel = page.getByRole('complementary')
    const edit = panel.getByRole('button', { name: /^Edit the card:/ }).last()
    const name = (await edit.getAttribute('aria-label'))!.replace('Edit the card: ', '')
    await edit.click()
    await panel.getByRole('button', { name: 'Remove card' }).click()
    await expect(panel).toContainText('Remove it here and in Anki, with its progress?')
    await panel.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(panel.getByRole('button', { name: `Edit the card: ${name}` })).toHaveCount(0)
    await page.getByRole('button', { name: 'Whole course' }).click()
    first -= 1
    await expect(status).toContainText(`${first} cards are in Anki, in 2 subdecks`)
    expect(await launched.notes()).toHaveLength(first)
  })

  await test.step('settings: the key is stored', async () => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Your OpenAI key' })).toBeVisible()
    await expect(page.getByText('Stored on this computer')).toBeVisible()
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

    await send.click()
    await expect(status).toContainText(`${first + later} cards are in Anki, in 3 subdecks`)
    expect(await launched.notes()).toHaveLength(first + later)
  })
})
