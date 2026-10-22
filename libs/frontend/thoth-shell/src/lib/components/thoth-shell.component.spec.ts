import { TestBed } from '@angular/core/testing';
import { ErrorHandler, signal, type Provider } from '@angular/core';
import { Location } from '@angular/common';
import { SpyLocation, provideLocationMocks } from '@angular/common/testing';
import {
  ChildrenOutletContexts,
  NavigationEnd,
  PRIMARY_OUTLET,
  Router,
  provideRouter,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { filter, firstValueFrom } from 'rxjs';

import {
  AppStateManager,
  ClaudeRpcService,
  SurfaceRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import { provideSurfaceRouterTesting } from '@ptah-extension/core/testing';
import { MODEL_REFRESH_CONTROL } from '@ptah-extension/chat-state';
import {
  MemoryRpcService,
  MemoryStateService,
} from '@ptah-extension/memory-curator-ui';
import { MemoryDiagnosticsRpcService } from '@ptah-extension/memory-curator-ui/services';
import {
  SkillSynthesisRpcService,
  SkillSynthesisStateService,
} from '@ptah-extension/skill-synthesis-ui';
import { CronRpcService } from '@ptah-extension/cron-scheduler-ui';
import { GatewayRpcService } from '@ptah-extension/messaging-gateway-ui';

import {
  ThothShellComponent,
  type ThothActiveTabId,
} from './thoth-shell.component';
import { THOTH_ROUTES } from '../thoth.routes';

/**
 * Angular routes an exception thrown inside a subscription or an effect to the
 * application {@link ErrorHandler}, which logs it and lets the test go green.
 * That is how a stub drifting behind the signals the shell reads stayed
 * invisible here: `this.appState.workspaceInfo is not a function` was logged on
 * every run while all five specs passed. Collect what the handler receives and
 * fail the test on it, so the next drift is a red suite rather than a line of
 * console noise.
 */
class RecordingErrorHandler implements ErrorHandler {
  public readonly errors: unknown[] = [];

  public handleError(error: unknown): void {
    this.errors.push(error);
  }
}

const modelRefreshStub = {
  refreshModels: () => Promise.resolve(),
};

/**
 * Minimal stub for {@link SkillSynthesisStateService} so the embedded
 * `<ptah-skill-synthesis-tab />` component can be constructed by Angular DI
 * even in non-Electron tests where it renders only the placeholder.
 */
const skillStateStub = {
  // The Library tab's pause switch and telemetry controls.
  skillsEnabled: signal(true),
  skillsEnabledCommitted: signal(true),
  skillsPaused: signal(false),
  skillsSwitchSaving: signal(false),
  skillsSwitchError: signal(null),
  refreshSkillsEnabled: () => Promise.resolve(),
  setSkillsEnabled: () => Promise.resolve(),
  markSkillsPaused: () => undefined,
  telemetryEnabled: signal<boolean | null>(true),
  telemetrySaving: signal(false),
  telemetryError: signal<string | null>(null),
  refreshTelemetryEnabled: (): Promise<void> => Promise.resolve(),
  setTelemetryEnabled: (_enabled: boolean): Promise<void> => Promise.resolve(),
  // The Library tab's spec control (U5).
  specs: signal<readonly unknown[]>([]),
  specsLoading: signal(false),
  staleSpecCount: signal(0),
  refreshSpecs: (): Promise<void> => Promise.resolve(),
  harvestSpecs: (): Promise<void> => Promise.resolve(),
  clearStaleSpecs: (): Promise<number> => Promise.resolve(0),
};

/**
 * The Memory tab header renders the Memory master switch, which reads
 * `memory:getTriggers`; answer "on" so no test depends on a live RPC.
 */
function memoryDiagnosticsRpcStub(enabled = true) {
  return {
    getTriggers: jest.fn(async () => ({ triggers: {}, enabled })),
    diagnostics: jest.fn(async () => {
      throw new Error('not used');
    }),
  };
}

/**
 * Minimal stub for {@link MemoryStateService} so the embedded
 * `<ptah-memory-curator-tab />` rendered by the `@case ('memory')` arm of
 * the shell does not pull a real RPC dependency into the test bed.
 */
const memoryStateStub = {
  entries: () => [],
  query: () => '',
  tierFilter: () => 'all',
  scopeFilter: () => 'workspace',
  stats: () => null,
  loading: () => false,
  error: () => null,
  filteredEntries: () => [],
  totalsByTier: () => ({
    core: 0,
    recall: 0,
    archival: 0,
    codeIndex: 0,
    total: 0,
  }),
  setQuery: () => undefined,
  setTierFilter: () => undefined,
  setScopeFilter: () => undefined,
  refresh: () => Promise.resolve(),
  search: () => Promise.resolve(),
  pin: () => Promise.resolve(),
  unpin: () => Promise.resolve(),
  forget: () => Promise.resolve(),
  rebuildIndex: () => Promise.resolve(),
  loadStats: () => Promise.resolve(),
  symbolQuery: () => '',
  symbolItems: () => [],
  symbolTotal: () => 0,
  symbolLoading: () => false,
  symbolError: () => null,
  symbolOffset: () => 0,
  symbolLimit: () => 50,
  setSymbolQuery: () => undefined,
  setSymbolPage: () => undefined,
  loadSymbols: () => Promise.resolve(),
} as unknown as MemoryStateService;

type AppStateStub = jest.Mocked<
  Pick<
    AppStateManager,
    | 'thothActiveTab'
    | 'setThothActiveTab'
    | 'workspaceInfo'
    | 'consumeSkillsDivergedRequest'
  >
>;

type ActiveTabSignal = ReturnType<typeof signal<ThothActiveTabId>>;

/**
 * The one definition of the `AppStateManager` stub. Every TestBed in this file
 * builds it here rather than hand-writing its own literal — four separate
 * literals is exactly how two of them lost `workspaceInfo`, which
 * `ThothStatusService` reads on behalf of the shell.
 *
 * `consumeSkillsDivergedRequest` is read by the skills tab's deep-link effect,
 * which this shell mounts. Omitting it threw `is not a function` inside change
 * detection and failed two tests that have nothing to do with the deep link.
 */
function makeAppStateStub(activeTab: ActiveTabSignal): AppStateStub {
  return {
    thothActiveTab: activeTab.asReadonly(),
    setThothActiveTab: jest.fn((tab: ThothActiveTabId) => activeTab.set(tab)),
    workspaceInfo: signal(null),
    consumeSkillsDivergedRequest: jest.fn(() => false),
  } as unknown as AppStateStub;
}

/** The Electron-mode shell's stubs, without a Router. */
function electronShellProviders(
  errorHandler: RecordingErrorHandler,
  appState: AppStateStub,
): Provider[] {
  return [
    { provide: ErrorHandler, useValue: errorHandler },
    { provide: AppStateManager, useValue: appState },
    {
      provide: VSCodeService,
      useValue: { config: signal({ isElectron: true }) },
    },
    { provide: MemoryStateService, useValue: memoryStateStub },
    { provide: SkillSynthesisStateService, useValue: skillStateStub },
    { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshStub },
    {
      provide: MemoryDiagnosticsRpcService,
      useValue: memoryDiagnosticsRpcStub(),
    },
  ];
}

/**
 * Most specs create the shell directly rather than through `THOTH_ROUTES`, so
 * it has no `:tab` child and shows the remembered tab. They still get the
 * webview's Router (`provideSurfaceRouterTesting`, which carries `/thoth/:tab`),
 * because the shell injects it and a tab click navigates.
 */
describe('ThothShellComponent', () => {
  let appState: AppStateStub;
  let activeTabSignal: ActiveTabSignal;
  let errorHandler: RecordingErrorHandler;

  beforeEach(async () => {
    errorHandler = new RecordingErrorHandler();
    activeTabSignal = signal<ThothActiveTabId>('memory');
    appState = makeAppStateStub(activeTabSignal);

    await TestBed.configureTestingModule({
      imports: [ThothShellComponent],
      providers: [
        ...electronShellProviders(errorHandler, appState),
        ...provideSurfaceRouterTesting(),
      ],
    }).compileComponents();
  });

  afterEach(() => {
    expect(errorHandler.errors).toEqual([]);
  });

  it('renders four tabs by default with Memory active', () => {
    const fixture = TestBed.createComponent(ThothShellComponent);
    fixture.detectChanges();

    const tablist = fixture.nativeElement.querySelector(
      '[role="tablist"][aria-label="Thoth feature tabs"]',
    ) as HTMLElement;
    const tabs = tablist.querySelectorAll(
      ':scope > [role="tab"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(tabs.length).toBe(4);
    const labelOf = (t: HTMLElement) =>
      t.querySelector('[data-testid="thoth-tab-label"]')?.textContent?.trim();
    const labels = Array.from(tabs).map(labelOf);
    expect(labels).toEqual(['Memory', 'Skills', 'Schedules', 'Messaging']);

    const active = Array.from(tabs).find(
      (t) => t.getAttribute('aria-selected') === 'true',
    );
    expect(active ? labelOf(active) : undefined).toBe('Memory');
    expect(active?.className).toContain('surface-3');
    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('[data-testid="thoth-section-nav"]')?.className,
    ).toContain('surface-1');
    expect(host.firstElementChild?.className).toContain('bg-surface-0');
    const panelWrapper = host.querySelector<HTMLElement>(
      '[data-testid="thoth-section-panel"] > div',
    );
    expect(panelWrapper).not.toBeNull();
    expect(panelWrapper?.className).not.toMatch(/\bmax-w-/);
  });

  /**
   * TASK_2026_524 Batch 4e: the URL decides the tab. Mounted the way the app
   * mounts it — `THOTH_ROUTES` through `loadChildren` under `thoth` — with the
   * real `SurfaceRouterService`.
   */
  describe('tab from the route (THOTH_ROUTES)', () => {
    let harness: RouterTestingHarness;
    let router: Router;

    const tabButton = (tab: ThothActiveTabId): HTMLButtonElement => {
      const button =
        harness.routeNativeElement?.querySelector<HTMLButtonElement>(
          `[role="tab"][data-pillar="${tab}"]`,
        );
      if (!button) throw new Error(`no tab button for ${tab}`);
      return button;
    };

    /**
     * The next navigation that settles. Subscribe BEFORE the click that starts
     * it. `fixture.whenStable()` is not usable here: with the real tab bodies
     * mounted the zone never reports stable, so it would wait for ever.
     */
    const nextNavigationEnd = (): Promise<NavigationEnd> =>
      firstValueFrom(
        router.events.pipe(
          filter(
            (event): event is NavigationEnd => event instanceof NavigationEnd,
          ),
        ),
      );

    /** The shell the primary outlet is showing right now. */
    const outletShell = (): ThothShellComponent =>
      TestBed.inject(ChildrenOutletContexts).getContext(PRIMARY_OUTLET)?.outlet
        ?.component as ThothShellComponent;

    beforeEach(async () => {
      TestBed.resetTestingModule();
      activeTabSignal = signal<ThothActiveTabId>('memory');
      appState = makeAppStateStub(activeTabSignal);
      TestBed.configureTestingModule({
        providers: [
          ...electronShellProviders(errorHandler, appState),
          provideLocationMocks(),
          provideRouter([{ path: 'thoth', loadChildren: () => THOTH_ROUTES }]),
        ],
      });
      harness = await RouterTestingHarness.create();
      router = TestBed.inject(Router);
    });

    it('selectTab navigates to /thoth/<tab>; the tab and its memory follow only once it settles', async () => {
      const shell = await harness.navigateByUrl(
        '/thoth/memory',
        ThothShellComponent,
      );
      appState.setThothActiveTab.mockClear();
      // `provideLocationMocks()` binds `Location` to `SpyLocation`, which logs
      // a push as the URL and a replace as `replace: <url>`.
      const location = TestBed.inject(Location) as SpyLocation;
      const changesBefore = location.urlChanges.length;
      const settled = nextNavigationEnd();

      tabButton('skills').click();

      // Nothing moves ahead of the navigation (TASK_2026_317 rule).
      expect(shell.activeTab()).toBe('memory');
      expect(appState.setThothActiveTab).not.toHaveBeenCalled();

      await settled;
      harness.detectChanges();

      expect(router.url).toBe('/thoth/skills');
      expect(shell.activeTab()).toBe('skills');
      expect(appState.setThothActiveTab).toHaveBeenCalledWith('skills');
      expect(tabButton('skills').getAttribute('aria-selected')).toBe('true');
      // A tab switch reuses the shell (Preserve list P6e).
      expect(outletShell()).toBe(shell);
      // D6: the tab switch replaced the URL, so Back leaves Thoth rather than
      // returning to /thoth/memory.
      expect(location.urlChanges.slice(changesBefore)).toEqual([
        'replace: /thoth/skills',
      ]);
    });

    it('writes no memory for a navigation that never settles', async () => {
      await harness.navigateByUrl('/thoth/memory', ThothShellComponent);
      appState.setThothActiveTab.mockClear();

      // The second click supersedes the first navigation before it lands, so
      // the first NavigationEnd to arrive is the second click's.
      const settled = nextNavigationEnd();
      tabButton('skills').click();
      tabButton('cron').click();
      expect((await settled).urlAfterRedirects).toBe('/thoth/cron');

      expect(router.url).toBe('/thoth/cron');
      expect(appState.setThothActiveTab.mock.calls).toEqual([['cron']]);
    });

    it('keeps the seeded tab when a remount finds it already remembered', async () => {
      const first = await harness.navigateByUrl(
        '/thoth/cron',
        ThothShellComponent,
      );
      appState.setThothActiveTab.mockClear();

      TestBed.inject(SurfaceRouterService).remountActiveSurface();

      const remounted = outletShell();
      expect(remounted).toBeInstanceOf(ThothShellComponent);
      expect(remounted).not.toBe(first);
      // Synchronous: no NavigationEnd follows a remount.
      expect(remounted.activeTab()).toBe('cron');
      expect(appState.setThothActiveTab).not.toHaveBeenCalled();
      expect(router.url).toBe('/thoth/cron');
    });

    it("moves a remount to the incoming workspace's remembered tab and replaces the URL", async () => {
      await harness.navigateByUrl('/thoth/skills', ThothShellComponent);
      // The workspace switched to remembers another tab.
      activeTabSignal.set('cron');
      appState.setThothActiveTab.mockClear();
      const location = TestBed.inject(Location) as SpyLocation;
      const changesBefore = location.urlChanges.length;
      const settled = nextNavigationEnd();

      TestBed.inject(SurfaceRouterService).remountActiveSurface();

      const remounted = outletShell();
      // The outgoing workspace's tab is never shown or written.
      expect(remounted.activeTab()).toBe('cron');
      expect(appState.setThothActiveTab).not.toHaveBeenCalledWith('skills');

      await settled;
      expect(router.url).toBe('/thoth/cron');
      expect(remounted.activeTab()).toBe('cron');
      expect(appState.setThothActiveTab).not.toHaveBeenCalledWith('skills');
      expect(location.urlChanges.slice(changesBefore)).toEqual([
        'replace: /thoth/cron',
      ]);
    });
  });

  it('shows desktop-only placeholder for gateway tab when not on Electron', () => {
    TestBed.resetTestingModule();
    activeTabSignal = signal<ThothActiveTabId>('gateway');

    TestBed.configureTestingModule({
      imports: [ThothShellComponent],
      providers: [
        { provide: ErrorHandler, useValue: errorHandler },
        ...provideSurfaceRouterTesting(),
        {
          provide: AppStateManager,
          useValue: makeAppStateStub(activeTabSignal),
        },
        {
          provide: VSCodeService,
          useValue: { config: signal({ isElectron: false }) },
        },
      ],
    });

    const fixture = TestBed.createComponent(ThothShellComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Ptah desktop');
  });

  it('shows desktop-only placeholder for memory tab when not on Electron', () => {
    TestBed.resetTestingModule();
    activeTabSignal = signal<ThothActiveTabId>('memory');

    TestBed.configureTestingModule({
      imports: [ThothShellComponent],
      providers: [
        { provide: ErrorHandler, useValue: errorHandler },
        ...provideSurfaceRouterTesting(),
        {
          provide: AppStateManager,
          useValue: makeAppStateStub(activeTabSignal),
        },
        {
          provide: VSCodeService,
          useValue: { config: signal({ isElectron: false }) },
        },
        { provide: MemoryStateService, useValue: memoryStateStub },
      ],
    });

    const fixture = TestBed.createComponent(ThothShellComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Ptah desktop');

    // Confirm the live memory UI is not rendered.
    const search = (fixture.nativeElement as HTMLElement).querySelector(
      'input[type="search"]',
    );
    expect(search).toBeNull();
  });

  it('shows desktop-only placeholder for skills tab when not on Electron', () => {
    TestBed.resetTestingModule();
    activeTabSignal = signal<ThothActiveTabId>('skills');

    TestBed.configureTestingModule({
      imports: [ThothShellComponent],
      providers: [
        { provide: ErrorHandler, useValue: errorHandler },
        ...provideSurfaceRouterTesting(),
        {
          provide: AppStateManager,
          useValue: makeAppStateStub(activeTabSignal),
        },
        {
          provide: VSCodeService,
          useValue: { config: signal({ isElectron: false }) },
        },
        { provide: SkillSynthesisStateService, useValue: skillStateStub },
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshStub },
      ],
    });

    const fixture = TestBed.createComponent(ThothShellComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('Ptah desktop');

    expect(text).toContain('Skills Library');
  });

  /**
   * Acceptance: the sidebar tiles reload on a tab switch and on a workspace
   * switch, and the Skills tile reflects telemetry for the current workspace.
   * Runs the REAL ThothStatusService; only the RPC services are stubbed.
   */
  describe('tile refresh (real ThothStatusService)', () => {
    interface FakeSkillsBackend {
      root: string | null;
    }

    let backend: FakeSkillsBackend;
    let workspaceInfo: ReturnType<typeof signal<{ path: string } | null>>;
    let listCandidates: jest.Mock;
    let getSettings: jest.MockedFunction<() => Promise<{ enabled: boolean }>>;
    let settingsGet: jest.MockedFunction<
      (
        method: string,
        params: { key: string },
      ) => Promise<{
        isSuccess: () => boolean;
        data: { success: boolean; value: boolean };
      }>
    >;
    let telemetryByRoot: Record<string, boolean>;
    let memoryDiagnosticsRpc: ReturnType<typeof memoryDiagnosticsRpcStub>;

    const telemetryReads = () =>
      settingsGet.mock.calls.filter(
        ([method, params]) =>
          method === 'settings:get' && params.key === 'skills.telemetry.enabled',
      );

    const flushAsync = (): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, 0));

    const skillsTileValue = (el: HTMLElement): string | undefined =>
      el
        .querySelector(
          '[data-pillar="skills"] [data-testid="dashboard-status-card-value"]',
        )
        ?.textContent?.trim();

    beforeEach(() => {
      TestBed.resetTestingModule();
      activeTabSignal = signal<ThothActiveTabId>('memory');
      workspaceInfo = signal<{ path: string } | null>({ path: '/ws-a' });
      backend = {
        root: '/ws-a',
      };
      telemetryByRoot = { '/ws-a': true, '/ws-b': true };

      listCandidates = jest.fn(async () => []);

      getSettings = jest.fn(async () => ({ enabled: true }));
      settingsGet = jest.fn(async (_method: string, params: { key: string }) => ({
        isSuccess: () => true,
        data: {
          success: true,
          value:
            params.key === 'skills.telemetry.enabled'
              ? (telemetryByRoot[backend.root ?? ''] ?? false)
              : params.key === 'skillSynthesis.enabled'
                ? (await getSettings()).enabled
                : true,
        },
      }));
      memoryDiagnosticsRpc = memoryDiagnosticsRpcStub();

      TestBed.configureTestingModule({
        imports: [ThothShellComponent],
        providers: [
          { provide: ErrorHandler, useValue: errorHandler },
          ...provideSurfaceRouterTesting(),
          {
            provide: MemoryDiagnosticsRpcService,
            useValue: memoryDiagnosticsRpc,
          },
          {
            provide: AppStateManager,
            useValue: {
              ...makeAppStateStub(activeTabSignal),
              workspaceInfo: workspaceInfo.asReadonly(),
            },
          },
          {
            provide: VSCodeService,
            useValue: { config: signal({ isElectron: true }) },
          },
          { provide: MemoryStateService, useValue: memoryStateStub },
          { provide: SkillSynthesisStateService, useValue: skillStateStub },
          { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshStub },
          {
            provide: MemoryRpcService,
            useValue: {
              stats: jest.fn(async () => ({
                core: 0,
                recall: 0,
                archival: 0,
                codeIndex: 0,
                lastCuratedAt: null,
              })),
            },
          },
          {
            provide: SkillSynthesisRpcService,
            useValue: { listCandidates, getSettings },
          },
          {
            provide: ClaudeRpcService,
            useValue: { call: settingsGet },
          },
          {
            provide: CronRpcService,
            useValue: { list: jest.fn(async () => ({ jobs: [] })) },
          },
          {
            provide: GatewayRpcService,
            useValue: {
              status: jest.fn(async () => ({ enabled: false, adapters: [] })),
              listBindings: jest.fn(async () => ({ bindings: [] })),
            },
          },
        ],
      });
    });

    it('reloads on tab switch, then on workspace switch, scoped to the workspace', async () => {
      const fixture = TestBed.createComponent(ThothShellComponent);
      const el = fixture.nativeElement as HTMLElement;
      fixture.detectChanges();
      await flushAsync();
      fixture.detectChanges();
      expect(skillsTileValue(el)).toBe('On');
      expect(telemetryReads()).toHaveLength(1);

      // Telemetry changes while the user sits on Memory.
      telemetryByRoot['/ws-a'] = false;

      const tabs = el.querySelectorAll<HTMLButtonElement>(
        '[role="tablist"][aria-label="Thoth feature tabs"] > [role="tab"]',
      );
      tabs[2].click(); // Schedules
      fixture.detectChanges();
      await flushAsync();
      fixture.detectChanges();
      // The click navigates; the tile reload does not wait for it.
      expect(TestBed.inject(Router).url).toBe('/thoth/cron');
      expect(skillsTileValue(el)).toBe('Off');
      expect(telemetryReads()).toHaveLength(2);

      // Workspace switch: the backend root moves first, then the webview's.
      backend.root = '/ws-b';
      workspaceInfo.set({ path: '/ws-b' });
      TestBed.tick();
      await flushAsync();
      fixture.detectChanges();
      expect(skillsTileValue(el)).toBe('On');

      expect(telemetryReads()).toHaveLength(3);
      for (const [method, params] of telemetryReads()) {
        expect(method).toBe('settings:get');
        expect(params).toEqual({ key: 'skills.telemetry.enabled' });
      }
      expect(listCandidates).not.toHaveBeenCalled();
    });

    it('does not refetch when the active tab is clicked again', async () => {
      const fixture = TestBed.createComponent(ThothShellComponent);
      const el = fixture.nativeElement as HTMLElement;
      fixture.detectChanges();
      await flushAsync();
      expect(telemetryReads()).toHaveLength(1);

      const tabs = el.querySelectorAll<HTMLButtonElement>(
        '[role="tablist"][aria-label="Thoth feature tabs"] > [role="tab"]',
      );
      tabs[0].click(); // Memory, already active
      fixture.detectChanges();
      await flushAsync();

      expect(telemetryReads()).toHaveLength(1);
    });

    describe('"Paused" badges', () => {
      const pausedBadge = (el: HTMLElement, pillar: string): Element | null =>
        el.querySelector(
          `[data-pillar="${pillar}"] [data-testid="thoth-tab-paused"]`,
        );

      it('shows a Paused badge on the Memory tile only while Memory is paused', async () => {
        memoryDiagnosticsRpc.getTriggers.mockResolvedValue({
          triggers: {},
          enabled: false,
        });
        const fixture = TestBed.createComponent(ThothShellComponent);
        const el = fixture.nativeElement as HTMLElement;
        fixture.detectChanges();
        await flushAsync();
        fixture.detectChanges();

        expect(pausedBadge(el, 'memory')?.textContent?.trim()).toBe('Paused');
        // Readable size (visual review round 1): badge-sm with 12 px text.
        expect(pausedBadge(el, 'memory')?.classList).toContain('badge-sm');
        expect(pausedBadge(el, 'memory')?.classList).toContain('text-xs');
        expect(pausedBadge(el, 'skills')).toBeNull();
        // The tab's accessible name carries the state too.
        expect(
          el.querySelector('[data-pillar="memory"]')?.textContent,
        ).toContain('Paused');
      });

      it('re-reads the pause flags when a tab reports its switch flipped', async () => {
        const fixture = TestBed.createComponent(ThothShellComponent);
        const el = fixture.nativeElement as HTMLElement;
        fixture.detectChanges();
        await flushAsync();
        fixture.detectChanges();
        expect(pausedBadge(el, 'skills')).toBeNull();
        getSettings.mockResolvedValue({ enabled: false });
        activeTabSignal.set('skills');
        fixture.detectChanges();
        const tab = fixture.debugElement.query(
          (de) => de.name === 'ptah-skill-synthesis-tab',
        );
        tab.triggerEventHandler('pausedChange', true);
        await flushAsync();
        fixture.detectChanges();

        expect(pausedBadge(el, 'skills')?.textContent?.trim()).toBe('Paused');
        // Only the flags were re-read; candidate fetching remains retired.
        expect(listCandidates).not.toHaveBeenCalled();
      });

      it('re-reads the pause flags when the window regains focus, and stops after destroy', async () => {
        const fixture = TestBed.createComponent(ThothShellComponent);
        const el = fixture.nativeElement as HTMLElement;
        fixture.detectChanges();
        await flushAsync();
        fixture.detectChanges();
        expect(pausedBadge(el, 'skills')).toBeNull();

        // Paused from the tray while the window was in the background.
        getSettings.mockResolvedValue({ enabled: false });
        window.dispatchEvent(new Event('focus'));
        await flushAsync();
        fixture.detectChanges();
        expect(pausedBadge(el, 'skills')).not.toBeNull();

        fixture.destroy();
        const calls = getSettings.mock.calls.length;
        window.dispatchEvent(new Event('focus'));
        await flushAsync();
        expect(getSettings.mock.calls).toHaveLength(calls);
      });
    });
  });
});
