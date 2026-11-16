import { defineConfig } from '@playwright/test'

/** The end-to-end test drives the built Electron app, so `pnpm test:e2e` builds first. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
})
