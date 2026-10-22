import { test, expect } from '../../support/fixtures';

/** Retained eager push handlers work while the Thoth tab is unopened. */
test.describe('Thoth MESSAGE_HANDLERS — eager while Thoth is unopened (R4, TASK_2026_187)', () => {
  test('GatewayStateService: gateway:statusChanged lands before Thoth is ever opened', async ({
    ui,
  }) => {
    await ui.mockRpc({
      // Deliberately malformed (no `adapters`): makes the mount-time
      // `refreshStatus()` throw internally (caught by its own try/catch,
      // gateway-state.service.ts:284-291) instead of silently overwriting
      // `platforms` with a fresh "everything stopped" baseline. This is what
      // lets the FIRST tab open prove the pre-open push, not just echo the
      // RPC mock.
      'gateway:status': { enabled: true },
      'gateway:listBindings': { bindings: [] },
    });

    // Push while still on 'chat' — Thoth has not been opened yet in this test.
    await ui.pushEvent({
      type: 'gateway:statusChanged',
      payload: {
        origin: null,
        status: {
          enabled: true,
          adapters: [
            { platform: 'telegram', running: true },
            { platform: 'discord', running: true },
            { platform: 'slack', running: false },
          ],
        },
      },
    });

    // First-ever Thoth mount. If the push had been dropped (broken
    // registration), `platforms` would still be at its constructor default
    // (`emptyStatusMap()` — all 'stopped'), and the malformed RPC mock
    // cannot supply a different answer (it throws, caught, no-op).
    await ui.openTab('gateway');

    const page = ui.page;
    await expect(
      page.locator('[data-testid="gateway-tile-status-telegram"]'),
    ).toHaveText('running');
    await expect(
      page.locator('[data-testid="gateway-tile-status-discord"]'),
    ).toHaveText('running');
    await expect(
      page.locator('[data-testid="gateway-tile-status-slack"]'),
    ).toHaveText('stopped');
  });

  test('VecEmbedderRecoveryService: db:vecStatusChanged lands before Thoth is ever opened', async ({
    ui,
  }) => {
    await ui.mockRpc({
      'memory:stats': {
        core: 0,
        recall: 0,
        archival: 0,
        codeIndex: 0,
        lastCuratedAt: null,
      },
      'memory:list': { memories: [], total: 0 },
      'memory:searchSymbols': { items: [], total: 0 },
      'indexing:getStatus': {
        state: 'ready',
        lastIndexedAt: null,
        pipelineEnabled: true,
      },
      // Deliberately omits `vecDiagnostic` — `primeVecDiagnostic()` only
      // overwrites `_vecDiagnostic` when `result.data?.vecDiagnostic` is
      // present (vec-embedder-recovery.service.ts:127), an explicit
      // "best-effort prime, push events keep state fresh" guard already in
      // the product. This lets the pre-open push survive the Maintenance
      // panel's own mount-time prime() on first open.
      'db:health': {},
    });

    // Push while still on 'chat' — Thoth has not been opened yet.
    await ui.pushEvent({
      type: 'db:vecStatusChanged',
      payload: {
        ok: true,
        diagnostic: {
          ok: true,
          reason: 'ok',
          electronVersion: '32.0.0',
          processArch: 'x64',
          processPlatform: 'win32',
        },
      },
    });

    await ui.openTab('memory');

    const page = ui.page;
    // db-health-panel only mounts once the Maintenance sub-view is selected
    // (memory-curator-tab.component.ts's own @switch).
    await page.getByRole('tab', { name: 'Maintenance' }).click();

    await expect(page.locator('[data-testid="vec-badge"]')).toHaveText(
      'online',
    );
  });

  test('ThothStatusService: gateway:statusChanged survives a close → push → reopen round trip', async ({
    ui,
  }) => {
    await ui.mockRpc({
      // Well-formed baseline — the FIRST open must succeed cleanly so
      // `refreshIfNeeded()` records `_hasLoadedOnce = true`
      // (thoth-status.service.ts:262-266, "only on the first call").
      'gateway:status': {
        enabled: true,
        adapters: [
          { platform: 'telegram', running: false },
          { platform: 'discord', running: false },
          { platform: 'slack', running: false },
        ],
      },
      'gateway:listBindings': { bindings: [] },
    });

    // First open: establishes the "already loaded once" state so the second
    // open below cannot re-fetch and clobber the push.
    await ui.openTab('gateway');

    const page = ui.page;
    const gatewayPillarValue = page.locator(
      '[data-testid="dashboard-status-card"][data-pillar="gateway"] [data-testid="dashboard-status-card-value"]',
    );
    await expect(gatewayPillarValue).toHaveText('0');

    // Leave Thoth entirely — this destroys ThothShellComponent (and every
    // Thoth tab component with it). GatewayStateService and ThothStatusService
    // are root singletons and persist untouched.
    await ui.goto('chat');
    await expect(page.locator('[id^="thoth-panel-"]')).toHaveCount(0);

    // Push while Thoth is closed — the R4 moment.
    await ui.pushEvent({
      type: 'gateway:statusChanged',
      payload: {
        origin: null,
        status: {
          enabled: true,
          adapters: [
            { platform: 'telegram', running: true },
            { platform: 'discord', running: true },
            { platform: 'slack', running: false },
          ],
        },
      },
    });

    // Reopen. `refreshIfNeeded()` is a no-op this time (already loaded once),
    // so nothing can overwrite what the push set while Thoth was closed.
    await ui.openTab('gateway');
    await expect(gatewayPillarValue).toHaveText('2');
  });
});

