/**
 * E2E Test: PDF Upload → Card Generation Journey (Hardened)
 *
 * This test suite covers the critical path of uploading a PDF and generating cards,
 * including error handling and edge cases (Law #1: Safety Net).
 */
import { test, expect } from '@playwright/test';
import { mockAllApiRoutes } from '../helpers/apiMocks';

test.describe('PDF Upload and Generation (Resilience)', () => {
  
  test('should handle API errors during generation', async ({ page }) => {
    await mockAllApiRoutes(page);
    
    // Explicitly unroute the global mock so there's no conflict
    await page.unroute('**/generate-v2');

    // Override with V2 ERROR mock event
    await page.route('**/generate-v2', async (route) => {
        const errorEvent = JSON.stringify({
            event_version: 2,
            type: 'error_emitted',
            message: '500 Internal Server Error',
            timestamp: Date.now(),
            sequence_no: 1,
            session_id: 'test-session',
            data: { recoverable: false }
        }) + '\n';
        
        await route.fulfill({
            status: 200,
            contentType: 'application/x-ndjson',
            body: errorEvent,
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('input[type="file"]').setInputFiles('e2e/fixtures/sample.pdf');
    await page.getByPlaceholder('University::Subject::Topic').fill('Error::Test');

    const startButton = page.getByRole('button', { name: 'Start Generation' });
    await expect(startButton).toBeEnabled({ timeout: 15000 });
    await startButton.click();

    // ERROR OVERLAY SHOULD APPEAR (Title for 500/Internal Server Error mapping)
    await expect(page.getByText(/Server Error/i)).toBeVisible({ timeout: 15000 });
    
    await page.getByRole('button', { name: /Return to Dashboard/i }).click();
    await expect(page.getByRole('button', { name: 'Start Generation' })).toBeVisible();
  });

  test('should allow stopping a running generation', async ({ page }) => {
    await mockAllApiRoutes(page);
    
    await page.unroute('**/generate-v2');
    await page.unroute('**/stop-v2');

    let stopRequested = false;

    // Keep stream open until stop is requested, then emit cancellation event.
    await page.route('**/generate-v2', async (route) => {
        const statusEvent = JSON.stringify({
            event_version: 2,
            type: 'phase_started',
            message: 'Analyzing...', 
            timestamp: Date.now(),
            sequence_no: 1,
            session_id: 'test-session',
            data: { phase: 'concept' }
        }) + '\n';

        const cancelledEvent = JSON.stringify({
            event_version: 2,
            type: 'session_cancelled',
            message: 'Cancelled by user',
            timestamp: Date.now(),
            sequence_no: 2,
            session_id: 'test-session',
            data: {}
        }) + '\n';

        while (!stopRequested) {
            await page.waitForTimeout(50);
        }
        
        await route.fulfill({
            status: 200,
            contentType: 'application/x-ndjson',
            body: `${statusEvent}${cancelledEvent}`,
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
    });

    await page.route('**/stop-v2', async (route) => {
        stopRequested = true;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ stopped: true, message: 'Generation stopped' }),
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('input[type="file"]').setInputFiles('e2e/fixtures/sample.pdf');
    await page.getByPlaceholder('University::Subject::Topic').fill('Stop::Test');
    
    await page.getByRole('button', { name: 'Start Generation' }).click();

    // The ActivityLog is inside a SidebarPane that is collapsed by default. Expand it:
    await page.getByRole('button', { name: /Activity Log/i }).click();

    // Now it should stay in generating step and ActivityLog variant="generating" is used
    const cancelButton = page.getByText('CANCEL', { exact: true });
    await expect(cancelButton).toBeVisible({ timeout: 15000 });
    await cancelButton.click();

    await page.waitForResponse((resp) => resp.url().includes('/stop-v2') && resp.request().method() === 'POST');
    await expect(page.getByText(/CANCELLING/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Start Generation' })).toBeVisible({ timeout: 15000 });
  });

  test('should handle estimation failure gracefully', async ({ page }) => {
    await mockAllApiRoutes(page);
    
    await page.unroute('**/estimate-v2');

    // Mock estimation failure with specific string to trigger mapping
    await page.route('**/estimate-v2', async (route) => {
        await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ detail: '400 Bad Request' }),
            headers: { 'Access-Control-Allow-Origin': '*' }
        });
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('input[type="file"]').setInputFiles('e2e/fixtures/sample.pdf');

    const errorTitle = page.getByText(/Invalid Request|Estimation Failed/i);
    await expect(errorTitle).toBeVisible({ timeout: 15000 });

    const startButton = page.getByRole('button', { name: 'Start Generation' });
    await expect(startButton).toBeDisabled();
  });

  test('should prevent generation without a deck name', async ({ page }) => {
    await mockAllApiRoutes(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('input[type="file"]').setInputFiles('e2e/fixtures/sample.pdf');

    const startButton = page.getByRole('button', { name: 'Start Generation' });
    await page.waitForTimeout(2000); 

    await expect(page.getByPlaceholder('University::Subject::Topic')).toHaveValue('');
    await expect(startButton).toBeDisabled();
  });
});
