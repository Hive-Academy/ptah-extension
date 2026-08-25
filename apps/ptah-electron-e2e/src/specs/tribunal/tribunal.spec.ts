import { test, expect } from '../../support/fixtures';

/**
 * Tribunal is the second of the three surfaces TASK_2026_187 Batch 2 moved
 * behind a lazy `LazyViewService.resolveWhen` token (`TRIBUNAL_COMPONENT`,
 * `app.config.ts`). Its lazy chunk (~46 kB, batch-2-report.md §2d) plus the
 * shared `gridstack` chunk (~90 kB) load together, since
 * `TribunalPageComponent` imports `gridstack`/`gridstack/dist/angular`
 * directly at module scope — the chunk fetch happens as soon as the
 * component module evaluates, not gated on any tile existing (verified by
 * reading tribunal-page.component.ts:9-14; see
 * e2e-validation-report.md for the full attribution).
 *
 * This spec proves the deferred outlet
 * (`app-shell.component.html:92-103`) resolves to the real component rather
 * than sticking on the `@else` spinner. It does not attempt to catch the
 * transient spinner frame — see marketplace.spec.ts's header comment and
 * e2e-validation-report.md §3 for why.
 */
test.describe('Tribunal (lazy chunk, TASK_2026_187)', () => {
  test('renders the tribunal page after the lazy chunk (+ gridstack) resolves', async ({
    ui,
    mainProcessOutput,
  }) => {
    await ui.goto('tribunal');

    const page = ui.page;

    await expect(page.locator('[data-testid="tribunal-grid"]')).toBeVisible();
    // Default landing state (no run convened yet): the empty-state child of
    // the same root div. A stuck spinner would never reach this element at
    // all, since it lives inside the @if branch that only renders once
    // tribunalComponent() resolves non-null.
    await expect(page.locator('ptah-tribunal-empty-state')).toBeVisible();

    expect(mainProcessOutput.hasLine('[LazyViewService] Failed to load')).toBe(
      false,
    );
  });
});
