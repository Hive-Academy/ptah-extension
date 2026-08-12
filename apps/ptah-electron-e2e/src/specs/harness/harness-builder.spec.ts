import { test, expect } from '../../support/fixtures';

/**
 * Harness builder + setup hub (TASK_2026_187 Batch 4) — `HARNESS_BUILDER_COMPONENT`
 * and `SETUP_HUB_COMPONENT` are now lazy tokens that resolve out of the
 * *same* library, so they share one lazy chunk (batch-4-report.md §1c/§4c —
 * 41,190 B, "one chunk, both views"). No e2e coverage existed for either
 * view before this batch. Opening EACH one independently is the point: if
 * the shared chunk or the `/services` barrel dropped a symbol, one view can
 * look fine while the other silently breaks (batch-4-report.md §12).
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
