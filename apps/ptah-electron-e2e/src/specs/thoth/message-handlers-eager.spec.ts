import { test, expect } from '../../support/fixtures';

/**
 * R4 gate (TASK_2026_187 Batch 3) — independent e2e confirmation, against
 * the real running app, that the four `MESSAGE_HANDLERS` services
 * (`GatewayStateService`, `SkillSynthesisLiveService`,
 * `VecEmbedderRecoveryService`, `ThothStatusService`) still receive their
 * push messages now that `ThothShellComponent` is behind
 * `@defer (on immediate)` and the four services import through narrow
 * `/services` barrels instead of the wide ones.
 *
 * `apps/ptah-extension-webview/src/app/thoth-message-routing.spec.ts`
 * (Jest, developer's own artifact — batch-3-report.md §7) already proves
 * this at the `MessageRouterService` unit level. This file proves the same
 * property against the actual Electron renderer, with the actual deferred
 * chunk, and — the part the Jest spec cannot reach — with Thoth's DOM
 * genuinely never having been created.
 *
 * **Why "push it, then open the tab and look" is NOT enough on its own**,
 * for three of the four services: opening the relevant Thoth tab also
 * triggers that tab's OWN independent RPC-driven refresh on mount
 * (`GatewayStateService.initialize()`, `ThothStatusService.refreshIfNeeded()`
 * on first load, `db-health-panel`'s `VecEmbedderRecoveryService.prime()`).
 * If that refresh silently overwrote whatever the push had set, a test that
 * only asserts "the tab shows the right thing after I push and then open it"
 * would keep passing even if the push were silently dropped — the mount's
 * own fetch would produce a correct-looking screen regardless. That is
 * exactly the "materially weaker check" this file exists to close. Each
 * test below is built around a specific, verified mechanism that prevents
 * the post-open refresh from being able to launder a dropped push:
 *
 * - `SkillSynthesisLiveService`: its handling of a `curator-pass` event
 *   triggers `SkillSynthesisStateService.loadStats()` — an RPC call
 *   (`skillSynthesis:stats`) — as a direct side effect, observable via
 *   `ui.getObservedCalls` with **zero UI ever mounted**. This is the
 *   cleanest proof of the four: no tab, no DOM, no race.
 * - `GatewayStateService`: `gateway:status` is mocked to omit `adapters`.
 *   `GatewayStateService.applyStatus` calls `status.adapters.find(...)`
 *   with no guard (`gateway-state.service.ts`), so the mount-time
 *   `refreshStatus()` throws internally and is caught by its own
 *   try/catch — `platforms` is left untouched, and the pre-mount push
 *   survives to be observed on the *first* tab open.
 * - `VecEmbedderRecoveryService`: `db:health` is mocked to omit
 *   `vecDiagnostic`. `primeVecDiagnostic()` explicitly guards on
 *   `result.data?.vecDiagnostic` before overwriting
 *   (`vec-embedder-recovery.service.ts:127`, comment: *"push events keep
 *   state fresh after this"*) — an intentional product behaviour this test
 *   leans on, not an incidental throw.
 * - `ThothStatusService`: its `loadGateway()` is defensive
 *   (`derivePlatformSummaries` falls back safely on malformed data instead
 *   of throwing), so the omit-a-field trick does NOT work here — a
 *   malformed mock would make it silently overwrite `_gateway` with a
 *   clean "everything stopped" fallback. Instead: open once with a
 *   well-formed baseline (satisfies `refreshIfNeeded()`'s
 *   "only on the first call" guard), navigate away (destroys
 *   `ThothShellComponent`; the service is a root singleton and persists),
 *   push while Thoth is closed, reopen — `refreshIfNeeded()` is now a
 *   no-op, so the second mount cannot clobber the push.
 */
test.describe('Thoth MESSAGE_HANDLERS — eager while Thoth is unopened (R4, TASK_2026_187)', () => {
  test('SkillSynthesisLiveService: curator-pass triggers a stats refresh with Thoth never opened', async ({
    ui,
  }) => {
    // No ui.openTab call anywhere in this test — 'chat' is the default view
    // for the whole test, and no Thoth component of any kind is ever created.
    await ui.pushEvent({
      type: 'skillSynthesis:event',
      payload: {
        event: {
          kind: 'curator-pass',
          timestamp: Date.now(),
          stats: { suggestionsCreated: 1 },
        },
      },
    });

    // loadStats() is called unconditionally on 'curator-pass'
    // (skill-synthesis-live.service.ts) — this RPC firing with zero UI
    // mounted is direct proof `SkillSynthesisLiveService` is alive,
    // registered, and processed the message.
    const observed = await ui.waitForObservedCall('skillSynthesis:stats');
    expect(observed.method).toBe('skillSynthesis:stats');
  });

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
