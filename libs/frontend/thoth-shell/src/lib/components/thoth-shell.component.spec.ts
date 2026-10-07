import { TestBed } from '@angular/core/testing';
import { ErrorHandler, signal } from '@angular/core';

import { AppStateManager, VSCodeService } from '@ptah-extension/core';
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
  candidates: signal([]),
  invocations: signal([]),
  stats: signal(null),
  statusFilter: signal('all'),
  selectedCandidateId: signal(null),
  selectedCandidate: signal(null),
  loading: signal(false),
  error: signal(null),
  suggestions: signal([]),
  suggestionsLoading: signal(false),
  suggestionDetail: signal(null),
  suggestionDetailLoading: signal(false),
  candidateDetail: signal(null),
  candidateDetailLoading: signal(false),
  pendingSuggestionCount: signal(0),
  specs: signal([]),
  specsLoading: signal(false),
  staleSpecCount: signal(0),
  settings: signal(null),
  queueItems: signal([]),
  drainRuns: signal([]),
  stageSpend: signal([]),
  queueLoading: signal(false),
  queuedAttemptTotal: signal(0),
  digestItems: signal([]),
  digestLoading: signal(false),
  refreshCandidates: () => Promise.resolve(),
  refreshSuggestions: () => Promise.resolve(),
  refreshSpecs: () => Promise.resolve(),
  refreshQueue: () => Promise.resolve(),
  refreshDigest: () => Promise.resolve(),
  harvestSpecs: () => Promise.resolve(),
  clearStaleSpecs: () => Promise.resolve(),
  loadStats: () => Promise.resolve(),
  loadSettings: () => Promise.resolve(),
  loadCandidateDetail: () => Promise.resolve(),
  loadSuggestionDetail: () => Promise.resolve(),
  clearSuggestionDetail: () => undefined,
  updateSuggestion: () => Promise.resolve(),
  setStatusFilter: () => Promise.resolve(),
  selectCandidate: () => Promise.resolve(),
  promote: () => Promise.resolve(),
  promoteBulk: () => Promise.resolve(0),
  reject: () => Promise.resolve(),
  rejectBulk: () => Promise.resolve(0),
  rejectByPattern: () => Promise.resolve(0),
  accept: () => Promise.resolve(),
  dismiss: () => Promise.resolve(),
  // The Skills master switch the tab header renders.
  skillsEnabled: signal(true),
  skillsEnabledCommitted: signal(true),
  skillsPaused: signal(false),
  skillsSwitchSaving: signal(false),
  skillsSwitchError: signal(null),
  refreshSkillsEnabled: () => Promise.resolve(),
  setSkillsEnabled: () => Promise.resolve(),
  markSkillsPaused: () => undefined,
} as unknown as SkillSynthesisStateService;

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
  });

  it('switches active tab via setThothActiveTab when a tab is clicked', () => {
    const fixture = TestBed.createComponent(ThothShellComponent);
    fixture.detectChanges();

    const tablist = fixture.nativeElement.querySelector(
      '[role="tablist"][aria-label="Thoth feature tabs"]',
    ) as HTMLElement;
    const tabs = tablist.querySelectorAll(
      ':scope > [role="tab"]',
    ) as NodeListOf<HTMLButtonElement>;
    tabs[1].click();
    fixture.detectChanges();

    expect(appState.setThothActiveTab).toHaveBeenCalledWith('skills');
    expect(activeTabSignal()).toBe('skills');
  });

  it('shows desktop-only placeholder for gateway tab when not on Electron', () => {
    TestBed.resetTestingModule();
    activeTabSignal = signal<ThothActiveTabId>('gateway');

    TestBed.configureTestingModule({
      imports: [ThothShellComponent],
      providers: [
        { provide: ErrorHandler, useValue: errorHandler },
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

    // Filter chips for the live skills UI must not render in placeholder mode.
    const skillFilterTabs = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll('[aria-label="Status filter"] [role="tab"]');
    expect(skillFilterTabs.length).toBe(0);
  });

  /**
   * Acceptance: the sidebar tiles reload on a tab switch and on a workspace
   * switch, and the Skills tile counts only the current workspace. Runs the
   * REAL ThothStatusService; only the RPC services are stubbed, and the skills
   * stub answers like the backend handler: by `scope`, against the backend's
   * own active root.
   */
  describe('tile refresh (real ThothStatusService)', () => {
    interface FakeSkillsBackend {
      root: string | null;
      readonly pendingByRoot: Record<string, string[]>;
    }

    let backend: FakeSkillsBackend;
    let workspaceInfo: ReturnType<typeof signal<{ path: string } | null>>;
    let listCandidates: jest.Mock;
    let getSettings: jest.Mock;
    let memoryDiagnosticsRpc: ReturnType<typeof memoryDiagnosticsRpcStub>;

    const allRows = (): string[] => Object.values(backend.pendingByRoot).flat();

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
        pendingByRoot: {
          '/ws-a': ['a1', 'a2', 'a3'],
          '/ws-b': ['b1', 'b2', 'b3', 'b4', 'b5'],
        },
      };

      listCandidates = jest.fn(
        async (params: { scope?: 'workspace' | 'all' } = {}) => {
          // Mirrors `listScope`: 'all' is every row; otherwise the backend's
          // own root, falling back to every row when it has none.
          const rows =
            params.scope === 'all' || backend.root === null
              ? allRows()
              : (backend.pendingByRoot[backend.root] ?? []);
          return rows.map((id) => ({ id }));
        },
      );

      getSettings = jest.fn(async () => ({ enabled: true }));
      memoryDiagnosticsRpc = memoryDiagnosticsRpcStub();

      TestBed.configureTestingModule({
        imports: [ThothShellComponent],
        providers: [
          { provide: ErrorHandler, useValue: errorHandler },
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
      expect(skillsTileValue(el)).toBe('3');

      // The backend gains a candidate while the user sits on Memory.
      backend.pendingByRoot['/ws-a'].push('a4');

      const tabs = el.querySelectorAll<HTMLButtonElement>(
        '[role="tablist"][aria-label="Thoth feature tabs"] > [role="tab"]',
      );
      tabs[2].click(); // Schedules
      fixture.detectChanges();
      await flushAsync();
      fixture.detectChanges();
      expect(activeTabSignal()).toBe('cron');
      expect(skillsTileValue(el)).toBe('4');

      // Workspace switch: the backend root moves first, then the webview's.
      backend.root = '/ws-b';
      workspaceInfo.set({ path: '/ws-b' });
      TestBed.tick();
      await flushAsync();
      fixture.detectChanges();
      expect(skillsTileValue(el)).toBe('5');

      // Never the machine-wide count, and every call asked for the workspace.
      expect(allRows()).toHaveLength(9);
      expect(listCandidates).toHaveBeenCalledTimes(3);
      for (const [params] of listCandidates.mock.calls) {
        expect(params).toEqual({
          status: 'candidate',
          scope: 'workspace',
          limit: 1000,
        });
      }
    });

    it('does not refetch when the active tab is clicked again', async () => {
      const fixture = TestBed.createComponent(ThothShellComponent);
      const el = fixture.nativeElement as HTMLElement;
      fixture.detectChanges();
      await flushAsync();
      expect(listCandidates).toHaveBeenCalledTimes(1);

      const tabs = el.querySelectorAll<HTMLButtonElement>(
        '[role="tablist"][aria-label="Thoth feature tabs"] > [role="tab"]',
      );
      tabs[0].click(); // Memory, already active
      fixture.detectChanges();
      await flushAsync();

      expect(listCandidates).toHaveBeenCalledTimes(1);
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
        const statsCalls = listCandidates.mock.calls.length;

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
        // Only the flags were re-read, not every pillar.
        expect(listCandidates.mock.calls.length).toBe(statsCalls);
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
        expect(getSettings.mock.calls.length).toBe(calls);
      });
    });
  });
});
