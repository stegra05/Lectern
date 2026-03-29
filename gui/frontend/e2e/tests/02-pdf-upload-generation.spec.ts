/**
 * E2E Test: PDF Upload → Card Generation Journey
 *
 * Critical path: file picker, deck selector with decks, generation flow.
 */
import { test, expect } from '@playwright/test';
import { mockAllApiRoutes } from '../helpers/apiMocks';

test.describe('PDF Upload and Generation', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApiRoutes(page);
  });

  test('should display home view with file picker', async ({ page }) => {
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/health') && res.status() === 200),
      page.goto('/', { waitUntil: 'networkidle' }),
    ]);

    await expect(page.getByRole('button', { name: /Upload PDF file/i })).toBeVisible({ timeout: 10000 });
  });

  test('should display deck selector with placeholder', async ({ page }) => {
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/health') && res.status() === 200),
      page.goto('/', { waitUntil: 'networkidle' }),
    ]);

    const deckInput = page.getByPlaceholder('University::Subject::Topic');
    await expect(deckInput).toBeVisible({ timeout: 10000 });
  });

  test('should show available decks when deck selector is opened', async ({ page }) => {
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/health') && res.status() === 200),
      page.goto('/', { waitUntil: 'networkidle' }),
    ]);

    // Deck selector is disabled until a file is selected; upload sample PDF first
    await page.locator('input[type="file"]').setInputFiles('e2e/fixtures/sample.pdf');

    const deckInput = page.getByPlaceholder('University::Subject::Topic');
    await expect(deckInput).toBeVisible({ timeout: 10000 });
    await deckInput.click();

    // Dropdown opens with search + deck list; decks fetched when HomeView mounts
    await expect(page.getByPlaceholder('Search decks...')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Default')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Study')).toBeVisible();
  });

  test('should run generation to completion and render cards', async ({ page }) => {
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/health') && res.status() === 200),
      page.goto('/', { waitUntil: 'networkidle' }),
    ]);

    // Upload PDF to unlock flow + trigger estimation
    await page.locator('input[type="file"]').setInputFiles('e2e/fixtures/sample.pdf');

    // Set deck name (do not blur to avoid create-deck side effects)
    const deckInput = page.getByPlaceholder('University::Subject::Topic');
    await deckInput.fill('Study::Biology');

    // Wait until CTA becomes enabled (estimation finished, required fields present)
    const startButton = page.getByRole('button', { name: 'Start Generation' });
    await expect(startButton).toBeEnabled({ timeout: 15000 });

    await Promise.all([
      page.waitForRequest((req) => req.url().includes('/generate-v2') && req.method() === 'POST'),
      startButton.click(),
    ]);

    // Assert card content from NDJSON stream fixture rendered in list
    await expect(page.getByText('What is photosynthesis?')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('What are the reactants in photosynthesis?')).toBeVisible();

    // Sidebar quality panel should exist (done state)
    await expect(page.getByText('Generation Health')).toBeVisible();
  });
});
