/**
 * E2E Test: Configuration Setup Journey
 *
 * Critical path: onboarding when services incomplete, settings modal, theme toggle.
 */
import { test, expect } from '@playwright/test';
import { mockAllApiRoutes, mockApiWithGeminiNotConfigured } from '../helpers/apiMocks';

test.describe('Configuration Setup', () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApiRoutes(page);
  });

  test('should show onboarding when Gemini is not configured', async ({ page }) => {
    await mockApiWithGeminiNotConfigured(page);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/health') && res.status() === 200),
      page.goto('/', { waitUntil: 'networkidle' }),
    ]);

    // Onboarding should show System Check
    await expect(page.getByRole('heading', { name: 'System Check' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Pre-Flight Sequence')).toBeVisible();
    await expect(page.getByText('Anki Connection')).toBeVisible();
  });

  test('should allow saving API key and reach home view', async ({ page }) => {
    await mockApiWithGeminiNotConfigured(page);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/health') && res.status() === 200),
      page.goto('/', { waitUntil: 'networkidle' }),
    ]);

    // Onboarding visible
    await expect(page.getByRole('heading', { name: 'System Check' })).toBeVisible();

    // Enter API key and submit
    const apiKeyInput = page.getByLabel('Gemini API Key');
    await apiKeyInput.fill('test-gemini-api-key-1234567890');

    await Promise.all([
      page.waitForRequest((req) => req.url().includes('/config') && req.method() === 'POST'),
      page.getByRole('button', { name: 'Initialize with API key' }).click(),
    ]);

    // After save + exit animation, app should show home view (health flips in mocks).
    await expect(page.getByRole('button', { name: /Upload PDF file/i })).toBeVisible({ timeout: 15000 });
  });

  test('should show home view when both services are configured', async ({ page }) => {
    // Wait for health check to complete before asserting (app shows loading until then)
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/health') && res.status() === 200),
      page.goto('/', { waitUntil: 'networkidle' }),
    ]);

    // Home view: file picker and deck selector
    await expect(page.getByRole('button', { name: /Upload PDF file/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder('University::Subject::Topic')).toBeVisible();
  });

  test('should open settings modal from header', async ({ page }) => {
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/health') && res.status() === 200),
      page.goto('/', { waitUntil: 'networkidle' }),
    ]);

    const settingsButton = page.getByRole('button', { name: 'Settings' });
    await expect(settingsButton).toBeVisible({ timeout: 10000 });
    await settingsButton.click();

    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('AI Model')).toBeVisible();
  });

  test('should display health status indicators in header', async ({ page }) => {
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/health') && res.status() === 200),
      page.goto('/', { waitUntil: 'networkidle' }),
    ]);

    // Health indicators: Anki and Gemini status dots (exact match to avoid "AI-POWERED ANKI GENERATOR")
    await expect(page.getByRole('button', { name: 'View AnkiConnect status' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/^Gemini$/)).toBeVisible();
  });

  test('should toggle theme', async ({ page }) => {
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/health') && res.status() === 200),
      page.goto('/', { waitUntil: 'networkidle' }),
    ]);

    const themeButton = page.getByRole('button', { name: 'Toggle Theme' });
    await expect(themeButton).toBeVisible({ timeout: 10000 });
    await themeButton.click();

    // Document should have theme class
    const html = page.locator('html');
    await expect(html).toHaveAttribute('class', /light|dark/);
  });
});
