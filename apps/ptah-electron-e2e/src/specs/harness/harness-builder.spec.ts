import { test, expect } from '../../support/fixtures';

/**
 * Harness builder + setup hub — two lazy ROUTES (`app.routes.ts`) whose
 * `loadComponent` calls both resolve out of the *same* library, so they share
 * one chunk (batch-4-report.md §1c/§4c — 41,190 B, "one chunk, both views").
 * TASK_2026_187 Batch 4 first deferred them behind the
 * `HARNESS_BUILDER_COMPONENT` / `SETUP_HUB_COMPONENT` tokens; TASK_2026_524
 * batch 1 replaced those with the routes and kept the one shared chunk.
 * Opening EACH surface independently is the point: if the shared chunk or the
 * `/services` barrel dropped a symbol, one can look fine while the other
 * silently breaks (batch-4-report.md §12).
 */
test.describe('Harness builder + Setup hub (shared lazy chunk, TASK_2026_187)', () => {
  test('harness builder view opens', async ({ ui }) => {
    await ui.goto('harness-builder');

    await expect(ui.page.locator('ptah-harness-builder-view')).toBeVisible();
  });

  test('setup hub opens (shares the harness-builder chunk)', async ({ ui }) => {
    await ui.goto('setup-hub');

    await expect(ui.page.locator('ptah-setup-hub')).toBeVisible();
  });
});
