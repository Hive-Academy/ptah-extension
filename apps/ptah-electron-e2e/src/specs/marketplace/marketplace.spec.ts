import { test, expect } from '../../support/fixtures';

/**
 * Marketplace is one of the three surfaces TASK_2026_187 Batch 2 moved behind
 * a lazy `LazyViewService.resolveWhen` token (`MARKETPLACE_COMPONENT`,
 * `app.config.ts`). Before that batch it was a static import; this spec is
 * the first e2e coverage that the deferred `@if`/`@else` outlet in
 * `app-shell.component.html:80-90` actually resolves to a rendered component
 * rather than getting stuck on the `@else` spinner (the failure mode is
 * silent — `LazyViewService` only logs to console on a rejected import).
 *
 * Batch 2's dynamic `import('@ptah-extension/marketplace')` (~52 kB chunk,
 * batch-2-report.md §2d) resolves from a local `file://` chunk in well under
 * the test's default assertion timeout, so this does not attempt to catch
 * the transient spinner frame — see e2e-validation-report.md §3 for why that
 * was rejected as unreliable. What this proves: navigating to the marketplace
 * view results in the real component mounting, not a permanently spinning
 * placeholder.
 */
test.describe('Marketplace (lazy chunk, TASK_2026_187)', () => {
  test('renders the marketplace hub after the lazy chunk resolves', async ({
    ui,
    mainProcessOutput,
  }) => {
    await ui.goto('marketplace');

    const page = ui.page;

    await expect(page.locator('ptah-marketplace-hub')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Marketplace' }),
    ).toBeVisible();

    // The @if/@else in app-shell is mutually exclusive with the component
    // outlet, so a visible hub already proves the @else spinner is gone —
    // this is the extra, independent signal: LazyViewService logs a
    // '[LazyViewService] Failed to load' console.error on a rejected
    // dynamic import (lazy-view.service.ts:74-79), and nothing else in the
    // app produces that exact string.
    expect(mainProcessOutput.hasLine('[LazyViewService] Failed to load')).toBe(
      false,
    );

    // Confirms the mounted component is real, not a frozen shell: the
    // provider overview grid (marketplace-hub.component.html:90-107) renders
    // from the static MARKETPLACE_PROVIDERS registry with zero RPC calls, so
    // this is safe to assert without mocking anything provider-specific.
    // 'MCP Registry' is a 'live' (non-disabled) provider entry
    // (providers.registry.ts:29-32).
    await expect(
      page.getByRole('button', { name: 'Open MCP Registry' }),
    ).toBeVisible();
  });
});
