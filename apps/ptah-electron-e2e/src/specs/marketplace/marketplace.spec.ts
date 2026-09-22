import { test, expect } from '../../support/fixtures';

/**
 * Marketplace is a lazy ROUTE (`app.routes.ts`, `loadComponent:
 * import('@ptah-extension/marketplace')`). TASK_2026_187 Batch 2 first
 * deferred it behind a `LazyViewService.resolveWhen` token; TASK_2026_524
 * batch 1 replaced that token, the `*ngComponentOutlet` and its hand-written
 * `@else` spinner with the route and `<router-outlet />`. The chunk boundary
 * and therefore the property under test are unchanged — only the mechanism
 * that crosses it is.
 *
 * The failure mode is still quiet, but it moved: a lazy route whose chunk
 * rejects does not swap the outlet at all, so the user stays on the surface
 * they were on. What this proves: navigating to the marketplace results in
 * the real component mounting.
 */
test.describe('Marketplace (lazy route, TASK_2026_524)', () => {
  test('renders the marketplace hub after the lazy chunk resolves', async ({
    ui,
    rendererConsoleErrors,
  }) => {
    await ui.goto('marketplace');

    const page = ui.page;

    await expect(page.locator('ptah-marketplace-hub')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Marketplace' }),
    ).toBeVisible();

    // A visible hub already proves the outlet swapped. This is the extra,
    // independent signal: a navigation that does not land — including a
    // rejected lazy chunk fetch — is reported by `SurfaceRouterService` as
    // '[SurfaceRouterService] Navigation to ... failed'
    // (surface-router.service.ts), and nothing else in the app produces that
    // prefix.
    expect(rendererConsoleErrors).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('[SurfaceRouterService] Navigation to'),
      ]),
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
