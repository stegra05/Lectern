import { defineConfig } from 'vitest/config'

/** Unit tests of the interface's pure parts. The end-to-end test in `e2e/` belongs to Playwright. */
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
})
