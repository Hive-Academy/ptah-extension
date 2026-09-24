import { test, expect } from '../../support/fixtures';

/**
 * Marketplace is a lazy ROUTE (`app.routes.ts`, `loadChildren:
 * import('@ptah-extension/marketplace').then((m) => m.MARKETPLACE_ROUTES)`).
 * TASK_2026_187 Batch 2 first deferred it behind a `LazyViewService.resolveWhen`
 * token; TASK_2026_524 batch 1 replaced that token, the `*ngComponentOutlet` and
 * its hand-written `@else` spinner with a route and `<router-outlet />`;
 * TASK_2026_533 (implementation-plan.md C6/C10) then replaced the tabbed
 * `MarketplaceHubComponent` the route mounted with the routed
 * `MarketplaceShellComponent` + its own child routes. The chunk boundary and
 * therefore the property under test are unchanged — only the component the
 * outlet swaps in, and how the DOM under it is organised, moved.
 *
 * The failure mode is still quiet, but it moved: a lazy route whose chunk
 * rejects does not swap the outlet at all, so the user stays on the surface
 * they were on. What this proves: navigating to the marketplace results in
 * the real shell mounting — its header, nav and the bare-route redirect all
 * live — and that, within the Marketplace/Overview RPC domain, the mount
 * produces nothing beyond `OverviewPageComponent`'s own documented read set
 * (plan C7 "R5"): the shell's own chrome (header, breadcrumb, persistent
 * nav) contributes none of it itself. This is NOT a zero-RPC mount — the
 * bare-route redirect lands on Overview, whose constructor unconditionally
 * reads ~8 sources (`overview-page.component.ts:260-263`), and the test
 * driver's own `ui.goto()` mechanism triggers unrelated app-wide traffic of
 * its own (`workspace:getInfo`, `session:list`, ...) — so this test observes
 * real RPC traffic via `ui.getAllObservedCalls()` (the same fake-IPC
 * recording `external-marketplace.spec.ts` already reads through
 * `getObservedCalls`) and scopes its check to the domain the claim is
 * actually about, rather than claiming a property the code does not have.
 *
 * Reaching the surface: TASK_2026_540 removed the "Marketplace" tab from the
 * Electron top nav in favour of a global configuration menu
 * (`[data-test="config-menu-item-marketplace"]`). `ui.goto('marketplace')`
 * does not drive that menu with clicks — it pushes the renderer's
 * `switchView` message directly, the same `AppStateManager.
 * setCurrentView('marketplace')` call the menu item's click ultimately makes
 * (`ui-driver.ts` `goto`/`switchViewUntilMounted`), and waits for the shell's
 * host element (`SURFACE_HOSTS.marketplace`, now `ptah-marketplace-shell`) to
 * attach. The menu click path itself is covered by
 * `specs/config-menu/*.spec.ts` (TASK_2026_540); this file stays focused on
 * the lazy-chunk boundary and the shell's own first mount.
 */

/**
 * `OverviewPageComponent`'s own read set (plan C7 "R5") — the only RPC
 * methods a bare `/marketplace` mount is allowed to produce, since the
 * redirect (`restoreMarketplaceRoute`) lands there by default with nothing
 * remembered. Sourced directly from the stores its constructor calls
 * unconditionally (`overview-page.component.ts:260-263`):
 *
 * - `mcpDirectory:listInstalled` — `marketplace-inventory.store.ts:449`
 * - `skillsSh:listInstalled` — `marketplace-inventory.store.ts:470`
 * - `plugins:list-marketplaces` — `marketplace-inventory.store.ts:478`
 * - `plugins:get-config` / `plugins:list-available` — the Ptah-plugins
 *   catalog read behind the `plugins` slice, `plugin-catalog.service.ts:206-207`
 * - `mcpDirectory:listOAuthConnected` — `connector-links.store.ts:737`
 * - `mcpDirectory:oauthStatus` — one call per connected OAuth record the read
 *   above returns (`connector-links.store.ts:759`); this harness's fake RPC
 *   default has no connected records, so it is not expected to fire in THIS
 *   test, but is a legitimate Overview read and stays on the allowlist
 * - `mcpDirectory:listSmitheryConnections` — `connector-links.store.ts:773`
 * - `harness:health` — only while no report is already held
 *   (`overview-page.component.ts:263`), `harness-health.store.ts:114`
 *
 * The nav's own counts (`marketplace-nav-counts.ts:30-64`) read only these
 * same slices once they are `ready` and issue no call of their own, so if an
 * RPC method OUTSIDE this list is ever observed during the mount, it did not
 * come from Overview — it is a regression in the shell/nav chrome this batch
 * touched.
 */
const OVERVIEW_MOUNT_RPC_ALLOWLIST = [
  'mcpDirectory:listInstalled',
  'skillsSh:listInstalled',
  'plugins:list-marketplaces',
  'plugins:get-config',
  'plugins:list-available',
  'mcpDirectory:listOAuthConnected',
  'mcpDirectory:oauthStatus',
  'mcpDirectory:listSmitheryConnections',
  'harness:health',
] as const;

/**
 * The subset of the allowlist above guaranteed to fire unconditionally
 * (everything except `oauthStatus`, which only fires per connected record).
 * Waited on before taking the "what did this mount call" snapshot, since
 * `ui.goto` only waits for the shell's host element to attach, not for its
 * child page's RPCs to resolve.
 */
const OVERVIEW_UNCONDITIONAL_READS = OVERVIEW_MOUNT_RPC_ALLOWLIST.filter(
  (method) => method !== 'mcpDirectory:oauthStatus',
);

/**
 * RPC method-name PREFIXES the Marketplace/Overview domain owns
 * (`mcpDirectory:`, `skillsSh:`, `plugins:`, `harness:` — every namespace
 * {@link OVERVIEW_MOUNT_RPC_ALLOWLIST} draws from). Scopes the "no extra
 * RPC" check below to the domain the claim is actually about.
 *
 * Necessary because `ui.goto()` pushes a `workspaceChanged` broadcast before
 * `switchView` (`ui-driver.ts` `syncWorkspace`), and that broadcast fans out
 * to app-wide services that have nothing to do with which surface opened —
 * confirmed empirically, not guessed: a first attempt at this check without
 * the prefix scope caught `workspace:getInfo` (`electron-layout.service.ts:
 * 96-113` reacting to the same broadcast `config-menu-welcome-gate.spec.ts`
 * cites) and, separately, `session:list` (`session-loader.service.ts`, the
 * chat panel's own session list, also workspace-scoped). Enumerating every
 * such reaction by hand is a whack-a-mole that says nothing about
 * Marketplace; scoping to this domain's own prefixes proves the actual claim
 * — nothing MARKETPLACE-FLAVOURED beyond Overview's set fired — without
 * being coupled to unrelated app plumbing this batch never touched.
 */
const MARKETPLACE_RPC_PREFIXES = [
  'mcpDirectory:',
  'skillsSh:',
  'plugins:',
  'harness:',
] as const;

test.describe('Marketplace (lazy route, TASK_2026_533)', () => {
  test('renders the marketplace shell after the lazy chunk resolves', async ({
    ui,
    rendererConsoleErrors,
  }) => {
    // Snapshot BEFORE navigating, so the RPC-allowlist check below only looks
    // at calls this mount itself produced — not app-boot traffic (workspace
    // sync, auth status, etc.) that already landed earlier in the test.
    const callsBeforeMount = (await ui.getAllObservedCalls()).length;

    await ui.goto('marketplace');

    const page = ui.page;
    const shell = page.locator('[data-testid="marketplace-shell"]');

    await expect(shell).toBeVisible();

    // A visible shell already proves the outlet swapped. This is the extra,
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

    // The bare `/marketplace` redirect (`restoreMarketplaceRoute`) lands on
    // Overview by default, and the shell renders NO `<h1>` of its own (plan
    // C6): every page renders exactly one, so this is the Overview page's.
    await expect(
      page.getByRole('heading', { name: 'Marketplace', exact: true }),
    ).toBeVisible();

    // The header renders in both hosts (plan C6, TASK_2026_540 Gate 2): one
    // slim row with the mark and a `Marketplace / <page>` breadcrumb. In
    // Electron it carries NO back button — the surface is opened from the
    // global configuration menu, not an in-surface affordance (`showBack =
    // !vscode.isElectron`).
    const breadcrumb = shell.locator('[data-testid="marketplace-breadcrumb"]');
    await expect(breadcrumb).toContainText('Marketplace');
    // The two-part crumb only renders once `pageLabel()` is non-null, which
    // needs a `NavigationEnd` already parsed by `marketplaceRouteOfUrl`
    // (marketplace-shell.component.ts:162-190). Before that settles — or if
    // that wiring regresses — the template's `@else` branch renders the SAME
    // first-crumb text, "Marketplace", with no second segment
    // (marketplace-shell.component.html:57-64), so the `toContainText` check
    // above alone would pass on either branch. The `[aria-current="page"]`
    // crumb distinguishes them: it reads "Overview" only on the settled,
    // two-part branch, and "Marketplace" on the fallback — so asserting its
    // exact text pins the Gate 2 contract for real.
    await expect(
      breadcrumb.locator('[aria-current="page"]'),
    ).toHaveText('Overview');
    const back = shell.locator('[data-testid="marketplace-back"]');
    await expect(back).toHaveCount(0);

    // Confirms the mounted component is real, not a frozen shell: the
    // persistent nav (`marketplace-nav.component.ts`) renders from the static
    // MARKETPLACE_NAV_GROUPS with zero RPC calls — its counts come only from
    // inventory slices that are already `ready`, and nothing here loads one —
    // so this is safe to assert without mocking anything. TASK_2026_533
    // replaced the three-tab section strip (Connected / Apps / Skills) with
    // the nav's "Marketplace" group (Overview / Connectors / MCP Servers /
    // Skills & Plugins).
    const nav = shell.locator('[data-testid="marketplace-nav"]');
    for (const navId of ['overview', 'connectors', 'servers', 'skills']) {
      await expect(nav.locator(`[data-nav-id="${navId}"]`)).toBeVisible();
    }

    // Prove the REAL claim: within the Marketplace/Overview RPC domain, the
    // mount's traffic is exactly Overview's own documented read set, nothing
    // more. First wait for Overview's unconditional reads to land — `ui.goto`
    // only waits for the shell's host element to attach, not for the child
    // page's RPCs to resolve — then snapshot every call fired since this test
    // started, keep only the Marketplace-domain ones (see
    // `MARKETPLACE_RPC_PREFIXES`), and assert each is on the allowlist. This
    // is a bounded/allowlist check, not a full RPC-set pin (that belongs at
    // the unit level, plan Task 14.1): it does not require every allowlisted
    // method to have fired (`oauthStatus` legitimately might not), only that
    // nothing OUTSIDE the set did.
    await Promise.all(
      OVERVIEW_UNCONDITIONAL_READS.map((method) =>
        ui.waitForObservedCall(method),
      ),
    );
    const callsSinceMount = (await ui.getAllObservedCalls()).slice(
      callsBeforeMount,
    );
    const marketplaceMethodsSinceMount = new Set(
      callsSinceMount
        .map((call) => call.method)
        .filter((method) =>
          MARKETPLACE_RPC_PREFIXES.some((prefix) => method.startsWith(prefix)),
        ),
    );
    for (const method of marketplaceMethodsSinceMount) {
      expect(OVERVIEW_MOUNT_RPC_ALLOWLIST as readonly string[]).toContain(
        method,
      );
    }
  });
});
