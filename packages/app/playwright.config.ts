import { defineConfig } from '@playwright/test'

/** The end-to-end test drives the built Electron app, so `pnpm test:e2e` builds first. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  // Each step with its time, so a slow run shows where the time went.
  reporter: [['list', { printSteps: true }]],
})
