/**
 * E2E Test: Card Review → Anki Sync Journey
 *
 * Critical path: history modal, Anki disconnected warning.
 */
import { test, expect } from '@playwright/test';
import { mockAllApiRoutes, mockApiWithAnkiDisconnected, mockApiWithSyncPartialFailure } from '../helpers/apiMocks';

test.describe('Card Review and Sync', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApiRoutes(page);
  });

  test('should open history modal from header', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    const historyButton = page.getByRole('button', { name: 'Recent Sessions' });
    await expect(historyButton).toBeVisible({ timeout: 10000 });
    await historyButton.click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
  });

  test('should show warning when Anki is disconnected', async ({ page }) => {
    await mockApiWithAnkiDisconnected(page);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/health') && res.status() === 200),
      page.goto('/', { waitUntil: 'networkidle' }),
    ]);

    // Click Anki status to open panel (home view; health configured, anki/status returns disconnected)
    const ankiButton = page.getByRole('button', { name: 'View AnkiConnect status' });
    await expect(ankiButton).toBeVisible({ timeout: 10000 });
    await ankiButton.click();

    // Anki health panel should indicate not connected (status title in h3)
    await expect(page.getByRole('heading', { name: 'Not Connected' })).toBeVisible({ timeout: 5000 });
  });

  test('should sync generated cards to Anki and show success overlay', async ({ page }) => {
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/health') && res.status() === 200),
      page.goto('/', { waitUntil: 'networkidle' }),
    ]);

    // Generate cards first (mocked NDJSON stream)
    await page.locator('input[type="file"]').setInputFiles('e2e/fixtures/sample.pdf');
    await page.getByPlaceholder('University::Subject::Topic').fill('Study::Biology');

    const startButton = page.getByRole('button', { name: 'Start Generation' });
    await expect(startButton).toBeEnabled({ timeout: 15000 });
    await Promise.all([
      page.waitForRequest((req) => req.url().includes('/generate-v2') && req.method() === 'POST'),
      startButton.click(),
    ]);

    // Wait for cards to appear
    await expect(page.getByText('What is photosynthesis?')).toBeVisible({ timeout: 15000 });

    // Trigger sync
    const syncButton = page.getByRole('button', { name: 'Sync to Anki' });
    await expect(syncButton).toBeVisible();

    await Promise.all([
      page.waitForRequest((req) => req.url().includes('/sync') && req.method() === 'POST'),
      syncButton.click(),
    ]);

    // Success overlay should appear after done event
    await expect(page.getByRole('heading', { name: 'Sync Complete!' })).toBeVisible({ timeout: 15000 });
  });

  test('should show partial failure overlay when some cards fail to sync', async ({ page }) => {
    await mockApiWithSyncPartialFailure(page);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/health') && res.status() === 200),
      page.goto('/', { waitUntil: 'networkidle' }),
    ]);

    // Generate cards first
    await page.locator('input[type="file"]').setInputFiles('e2e/fixtures/sample.pdf');
    await page.getByPlaceholder('University::Subject::Topic').fill('Study::Biology');
    const startButton = page.getByRole('button', { name: 'Start Generation' });
    await expect(startButton).toBeEnabled({ timeout: 15000 });
    await startButton.click();

    await expect(page.getByText('What is photosynthesis?')).toBeVisible({ timeout: 15000 });

    // Trigger sync (partial failure stream)
    await page.getByRole('button', { name: 'Sync to Anki' }).click();

    await expect(page.getByRole('heading', { name: 'Sync Completed with Errors' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/4 cards synced, 1 failed/i)).toBeVisible();
  });
});
