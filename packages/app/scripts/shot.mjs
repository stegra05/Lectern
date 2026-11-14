/**
 * Takes a picture of one fixture scenario of the interface, for design work.
 *
 *   node scripts/shot.mjs <scenario> <out.png> [dark] [width height]
 *
 * It serves the renderer with Vite, opens it in the installed Chrome through Playwright and
 * always ends within a minute. Scenarios are listed in src/renderer/src/dev/fixture.ts.
 */

import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const [scenario = 'result', out = 'shot.png', mode = 'light', width = '1100', height = '720'] =
  process.argv.slice(2)

const kill = setTimeout(() => {
  console.error('shot.mjs: took longer than a minute, giving up')
  process.exit(1)
}, 60_000)

const server = await createServer({
  root: new URL('../src/renderer', import.meta.url).pathname,
  configFile: false,
  logLevel: 'error',
  server: { port: 0, host: '127.0.0.1', fs: { strict: false } },
})
await server.listen()
const address = server.httpServer.address()
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({
    viewport: { width: Number(width), height: Number(height) },
    colorScheme: mode === 'dark' ? 'dark' : 'light',
  })
  page.on('pageerror', (error) => console.error('page error:', error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('console error:', message.text())
  })
  await page.goto(`http://127.0.0.1:${address.port}/#${scenario}`)
  await page.waitForTimeout(900)
  await page.screenshot({ path: out })
  console.log(`saved ${out}`)
} finally {
  await browser.close()
  await server.close()
  clearTimeout(kill)
}
