import { expect, test, type Locator } from '@playwright/test'
import { lecture, writeCourse } from './course-fixture.ts'
import { launch, type Launched } from './launch.ts'

/**
 * A drag of the map ends when its button is no longer held, however the release was missed:
 * outside the window, or by losing the pointer. A drag that was cancelled does not swallow the
 * next click.
 */
let launched: Launched
let map: Locator

test.beforeAll(async () => {
  launched = await launch({ courses: await writeCourse([lecture(1, 'Effectuation', 3, 3)]) })
  const { page } = launched
  await page.getByPlaceholder('sk-...').fill('sk-offline')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.locator('.course-card').first().click()
  await page.getByRole('button', { name: /Open lecture 01/ }).click()
  await expect(page.getByRole('button', { name: /^All cards of lecture 01/ })).toBeVisible()
  map = page.locator('section.map')
})

test.afterAll(async () => {
  await launched.app.close()
})

/** Where the map is panned to, as the background it moves with. */
const panned = (map: Locator): Promise<string> =>
  map.evaluate((element) => (element as HTMLElement).style.backgroundPosition)

/** An empty spot of the map, away from every node. */
async function empty(): Promise<{ x: number; y: number }> {
  const box = (await map.boundingBox())!
  return { x: box.x + 30, y: box.y + box.height / 2 }
}

test('a release outside the window ends the drag', async () => {
  const { page } = launched
  const start = await empty()
  const before = await panned(map)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  // The button is let go outside the window, where the page gets no mouse-up. The next event
  // it sees is a move with no button held.
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: start.x + 120,
    y: start.y - 80,
    buttons: 0,
  })
  expect(await panned(map)).toBe(before)
  await expect(map).not.toHaveClass(/is-moving/)
  await page.mouse.up()
})

test('a lost pointer ends the drag, and a cancelled drag does not swallow the next click', async () => {
  const { page } = launched
  const start = await empty()
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 60, start.y - 60)
  await expect(map).toHaveClass(/is-moving/)
  await map.evaluate((element) => {
    element.releasePointerCapture(1)
    element.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))
  })
  await expect(map).not.toHaveClass(/is-moving/)
  // The press ends over the title bar, so no click reaches the map.
  await page.mouse.move(5, 5)
  await page.mouse.up()
  const concept = page.getByRole('button', { name: /^Concept 1\.1, 2 cards$/ })
  await concept.click()
  await expect(concept).toHaveAttribute('aria-pressed', 'true')
})
