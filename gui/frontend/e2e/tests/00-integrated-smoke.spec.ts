import { test, expect } from '@playwright/test';

/**
 * Integrated smoke: frontend + real backend (/health).
 *
 * This test intentionally does NOT mock API routes.
 * CI boots uvicorn on :8000 and Vite on :5173 with VITE_API_URL pointing at the backend.
 */
test('app boots and reaches backend health', async ({ page }) => {
  // Wait for initial health fetch to hit the real backend.
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/health') && res.status() === 200),
    page.goto('/', { waitUntil: 'domcontentloaded' }),
  ]);

  // The UI may show onboarding or home depending on backend config.
  // We just assert: app rendered into the document and didn't crash.
  await expect(page.getByText('Lectern.')).toBeVisible({ timeout: 15000 });
});

