/**
 * E2E: Marketplace server-facing content — the blocked-row lock badge and
 * copy command, the `@container` catalog grid, the chat -> Marketplace
 * skills deep link (D2), the dashboard skill-picker restyle (Task 24.2,
 * moved here per `batches.md` "Task 24.2: Dashboard picker check — COMPLETE
 * (layout check moved to Batch 25)"), the registry browser's vendor mark
 * (Batch 24a), and a workspace switch with a Marketplace detail open
 * (TASK_2026_540 remount, External coordination item 6).
 *
 * Same real-bundle pattern as `./marketplace-routes.e2e.spec.ts` — see that
 * file's header and `./marketplace.fixtures.ts` for the host/RPC mechanism.
 */
import { test, expect } from '../../test-fixtures';
import { installPostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';
import {
  baseMarketplaceFixtures,
  geometryStressFixtures,
  installHost,
  installRpcAutoResponder,
  statefulListInstalledResolver,
  STRESS_SERVER_KEY,
  STRESS_STATUS_TEXT,
  waitForAnimationsSettled,
  waitForCatalogCardMarkResolved,
} from './marketplace.fixtures';

test.use({ useAppBuild: true });

test.describe('webview > marketplace > blocked row lock badge', () => {
  test('shows a lock badge with a popover, reason and copy command — never a paragraph', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    await installRpcAutoResponder(page, baseMarketplaceFixtures());
    await page.goto(fixtureServer.url);
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.locator('a[data-nav-id="servers"]').click();
    await expect(page.locator('[data-testid="provider-list-rows"]')).toBeVisible();

    // `sentry` is blocked (`removal: 'none'`) — the action column shows a
    // compact lock badge, never a paragraph in its place.
    const row = page
      .locator('[data-testid="provider-list-rows"]')
      .locator('tr, [data-testid="provider-card"]')
      .filter({ hasText: 'sentry' })
      .first();
    const lockButton = row.locator('[data-testid="removal-lock-button"]');
    await expect(lockButton).toBeVisible();
    await expect(lockButton).toHaveAccessibleName('Removal blocked — details');

    await lockButton.click();
    const details = page.locator('[data-testid="removal-lock-details"]');
    await expect(details).toBeVisible();
    await expect(page.locator('[data-testid="removal-lock-reason"]')).toContainText(
      'belongs to the Claude CLI',
    );
    await expect(page.locator('[data-testid="removal-fix-command"]')).toHaveText(
      'claude mcp remove sentry',
    );
  });

  test('copies the fix command to the clipboard, and falls back to text selection when the clipboard is unavailable', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    await installRpcAutoResponder(page, baseMarketplaceFixtures());

    // Happy path: a working clipboard.
    let clipboardText = '';
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => {
            (window as unknown as { __copied?: string }).__copied = text;
            return Promise.resolve();
          },
        },
      });
    });
    await page.goto(fixtureServer.url);
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.locator('a[data-nav-id="servers"]').click();
    const row = page
      .locator('[data-testid="provider-list-rows"]')
      .locator('tr, [data-testid="provider-card"]')
      .filter({ hasText: 'sonarqube' })
      .first();
    await row.locator('[data-testid="removal-lock-button"]').click();
    await expect(page.locator('[data-testid="removal-fix-command"]')).toHaveText(
      'claude mcp remove sonarqube',
    );
    await page.locator('[data-testid="copy-command-button"]').click();
    clipboardText = await page.evaluate(
      () => (window as unknown as { __copied?: string }).__copied ?? '',
    );
    expect(clipboardText).toBe('claude mcp remove sonarqube');
    await expect(page.locator('[data-testid="copy-command-status"]')).toHaveText(
      'Copied',
    );
  });

  test('falls back to selecting the command text when the clipboard write is denied', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    await installRpcAutoResponder(page, baseMarketplaceFixtures());
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => {
            const err = new Error('denied');
            err.name = 'NotAllowedError';
            return Promise.reject(err);
          },
        },
      });
    });
    await page.goto(fixtureServer.url);
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.locator('a[data-nav-id="servers"]').click();
    // `sentry` — NOT the last blocked row in this fixture (`sonarqube` sorts
    // after it) — is the row Batch 25a's stacking fix
    // (`provider-table.component.ts`/`provider-card-list.component.ts`,
    // commit `838d22c51`, copied into this worktree in Revise round 1 item 7)
    // was built to unblock: before that fix, the action cell's own
    // `relative z-10` gave every row its own stacking context, so a
    // non-last blocked row's floating popover was painted over — and its
    // Copy button intercepted — by the next row. A real click (no
    // `force: true`, no `waitForTimeout`) below is the regression pin for
    // that defect; it fails 2/2 on the pre-fix components per the 25a
    // commit message.
    const row = page
      .locator('[data-testid="provider-list-rows"]')
      .locator('tr, [data-testid="provider-card"]')
      .filter({ hasText: 'sentry' })
      .first();
    await row.locator('[data-testid="removal-lock-button"]').click();
    await page.locator('[data-testid="copy-command-button"]').click();

    await expect(page.locator('[data-testid="copy-command-status"]')).toHaveText(
      /selected/i,
    );
    const selectedText = await page.evaluate(() => window.getSelection()?.toString());
    expect(selectedText).toBe('claude mcp remove sentry');
  });
});

test.describe('webview > marketplace > @container catalog grid', () => {
  test('ptah-catalog-grid steps 1/2/3/4 columns off the CONTAINER width, and 400px has no horizontal scroll', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    await installRpcAutoResponder(page, baseMarketplaceFixtures());
    await page.goto(fixtureServer.url);
    await page.locator('a[data-nav-id="ptah-plugins"]').click();
    const grid = page.locator('[data-testid="catalog-grid"]').first();
    await expect(grid).toBeVisible();

    // Sample several viewport widths (900 is the regular-tier floor per D3 —
    // wide starts at >=1400 — the other three are wide; corrected in Revise
    // round 1, code-logic-review Minor #2, which is not a coverage gap: this
    // assertion measures the grid's own container box regardless of shell
    // tier) and check the REAL measured container width against the
    // documented formula, rather than assuming exact chrome consumption.
    for (const viewport of [900, 1300, 1700, 2000]) {
      await page.setViewportSize({ width: viewport, height: 900 });
      const box = await grid.boundingBox();
      expect(box).not.toBeNull();
      const width = box?.width ?? 0;
      const expectedColumns = width >= 1200 ? 4 : width >= 800 ? 3 : width >= 480 ? 2 : 1;
      const columnCount = await grid.evaluate((el) => {
        const style = getComputedStyle(el);
        return style.gridTemplateColumns.trim().split(/\s+/).length;
      });
      expect(columnCount).toBe(expectedColumns);
    }

    // Compact: 400px must render with no horizontal overflow.
    await page.setViewportSize({ width: 400, height: 800 });
    await expect(page.locator('[data-testid="marketplace-shell"]')).toHaveAttribute(
      'data-tier',
      'compact',
    );
    const overflowing = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflowing).toBe(false);
  });
});

test.describe('webview > marketplace > D2 deep link from chat', () => {
  test('"Open Marketplace Skills" in the chat empty state navigates to skills/ptah-plugins', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'chat');
    // `!hasConfiguredSkills()` (the warning + deep-link button) renders when
    // the catalog is loaded and reports zero enabled plugins.
    await installRpcAutoResponder(page, {
      ...baseMarketplaceFixtures(),
      'plugins:get-config': {
        enabledPluginIds: [],
        disabledSkillIds: [],
        disabledPluginIds: [],
      },
    });
    await page.goto(fixtureServer.url);

    // The empty state (`ChatEmptyStateComponent`) mounts inside a session
    // TILE's transcript (`chat-transcript.component.html`), not on the
    // Orchestra Canvas landing screen — open one the same way a user would.
    // "Create new session" opens a small "New Session" name popup; confirm
    // it with its own "Create" button (blank name is fine, it is optional).
    await page.getByRole('button', { name: 'Create new session' }).click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const openSkills = page.getByRole('button', { name: 'Open Marketplace Skills' });
    await expect(openSkills).toBeVisible();
    await openSkills.click();

    await expect(page.locator('[data-testid="marketplace-shell"]')).toBeVisible();
    // DOM state, not `page.url()`: the Router runs on `MemoryPlatformLocation`
    // (see `./marketplace-routes.e2e.spec.ts`'s route-memory test note).
    await expect(
      page.locator('a[data-nav-id="ptah-plugins"][aria-current="page"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid="marketplace-breadcrumb"] [aria-current="page"]'),
    ).toHaveText('Ptah Plugins');
  });
});

test.describe('webview > marketplace > dashboard skill-picker restyle', () => {
  test('the plugin catalog inside the max-w-2xl dialog resolves to 2 columns with no horizontal overflow', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'analytics');
    await installRpcAutoResponder(page, baseMarketplaceFixtures());
    await page.goto(fixtureServer.url);
    await page.setViewportSize({ width: 1100, height: 900 });

    const chooseButton = page.locator('[data-testid="skill-selection-card-choose"]');
    await expect(chooseButton).toBeVisible();
    await chooseButton.click();

    const dialog = page.locator('dialog.modal.modal-open .modal-box.max-w-2xl');
    await expect(dialog).toBeVisible();
    const grid = dialog.locator('[data-testid="catalog-grid"]').first();
    await expect(grid).toBeVisible();

    const columnCount = await grid.evaluate((el) => {
      const style = getComputedStyle(el);
      return style.gridTemplateColumns.trim().split(/\s+/).length;
    });
    // The dialog is `max-w-2xl` (42rem / 672px content), which the grid's own
    // `@container` formula (`marketplace-servers` container-grid test) steps
    // to 2 columns.
    expect(columnCount).toBe(2);

    const overflowing = await dialog.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1,
    );
    expect(overflowing).toBe(false);
  });
});

test.describe('webview > marketplace > registry browser vendor mark', () => {
  test('shows the Sentry vendor mark for the allowlisted listing and a monogram for a look-alike', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    await installPostMessageBridge(page);
    await installHost(page, 'vscode', 'marketplace');
    await installRpcAutoResponder(page, baseMarketplaceFixtures());
    await page.goto(fixtureServer.url);
    await page.locator('a[data-nav-id="registry"]').click();

    const cards = page.locator('[data-testid="catalog-card"]');
    await expect(cards).toHaveCount(2);
    const sentryCard = cards.filter({ hasText: 'getsentry' });
    const lookalikeCard = cards.filter({ hasText: 'attacker/github' });

    // The vendor mark is behind `@defer (on immediate)` (Batch 24a) — wait
    // for the lazy chunk to resolve via the shared helper (also used by the
    // registry visual-parity capture, Revise round 2 item A1) before
    // asserting WHICH mark it resolved to.
    await waitForCatalogCardMarkResolved(sentryCard);
    await expect(sentryCard.locator('[card-mark] ptah-brand-mark')).toBeVisible();
    await expect(lookalikeCard.locator('ptah-brand-mark')).toHaveCount(0);
    await expect(lookalikeCard.locator('ptah-monogram-tile[card-mark]')).toBeVisible();
  });
});

test.describe('webview > marketplace > workspace switch with a detail open (TASK_2026_540 remount)', () => {
  test('the URL stays put, the shell remounts, a gone ref renders Not Found and a present one re-renders', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    const bridge = await installPostMessageBridge(page);
    // Electron only: "the VS Code webview never reaches this branch"
    // (`app-state.service.ts` `switchWorkspace` doc comment) — the remount
    // effect is Electron-shell-specific.
    //
    // Boot to chat first, THEN switchView into the Marketplace — booting
    // directly on `initialView: 'marketplace'` races Electron's own startup
    // (see `./marketplace-routes.e2e.spec.ts`'s `bootMarketplace` doc
    // comment for the mechanism).
    await installHost(page, 'electron', 'chat');
    await installRpcAutoResponder(page, {
      ...baseMarketplaceFixtures(['C:\\ptah-e2e-ws-a', 'C:\\ptah-e2e-ws-b']),
      'mcpDirectory:listInstalled': statefulListInstalledResolver(),
    });
    await page.goto(fixtureServer.url);
    await expect(page.locator('ptah-electron-shell').first()).toBeVisible();
    await bridge.inject({ type: 'switchView', payload: { view: 'marketplace' } });
    await expect(page.locator('[data-testid="marketplace-shell"]')).toBeVisible();

    // Wide tier so the detail docks instead of opening as an overlay drawer:
    // the drawer's full-viewport backdrop would otherwise block the
    // workspace-sidebar click below, which is not what this scenario is
    // testing. Electron's own chrome (workspace sidebar) eats part of the
    // viewport before it reaches the marketplace shell, so the viewport is
    // wider than the 1400px wide-tier threshold by a comfortable margin.
    await page.setViewportSize({ width: 1800, height: 900 });

    // Open a detail that workspace B's (reduced) answer will NOT contain:
    // `ptah` (harness-config:ptah), present only in the first
    // `mcpDirectory:listInstalled` answer.
    await page.locator('a[data-nav-id="servers"]').click();
    const ptahRow = page
      .locator('[data-testid="provider-list-rows"]')
      .locator('tr, [data-testid="provider-card"]')
      .filter({ hasText: 'ptah' })
      .first();
    await ptahRow.locator('[data-testid="provider-row-open"]').click();
    await expect(page.locator('[data-testid="server-detail-title"]')).toBeVisible();
    // Confirm the wide/docked branch (no overlay backdrop left behind to
    // intercept the sidebar click below).
    await expect(page.locator('[data-testid="marketplace-shell"]')).toHaveAttribute(
      'data-tier',
      'wide',
    );
    await expect(page.locator('[data-testid="native-drawer-backdrop"]')).toHaveCount(0);

    // Switch workspaces through the real sidebar (title = folder path). A
    // real actionability check runs here (code-logic-review Serious #2): no
    // `force: true` — the drawer-backdrop assertion two lines above is the
    // guard against the one known overlap in this component family (the
    // lock-popover defect), and this click is nowhere near that popover.
    await page.locator('[title="C:\\\\ptah-e2e-ws-b"]').click();

    // (a) the URL/route is unchanged (still the MCP Servers page — checked
    // through DOM state, since the Router runs on `MemoryPlatformLocation`
    // and never touches `page.url()`), (b) the shell was re-created (a fresh
    // mount fires a fresh `mcpDirectory:listInstalled`, which is how the
    // reduced answer reaches the page at all), and (c) `ptah` no longer
    // exists in workspace B's answer, so its detail route now renders "Not
    // found".
    await expect(
      page.locator('[data-testid="marketplace-breadcrumb"] [aria-current="page"]'),
    ).toHaveText('MCP Servers');
    await expect(page.locator('[data-testid="marketplace-shell"]')).toBeVisible();
    await expect(page.locator('[data-testid="server-detail-not-found"]')).toBeVisible({
      timeout: 10_000,
    });

    // A still-present ref re-renders normally after the switch.
    await page.locator('a[data-nav-id="servers"]').click();
    const firecrawlRow = page
      .locator('[data-testid="provider-list-rows"]')
      .locator('tr, [data-testid="provider-card"]')
      .filter({ hasText: 'firecrawl' })
      .first();
    await expect(firecrawlRow).toBeVisible();
    await firecrawlRow.locator('[data-testid="provider-row-open"]').click();
    await expect(page.locator('[data-testid="server-detail-title"]')).toContainText(
      'firecrawl',
    );
  });
});

test.describe('webview > marketplace > server detail geometry (Batch 25b regression, commit e27935086)', () => {
  for (const host of ['vscode', 'electron'] as const) {
    test(`every Overview row value stays inside the drawer panel at 1100px, even with an unbroken long status string (${host})`, async ({
      page,
      fixtureServer,
    }) => {
      await installCspStub(page);
      const bridge = await installPostMessageBridge(page);
      // Boot to chat first, THEN switchView into the Marketplace — booting
      // directly on `initialView: 'marketplace'` races Electron's own
      // startup (see `./marketplace-routes.e2e.spec.ts`'s `bootMarketplace`
      // doc comment for the mechanism; harmless but unnecessary for VS
      // Code, so the same boot path is used for both hosts here).
      await installHost(page, host, 'chat');
      await installRpcAutoResponder(page, geometryStressFixtures());
      await page.goto(fixtureServer.url);
      const readySelector = host === 'electron' ? 'ptah-electron-shell' : 'ptah-app-shell';
      await expect(page.locator(readySelector).first()).toBeVisible();
      await bridge.inject({ type: 'switchView', payload: { view: 'marketplace' } });
      const shell = page.locator('[data-testid="marketplace-shell"]');
      await expect(shell).toBeVisible();
      // VS Code: the viewport IS the shell width. Electron: widen past its
      // own chrome (the same seed `fitShellWidth` uses elsewhere in this
      // scenario folder) and confirm regular tier landed, rather than the
      // full iterative measure-and-retry loop — this test only needs SOME
      // regular-tier width, not an exact 1100px shell, because the drawer
      // panel is a fixed `max-w-md` regardless of the shell's own width.
      await page.setViewportSize({
        width: host === 'vscode' ? 1100 : 1100 + 260,
        height: 900,
      });
      await expect(shell).toHaveAttribute('data-tier', 'regular');

      await page.locator('a[data-nav-id="servers"]').click();
      const stressRow = page
        .locator('[data-testid="provider-list-rows"]')
        .locator('tr, [data-testid="provider-card"]')
        .filter({ hasText: STRESS_SERVER_KEY })
        .first();
      await expect(stressRow).toBeVisible();
      await stressRow.locator('[data-testid="provider-row-open"]').click();

      const drawerPanel = page.locator('[data-testid="native-drawer-panel"]');
      const drawerBody = page.locator('[data-testid="native-drawer-body"]');
      await expect(page.locator('[data-testid="provider-detail-drawer"]')).toBeVisible();
      // Confirm the stress value actually reached the page — if this fails,
      // the fixture wiring is broken, not the geometry under test.
      await expect(
        page.locator('[data-testid="server-detail-status"]'),
      ).toContainText(STRESS_STATUS_TEXT);
      await waitForAnimationsSettled(drawerPanel);

      // The regression itself: the drawer body must never need to scroll
      // sideways (Batch 25b: "the drawer body scrolled sideways" on the
      // pre-fix template), and every Overview row's VALUE cell (the `dd`
      // half of each label/value pair — Status, Origin, Config files, and
      // any Connected/Created rows that render) must end at or before the
      // panel's own right edge. Real bounding boxes from the real browser,
      // not a class-name check, so this fails on whichever future change
      // reintroduces the overflow, not just on `min-w-0` disappearing.
      const overflowsSideways = await drawerBody.evaluate(
        (el) => el.scrollWidth > el.clientWidth + 1,
      );
      expect(
        overflowsSideways,
        'drawer body needs to scroll sideways — an Overview row is wider than the panel',
      ).toBe(false);

      const panelBox = await drawerPanel.boundingBox();
      expect(panelBox, 'drawer panel has no bounding box — not actually open').not.toBeNull();
      const valueCells = drawerPanel.locator('dl.divide-y > div > dd');
      const valueCount = await valueCells.count();
      expect(valueCount, 'no Overview rows found to check').toBeGreaterThan(0);
      for (let i = 0; i < valueCount; i += 1) {
        const cell = valueCells.nth(i);
        const box = await cell.boundingBox();
        expect(box, `Overview row ${i} value has no bounding box`).not.toBeNull();
        expect(
          box!.x + box!.width,
          `Overview row ${i} value's right edge (${box!.x + box!.width}) is past the panel's right edge (${panelBox!.x + panelBox!.width})`,
        ).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
      }
    });
  }
});
