import { test, expect } from '../../support/fixtures';

/**
 * Tribunal is a lazy ROUTE (`app.routes.ts`, `loadComponent:
 * import('@ptah-extension/tribunal-panel')`) — TASK_2026_524 batch 1 replaced
 * the `TRIBUNAL_COMPONENT` token and `LazyViewService.resolveWhen` that
 * TASK_2026_187 Batch 2 introduced. Its chunk (~46 kB, batch-2-report.md §2d)
 * plus the shared `gridstack` chunk (~90 kB) still load together, since
 * `TribunalPageComponent` imports `gridstack`/`gridstack/dist/angular`
 * directly at module scope — the chunk fetch happens as soon as the
 * component module evaluates, not gated on any tile existing (verified by
 * reading tribunal-page.component.ts:9-14).
 *
 * This spec proves the route resolves to the real component rather than
 * leaving the outlet on the surface the user came from.
 */
test.describe('Tribunal (lazy route, TASK_2026_524)', () => {
  test('renders the tribunal page after the lazy chunk (+ gridstack) resolves', async ({
    ui,
    rendererConsoleErrors,
  }) => {
    await ui.goto('tribunal');

    const page = ui.page;

    await expect(page.locator('[data-testid="tribunal-grid"]')).toBeVisible();
    // Default landing state (no run convened yet): the empty-state child of
    // the same root div. A route that never resolved would not render either
    // element, because the outlet would still hold the previous surface.
    await expect(page.locator('ptah-tribunal-empty-state')).toBeVisible();

    // See marketplace.spec.ts for why this prefix is the failure signal.
    expect(rendererConsoleErrors).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('[SurfaceRouterService] Navigation to'),
      ]),
    );
  });
});
