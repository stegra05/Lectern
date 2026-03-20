/**
 * API mocking helpers for E2E tests.
 *
 * Intercepts all API calls with page.route() and responds with static JSON fixtures.
 * This allows frontend-only testing without booting the Python backend.
 */
import { Page, Route } from '@playwright/test';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get directory path in ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock data imports
const mocksDir = join(__dirname, '../mocks');

// Load mock files
const loadMock = (filename: string): string => {
  return readFileSync(join(mocksDir, filename), 'utf-8');
};

// Pre-loaded mock data
const healthMock = JSON.parse(loadMock('health.json'));
const ankiStatusMock = JSON.parse(loadMock('anki-status.json'));
const configMock = JSON.parse(loadMock('config.json'));
const decksMock = JSON.parse(loadMock('decks.json'));
const estimationMock = JSON.parse(loadMock('estimation.json'));
const historyMock = JSON.parse(loadMock('history.json'));
const versionMock = JSON.parse(loadMock('version.json'));
const generationStream = loadMock('generation-stream.txt');
const syncStream = loadMock('sync-stream.txt');
const syncPartialStream = loadMock('sync-stream-partial.txt');

/**
 * Mock all API routes for a page.
 * Call this in beforeEach or test setup.
 */
export async function mockAllApiRoutes(page: Page): Promise<void> {
  // Mutable state for stateful mocks (e.g. onboarding -> config save -> health flips)
  const healthState: Record<string, unknown> = structuredClone(healthMock);

  // Health check
  await page.route('**/health', (route: Route) =>
    route.fulfill({ json: healthState })
  );

  // Anki status
  await page.route('**/anki/status', (route: Route) =>
    route.fulfill({ json: ankiStatusMock })
  );

  // Config
  await page.route('**/config', (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: configMock });
    }
    // POST - save config
    // If API key was provided, simulate backend now being configured.
    try {
      const body = route.request().postDataJSON?.();
      if (body && typeof body === 'object' && 'gemini_api_key' in body) {
        healthState.gemini_configured = true;
      }
    } catch {
      // Ignore parse errors; tests can still validate UI behavior.
    }
    return route.fulfill({ json: { success: true } });
  });

  // Decks
  await page.route('**/decks', (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: decksMock });
    }
    // POST - create deck
    return route.fulfill({ json: { name: 'New Deck', success: true } });
  });

  // Estimation (V2)
  await page.route('**/estimate-v2', (route: Route) =>
    route.fulfill({ json: estimationMock })
  );

  // History
  await page.route('**/history', (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: historyMock });
    }
    // DELETE - clear history (HistoryClearResponseSchema: { status: 'cleared' })
    return route.fulfill({ json: { status: 'cleared' } });
  });

  // Single history entry delete (HistoryDeleteResponseSchema: { status: 'deleted' })
  await page.route('**/history/**', (route: Route) =>
    route.fulfill({ json: { status: 'deleted' } })
  );

  // Batch delete history (HistoryBatchDeleteResponseSchema: { status: 'deleted', count: number })
  await page.route('**/history/batch-delete', (route: Route) =>
    route.fulfill({ json: { status: 'deleted', count: 0 } })
  );

  // Version
  await page.route('**/version', (route: Route) =>
    route.fulfill({ json: versionMock })
  );

  // Generation stream (NDJSON, V2)
  await page.route('**/generate-v2', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: generationStream,
    })
  );

  // Sync stream (NDJSON)
  await page.route('**/sync', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: syncStream,
    })
  );

  // Stop generation (V2)
  await page.route('**/stop-v2', (route: Route) =>
    route.fulfill({ json: { stopped: true, message: 'Generation stopped' } })
  );

  // Session data (V2)
  await page.route('**/session-v2/**', (route: Route) =>
    route.fulfill({
      json: {
        id: 'history-entry-001',
        cards: [
          {
            front: 'What is photosynthesis?',
            back: 'The process by which plants convert light energy into chemical energy.',
            uid: 'card-001',
            slide_number: 1,
            source_pages: [1],
          },
          {
            front: 'What are the reactants in photosynthesis?',
            back: 'Carbon dioxide (CO2) and water (H2O)',
            uid: 'card-002',
            slide_number: 2,
            source_pages: [2],
          },
        ],
        logs: [],
        status: 'completed',
        session_id: 'test-session-123',
        deck_name: 'Study::Biology',
        total_pages: 10,
      },
    })
  );

  // Anki notes operations
  await page.route('**/anki/notes/**', (route: Route) =>
    route.fulfill({ json: { success: true } })
  );
}

/**
 * Mock API routes with custom health status.
 * Useful for testing offline/error states.
 */
export async function mockApiWithHealth(
  page: Page,
  health: Record<string, unknown>
): Promise<void> {
  await mockAllApiRoutes(page);
  await page.route('**/health', (route: Route) =>
    route.fulfill({ json: health })
  );
}

/**
 * Mock API routes with Anki disconnected.
 * Keeps health "configured" so we show home view; only anki/status returns disconnected.
 * This allows testing the Anki health panel from the header.
 */
export async function mockApiWithAnkiDisconnected(page: Page): Promise<void> {
  await mockAllApiRoutes(page);
  await page.route('**/anki/status', (route: Route) =>
    route.fulfill({
      json: {
        status: 'error',
        connected: false,
        version: null,
        version_ok: false,
        error: 'Cannot connect to Anki',
      },
    })
  );
  // Keep health as configured so we show home (not onboarding)
  // Only anki/status is disconnected for the panel test
}

/**
 * Mock API routes where sync completes with partial failures.
 */
export async function mockApiWithSyncPartialFailure(page: Page): Promise<void> {
  await mockAllApiRoutes(page);
  await page.route('**/sync', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: syncPartialStream,
    })
  );
}

/**
 * Mock API routes with Gemini not configured.
 */
export async function mockApiWithGeminiNotConfigured(page: Page): Promise<void> {
  await mockAllApiRoutes(page);
  const healthState: Record<string, unknown> = structuredClone(healthMock);
  healthState.gemini_configured = false;

  // Override health route with stateful initial condition.
  await page.route('**/health', (route: Route) =>
    route.fulfill({ json: healthState })
  );

  // Override config POST to flip Gemini configured once a key is saved.
  await page.route('**/config', (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: configMock });
    }
    try {
      const body = route.request().postDataJSON?.();
      if (body && typeof body === 'object' && 'gemini_api_key' in body) {
        healthState.gemini_configured = true;
      }
    } catch {
      // ignore
    }
    return route.fulfill({ json: { success: true } });
  });
}
