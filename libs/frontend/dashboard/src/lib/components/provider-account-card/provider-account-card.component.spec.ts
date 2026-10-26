/**
 * ProviderAccountCardComponent — owner mapping and data flow only
 * (TASK_2026_707): selection order, per-owner tiles in the responsive grid,
 * the provider effect, Refresh, the empty snapshot, the refresh-failed
 * notice, and one pass through the REAL store with a fake RPC.
 *
 * The per-window presentation moved to `ProviderAccountTileComponent` and
 * `plan-tile-view.model.ts`, which carry their own specs.
 */
import { LOCALE_ID, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  AppStateManager,
  AuthStateService,
  ClaudeRpcService,
  PlanLimitsStore,
  RpcResult,
} from '@ptah-extension/core';
import {
  formatLocalAbsolute,
  formatRelative,
  type PlanLimitOwnerSnapshot,
  type PlanLimitWindow,
  type PlanLimitsSnapshot,
} from '@ptah-extension/shared';

import { ProviderAccountCardComponent } from './provider-account-card.component';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 9, 3, 12, 0);
const ZONE = new Intl.DateTimeFormat().resolvedOptions().timeZone;
const abs = (instant: number) =>
  formatLocalAbsolute(instant, NOW, {
    timeZone: ZONE,
    zoneNameLocale: 'en-US',
  });

function win(
  overrides: Partial<PlanLimitWindow> & Pick<PlanLimitWindow, 'key' | 'label'>,
): PlanLimitWindow {
  return {
    kind: 'other',
    observedAt: NOW - 2 * MIN,
    ...overrides,
  } as PlanLimitWindow;
}

function owner(
  providerId: string,
  label: string,
  overrides: Partial<PlanLimitOwnerSnapshot> = {},
  fingerprint = '0123456789abcdef',
): PlanLimitOwnerSnapshot {
  return {
    owner: {
      key: `${providerId}#account:${fingerprint}`,
      providerId,
      identityKind: 'account',
      label,
    },
    status: 'available',
    windowSetEstablished: true,
    windows: [],
    ownerEvidence: [],
    ...overrides,
  };
}

const snapshotOf = (
  ...owners: PlanLimitOwnerSnapshot[]
): PlanLimitsSnapshot => ({
  generatedAt: NOW,
  owners,
  sessionOwners: {},
});

interface FakeStore {
  snapshot: WritableSignal<PlanLimitsSnapshot | null>;
  loading: WritableSignal<boolean>;
  loadError: WritableSignal<boolean>;
  now: WritableSignal<number>;
  load: jest.Mock;
}

describe('ProviderAccountCardComponent', () => {
  let store: FakeStore;
  let providerId: WritableSignal<string>;
  /** Tile inline actions navigate through app state. */
  let appState: { setCurrentView: jest.Mock; openSettingsTab: jest.Mock };
  let fixture: ComponentFixture<ProviderAccountCardComponent>;

  function render(
    snapshot: PlanLimitsSnapshot | null,
    locale?: string,
  ): HTMLElement {
    store = {
      snapshot: signal(snapshot),
      loading: signal(false),
      loadError: signal(false),
      now: signal(NOW),
      load: jest.fn().mockResolvedValue(undefined),
    };
    providerId = signal('anthropic');
    appState = { setCurrentView: jest.fn(), openSettingsTab: jest.fn() };
    TestBed.configureTestingModule({
      imports: [ProviderAccountCardComponent],
      providers: [
        { provide: PlanLimitsStore, useValue: store },
        {
          provide: AuthStateService,
          useValue: { activeProviderId: providerId },
        },
        { provide: AppStateManager, useValue: appState },
        ...(locale ? [{ provide: LOCALE_ID, useValue: locale }] : []),
      ],
    });
    fixture = TestBed.createComponent(ProviderAccountCardComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const tiles = (el: HTMLElement) =>
    Array.from(
      el.querySelectorAll<HTMLElement>(
        '[data-testid="provider-account-tile"]',
      ),
    );
  const textOf = (el: Element | null | undefined) =>
    el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('is its own titled Dashboard section, independent of session analytics', () => {
    const el = render(snapshotOf(owner('anthropic', 'Claude account')));
    const section = el.querySelector(
      '[data-testid="dashboard-section-provider-accounts"]',
    );
    expect(section?.className).toContain('surface-1');
    expect(section?.getAttribute('aria-labelledby')).toBe(
      'provider-accounts-heading',
    );
    expect(textOf(el.querySelector('#provider-accounts-heading'))).toBe(
      'Provider accounts & plan limits',
    );
    expect(el.querySelector('#provider-accounts-heading')?.getAttribute('title')).toContain('90% (near limit)');
  });

  it('renders one compact tile per owner in the auto-fit grid', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account'),
        owner('openai-codex', 'Codex account'),
        owner('opencode', 'OpenCode account'),
      ),
    );
    const list = el.querySelector<HTMLUListElement>('ul.tiles');
    expect(list).not.toBeNull();
    expect(list?.children.length).toBe(3);
    expect(tiles(el).length).toBe(3);
    // One tile per owner: every grid item hosts exactly one tile.
    expect(
      Array.from(list?.children ?? []).every(
        (li) => li.querySelectorAll('[data-testid="provider-account-tile"]').length === 1,
      ),
    ).toBe(true);
  });

  it('puts the selected provider first and follows a selection change', () => {
    const el = render(
      snapshotOf(
        owner('openai-codex', 'Codex account'),
        owner('anthropic', 'Claude account'),
      ),
    );
    expect(tiles(el)[0]?.getAttribute('aria-label')).toContain('Claude account');
    expect(tiles(el)[1]?.getAttribute('aria-label')).toContain('Codex account');
    providerId.set('openai-codex');
    fixture.detectChanges();
    expect(tiles(el)[0]?.getAttribute('aria-label')).toContain('Codex account');
    expect(tiles(el)[1]?.getAttribute('aria-label')).toContain('Claude account');
  });

  it('suffixes two owners that share the generic label, so their tiles are told apart', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account'),
        owner('anthropic', 'Claude account', {}, 'fedcba9876543210'),
      ),
    );
    const labels = Array.from(
      el.querySelectorAll('[data-testid="tile-label"]'),
    ).map(textOf);
    expect(labels).toEqual(['Claude account · cdef', 'Claude account · 3210']);
    expect(textOf(el)).not.toContain('anthropic#account');
  });

  it('loads exactly {providerId} on start and on every change, and stops after destroy', () => {
    render(snapshotOf());
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(store.load).toHaveBeenLastCalledWith({ providerId: 'anthropic' });
    providerId.set('openai-codex');
    fixture.detectChanges();
    expect(store.load).toHaveBeenCalledTimes(2);
    expect(store.load).toHaveBeenLastCalledWith({ providerId: 'openai-codex' });
    fixture.destroy();
    providerId.set('anthropic');
    TestBed.tick();
    expect(store.load).toHaveBeenCalledTimes(2);
  });

  it('Refresh reloads the selected provider with refresh:true and is disabled while loading', () => {
    const el = render(snapshotOf(owner('anthropic', 'Claude account')));
    const button = el.querySelector<HTMLButtonElement>(
      '[data-testid="tile-refresh"]',
    );
    button?.click();
    expect(store.load).toHaveBeenLastCalledWith({
      providerId: 'anthropic',
      refresh: true,
    });
    store.loading.set(true);
    fixture.detectChanges();
    expect(button?.disabled).toBe(true);
  });

  it('routes a tile action to existing navigation only', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          status: 'service-unavailable',
          unavailableReason: 'no-open-session',
        }),
      ),
    );
    el.querySelector<HTMLButtonElement>(
      '[data-testid="tile-action-open-session"]',
    )?.click();
    expect(appState.setCurrentView).toHaveBeenCalledWith('chat');
    expect(appState.openSettingsTab).not.toHaveBeenCalled();
  });

  it('an empty snapshot shows "Account usage unavailable", never a 0', () => {
    const el = render(snapshotOf());
    expect(
      textOf(el.querySelector('[data-testid="usage-unavailable"]')),
    ).toBe('Account usage unavailable');
    expect(textOf(el)).not.toMatch(/\b0%/);
  });

  it('shows a spinner before the first snapshot while loading', () => {
    const el = render(null);
    store.loading.set(true);
    fixture.detectChanges();
    expect(
      el.querySelector('[aria-label="Loading account usage"]'),
    ).not.toBeNull();
  });

  it('passes the zone-name locale explicitly (LOCALE_ID), through every tile', () => {
    const el = render(
      snapshotOf(
        owner('anthropic', 'Claude account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 10 },
              usedSource: 'provider-api',
              resetsAt: NOW + 2 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - HOUR,
            }),
          ],
        }),
      ),
      'en-GB',
    );
    expect(textOf(el)).toContain('resets 2h 0m');
    expect(tiles(el)[0]?.getAttribute('aria-label')).toContain('resets 2h 0m');
  });

  describe('failed refresh while data is held', () => {
    const notice = (el: HTMLElement) =>
      el.querySelector<HTMLElement>('[data-testid="refresh-failed"]');
    const held = () =>
      snapshotOf(
        owner('anthropic', 'Claude account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              used: { kind: 'percent', percent: 10 },
              usedSource: 'provider-api',
              resetsAt: NOW + 2 * HOUR,
              resetSource: 'provider-api',
              lastResetAt: NOW - HOUR,
              observedAt: NOW - 30 * MIN,
            }),
          ],
        }),
        owner('openai-codex', 'Codex account', {
          windows: [
            win({
              key: 'other:primary',
              label: 'Primary',
              observedAt: NOW - 3 * HOUR,
            }),
          ],
        }),
      );

    it('shows a neutral status notice with the newest observation in local time, above the kept tiles', () => {
      const el = render(held());
      expect(notice(el)).toBeNull();

      store.loadError.set(true);
      fixture.detectChanges();
      const line = notice(el);
      expect(line?.getAttribute('role')).toBe('status');
      expect(textOf(line)).toBe(
        `Refresh failed — showing last observed data (observed ${abs(NOW - 30 * MIN)})`,
      );
      expect(line?.className).toContain('text-base-content-muted');
      expect(line?.className).toContain('border-info');
      expect(line?.className).not.toMatch(
        /border-(warning|error)|text-(warning|error)/,
      );
      expect(line?.nextElementSibling?.tagName).toBe('UL');
      expect(
        line?.nextElementSibling?.querySelector(
          '[data-testid="provider-account-tile"]',
        ),
      ).not.toBeNull();
      expect(tiles(el)).toHaveLength(2);
    });

    it('keeps the age-based window states unchanged', () => {
      const el = render(held());
      const before = tiles(el).map((tile) => textOf(tile));
      store.loadError.set(true);
      fixture.detectChanges();
      expect(tiles(el).map((tile) => textOf(tile))).toEqual(before);
    });

    it('hides the notice once a load or push succeeds', () => {
      const el = render(held());
      store.loadError.set(true);
      fixture.detectChanges();
      expect(notice(el)).not.toBeNull();
      store.loadError.set(false);
      fixture.detectChanges();
      expect(notice(el)).toBeNull();
    });

    it('is not shown when nothing is held: the empty placeholder covers that', () => {
      const el = render(snapshotOf());
      store.loadError.set(true);
      fixture.detectChanges();
      expect(notice(el)).toBeNull();
      expect(
        textOf(el.querySelector('[data-testid="usage-unavailable"]')),
      ).toBe('Account usage unavailable');
    });

    it('through the real store: a failed Refresh shows the notice, a later push clears it', async () => {
      const good = snapshotOf(
        owner('anthropic', 'Claude account', {
          windows: [
            win({
              key: 'five_hour',
              kind: 'five_hour',
              label: '5-hour session',
              observedAt: NOW - 30 * MIN,
            }),
          ],
        }),
      );
      const rpc = {
        call: jest.fn().mockResolvedValue(new RpcResult(true, good)),
      };
      TestBed.configureTestingModule({
        imports: [ProviderAccountCardComponent],
        providers: [
          { provide: ClaudeRpcService, useValue: rpc },
          { provide: AppStateManager, useValue: appState },
          {
            provide: AuthStateService,
            useValue: { activeProviderId: signal('anthropic') },
          },
        ],
      });
      const real = TestBed.createComponent(ProviderAccountCardComponent);
      const flush = async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        real.detectChanges();
      };
      real.detectChanges();
      await flush();
      const el = real.nativeElement as HTMLElement;
      expect(notice(el)).toBeNull();

      rpc.call.mockResolvedValueOnce(new RpcResult(false, undefined, 'boom'));
      el.querySelector<HTMLButtonElement>(
        '[data-testid="tile-refresh"]',
      )?.click();
      await flush();
      expect(textOf(notice(el))).toMatch(
        /^Refresh failed — showing last observed data \(observed /,
      );
      expect(tiles(el)).toHaveLength(1);

      TestBed.inject(PlanLimitsStore).handleMessage({
        type: 'planLimits:changed',
        payload: { ...good, generatedAt: NOW + MIN },
      });
      real.detectChanges();
      expect(notice(el)).toBeNull();
      real.destroy();
    });
  });

  it('through the real store: the effect requests provider:getPlanLimits for the selected provider', async () => {
    const rpc = {
      call: jest.fn().mockResolvedValue(
        new RpcResult(
          true,
          snapshotOf(
            owner('openai-codex', 'Codex account', {
              activity: { lifetimeTokens: '321', dailyUsage: [] },
            }),
          ),
        ),
      ),
    };
    const selected = signal('openai-codex');
    TestBed.configureTestingModule({
      imports: [ProviderAccountCardComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: AppStateManager, useValue: appState },
        {
          provide: AuthStateService,
          useValue: { activeProviderId: selected },
        },
      ],
    });
    const real = TestBed.createComponent(ProviderAccountCardComponent);
    real.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    real.detectChanges();
    expect(rpc.call).toHaveBeenCalledWith('provider:getPlanLimits', {
      providerId: 'openai-codex',
    });
    expect(textOf(real.nativeElement)).toContain('No plan limits reported');
    real.destroy();
  });
});
