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

    // Confirms the mounted component is real, not a frozen shell: the section
    // strip (marketplace-hub.component.html:28-33) renders from the static
    // MARKETPLACE_SECTIONS registry with zero RPC calls, so this is safe to
    // assert without mocking anything section-specific. TASK_2026_524 replaced
    // the seven-tile provider grid with these three tabs; 'Connected' is the
    // default section (sections.registry.ts:48-52).
    // Scoped to the hub: the app shell's own top nav is also a `role="tab"`
    // tablist, and an unscoped lookup would match it instead.
    const hub = page.locator('ptah-marketplace-hub');
    for (const section of ['Connected', 'Apps', 'Skills']) {
      await expect(hub.getByRole('tab', { name: section })).toBeVisible();
    }
  });
});
