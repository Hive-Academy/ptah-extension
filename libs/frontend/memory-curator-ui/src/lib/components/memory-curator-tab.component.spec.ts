import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import {
  WorkspaceIndexingService,
  type IndexingUiState,
} from '@ptah-extension/workspace-indexing';

import { MemoryStateService } from '../services/memory-state.service';
import { MemoryRpcService } from '../services/memory-rpc.service';

import { MemoryCuratorTabComponent } from './memory-curator-tab.component';

function indexingServiceStub(
  uiState: IndexingUiState,
): Partial<WorkspaceIndexingService> {
  return {
    uiState: signal(
      uiState,
    ).asReadonly() as WorkspaceIndexingService['uiState'],
    status: signal(null).asReadonly() as WorkspaceIndexingService['status'],
    progress: signal(null).asReadonly() as WorkspaceIndexingService['progress'],
    completedAt: signal<number | null>(
      null,
    ).asReadonly() as WorkspaceIndexingService['completedAt'],
    handledMessageTypes:
      [] as unknown as WorkspaceIndexingService['handledMessageTypes'],
    handleMessage: jest.fn(),
    setWorkspaceAvailability: jest.fn(),
    loadStatus: jest.fn(() => Promise.resolve()),
    start: jest.fn(() => Promise.resolve()),
    pause: jest.fn(() => Promise.resolve()),
    resume: jest.fn(() => Promise.resolve()),
    cancel: jest.fn(() => Promise.resolve()),
    setPipelineEnabled: jest.fn(() => Promise.resolve()),
    dismissStale: jest.fn(() => Promise.resolve()),
    acknowledgeDisclosure: jest.fn(() => Promise.resolve()),
  } as unknown as Partial<WorkspaceIndexingService>;
}

function vscodeServiceStub(isElectron: boolean): Partial<VSCodeService> {
  return {
    config: signal({ isElectron }),
    postMessage: jest.fn(),
  } as unknown as Partial<VSCodeService>;
}

/**
 * Smoke tests for {@link MemoryCuratorTabComponent}. Stubs the entire
 * {@link MemoryStateService} surface so no real RPC traffic is generated.
 */
describe('MemoryCuratorTabComponent', () => {
  let stateMock: jest.Mocked<MemoryStateService>;

  beforeEach(async () => {
    const baseState = {
      entries: jest.fn(() => []),
      query: jest.fn(() => ''),
      tierFilter: jest.fn(() => 'all'),
      scopeFilter: jest.fn(() => 'workspace'),
      stats: jest.fn(() => null),
      loading: jest.fn(() => false),
      error: jest.fn(() => null),
      filteredEntries: jest.fn(() => []),
      totalsByTier: jest.fn(() => ({
        core: 0,
        recall: 0,
        archival: 0,
        codeIndex: 0,
        total: 0,
      })),
      setQuery: jest.fn(),
      setTierFilter: jest.fn(),
      setScopeFilter: jest.fn(),
      refresh: jest.fn(() => Promise.resolve()),
      search: jest.fn(() => Promise.resolve()),
      pin: jest.fn(() => Promise.resolve()),
      unpin: jest.fn(() => Promise.resolve()),
      forget: jest.fn(() => Promise.resolve()),
      rebuildIndex: jest.fn(() => Promise.resolve()),
      loadStats: jest.fn(() => Promise.resolve()),
      symbolQuery: jest.fn(() => ''),
      symbolItems: jest.fn(() => []),
      symbolTotal: jest.fn(() => 0),
      symbolLoading: jest.fn(() => false),
      symbolError: jest.fn(() => null),
      symbolOffset: jest.fn(() => 0),
      symbolLimit: jest.fn(() => 50),
      setSymbolQuery: jest.fn(),
      setSymbolPage: jest.fn(),
      loadSymbols: jest.fn(() => Promise.resolve()),
    } as unknown as jest.Mocked<MemoryStateService>;

    stateMock = baseState;

    await TestBed.configureTestingModule({
      imports: [MemoryCuratorTabComponent],
      providers: [
        { provide: MemoryStateService, useValue: stateMock },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        {
          provide: MemoryRpcService,
          useValue: {
            listCorpora: jest.fn().mockResolvedValue({ corpora: [] }),
            searchIndex: jest
              .fn()
              .mockResolvedValue({ rows: [], bm25Only: false }),
            timeline: jest.fn().mockResolvedValue({ rows: [], anchorIndex: 0 }),
          },
        },
      ],
    }).compileComponents();
  });

  it('renders the tab and triggers refresh + loadStats on init', () => {
    const fixture = TestBed.createComponent(MemoryCuratorTabComponent);
    fixture.detectChanges();

    expect(stateMock.refresh).toHaveBeenCalled();
    expect(stateMock.loadStats).toHaveBeenCalled();

    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector(
      'input[type="search"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.placeholder ?? '').toContain('Search memory');
    expect(root.textContent ?? '').toContain('Rebuild index');
  });

  it('schedules a debounced search when the input changes', () => {
    jest.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(MemoryCuratorTabComponent);
      fixture.detectChanges();

      const input = (fixture.nativeElement as HTMLElement).querySelector(
        'input[type="search"]',
      ) as HTMLInputElement;
      expect(input).not.toBeNull();

      input.value = 'auth flow';
      input.dispatchEvent(new Event('input'));
      expect(stateMock.search).not.toHaveBeenCalled();

      jest.advanceTimersByTime(400);
      expect(stateMock.search).toHaveBeenCalledWith('auth flow');
    } finally {
      jest.useRealTimers();
    }
  });

  it('defaults to the list view and switches to timeline / corpus on tab click', () => {
    const fixture = TestBed.createComponent(MemoryCuratorTabComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('input[aria-label="Search memory entries"]'),
    ).not.toBeNull();

    const tabButtons = Array.from(root.querySelectorAll('button')).filter(
      (b) => b.getAttribute('role') === 'tab',
    );
    const timelineTab = tabButtons.find(
      (b) => (b.textContent ?? '').trim() === 'Timeline',
    ) as HTMLButtonElement;
    expect(timelineTab).toBeDefined();
    timelineTab.click();
    fixture.detectChanges();

    expect(root.querySelector('ptah-timeline-view')).not.toBeNull();
    expect(
      root.querySelector('input[aria-label="Search memory entries"]'),
    ).toBeNull();

    const corpusTab = tabButtons.find(
      (b) => (b.textContent ?? '').trim() === 'Corpus',
    ) as HTMLButtonElement;
    corpusTab.click();
    fixture.detectChanges();

    expect(root.querySelector('ptah-corpus-list')).not.toBeNull();
    expect(root.querySelector('ptah-timeline-view')).toBeNull();
  });

  it('shows desktop-only placeholder when not on Electron and skips RPC init', async () => {
    TestBed.resetTestingModule();
    const stateMockNonElectron = {
      entries: jest.fn(() => []),
      query: jest.fn(() => ''),
      tierFilter: jest.fn(() => 'all'),
      scopeFilter: jest.fn(() => 'workspace'),
      stats: jest.fn(() => null),
      loading: jest.fn(() => false),
      error: jest.fn(() => null),
      filteredEntries: jest.fn(() => []),
      totalsByTier: jest.fn(() => ({
        core: 0,
        recall: 0,
        archival: 0,
        codeIndex: 0,
        total: 0,
      })),
      setQuery: jest.fn(),
      setTierFilter: jest.fn(),
      setScopeFilter: jest.fn(),
      refresh: jest.fn(() => Promise.resolve()),
      search: jest.fn(() => Promise.resolve()),
      pin: jest.fn(() => Promise.resolve()),
      unpin: jest.fn(() => Promise.resolve()),
      forget: jest.fn(() => Promise.resolve()),
      rebuildIndex: jest.fn(() => Promise.resolve()),
      loadStats: jest.fn(() => Promise.resolve()),
      symbolQuery: jest.fn(() => ''),
      symbolItems: jest.fn(() => []),
      symbolTotal: jest.fn(() => 0),
      symbolLoading: jest.fn(() => false),
      symbolError: jest.fn(() => null),
      symbolOffset: jest.fn(() => 0),
      symbolLimit: jest.fn(() => 50),
      setSymbolQuery: jest.fn(),
      setSymbolPage: jest.fn(),
      loadSymbols: jest.fn(() => Promise.resolve()),
    } as unknown as jest.Mocked<MemoryStateService>;

    await TestBed.configureTestingModule({
      imports: [MemoryCuratorTabComponent],
      providers: [
        { provide: MemoryStateService, useValue: stateMockNonElectron },
        { provide: VSCodeService, useValue: vscodeServiceStub(false) },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MemoryCuratorTabComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ptah desktop app');

    // Verify no RPC traffic was issued in the non-Electron branch.
    expect(stateMockNonElectron.refresh).not.toHaveBeenCalled();
    expect(stateMockNonElectron.loadStats).not.toHaveBeenCalled();

    // Search box must not render in placeholder mode.
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      'input[type="search"]',
    );
    expect(input).toBeNull();
  });
});

describe('MemoryCuratorTabComponent — purge toolbar', () => {
  let stateMock: jest.Mocked<MemoryStateService>;
  let rpcMock: { purgeBySubjectPattern: jest.Mock };
  let workspaceInfoSignal: ReturnType<
    typeof signal<{ name: string; path: string; type: string } | null>
  >;

  function setupTestBed(): void {
    stateMock = {
      entries: jest.fn(() => []),
      query: jest.fn(() => ''),
      tierFilter: jest.fn(() => 'all'),
      scopeFilter: jest.fn(() => 'workspace'),
      stats: jest.fn(() => null),
      loading: jest.fn(() => false),
      error: jest.fn(() => null),
      filteredEntries: jest.fn(() => []),
      totalsByTier: jest.fn(() => ({
        core: 0,
        recall: 0,
        archival: 0,
        codeIndex: 0,
        total: 0,
      })),
      setQuery: jest.fn(),
      setTierFilter: jest.fn(),
      setScopeFilter: jest.fn(),
      refresh: jest.fn(() => Promise.resolve()),
      search: jest.fn(() => Promise.resolve()),
      pin: jest.fn(() => Promise.resolve()),
      unpin: jest.fn(() => Promise.resolve()),
      forget: jest.fn(() => Promise.resolve()),
      rebuildIndex: jest.fn(() => Promise.resolve()),
      loadStats: jest.fn(() => Promise.resolve()),
      symbolQuery: jest.fn(() => ''),
      symbolItems: jest.fn(() => []),
      symbolTotal: jest.fn(() => 0),
      symbolLoading: jest.fn(() => false),
      symbolError: jest.fn(() => null),
      symbolOffset: jest.fn(() => 0),
      symbolLimit: jest.fn(() => 50),
      setSymbolQuery: jest.fn(),
      setSymbolPage: jest.fn(),
      loadSymbols: jest.fn(() => Promise.resolve()),
    } as unknown as jest.Mocked<MemoryStateService>;

    rpcMock = {
      purgeBySubjectPattern: jest.fn(),
    };

    TestBed.configureTestingModule({
      imports: [MemoryCuratorTabComponent],
      providers: [
        { provide: MemoryStateService, useValue: stateMock },
        { provide: MemoryRpcService, useValue: rpcMock },
        {
          provide: AppStateManager,
          useValue: { workspaceInfo: workspaceInfoSignal },
        },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
      ],
    });
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    workspaceInfoSignal = signal<{
      name: string;
      path: string;
      type: string;
    } | null>({ name: 'w', path: '/ws', type: 'workspace' });
  });

  function getPurgeButton(root: HTMLElement): HTMLButtonElement {
    const buttons = Array.from(root.querySelectorAll('button'));
    const purgeBtn = buttons.find((b) =>
      (b.textContent ?? '').trim().startsWith('Purge'),
    );
    if (!purgeBtn) {
      throw new Error('Purge button not found in rendered template');
    }
    return purgeBtn as HTMLButtonElement;
  }

  function getPurgeInput(root: HTMLElement): HTMLInputElement {
    const input = root.querySelector('#memory-purge-pattern');
    if (!input) throw new Error('Purge pattern input not found');
    return input as HTMLInputElement;
  }

  it('disables the Purge button when pattern is empty even if workspace is present', () => {
    setupTestBed();
    const fixture = TestBed.createComponent(MemoryCuratorTabComponent);
    fixture.detectChanges();

    const btn = getPurgeButton(fixture.nativeElement as HTMLElement);
    expect(btn.disabled).toBe(true);
  });

  it('disables the Purge button when workspaceRoot is null even if pattern is non-empty', () => {
    workspaceInfoSignal = signal<{
      name: string;
      path: string;
      type: string;
    } | null>(null);
    setupTestBed();
    const fixture = TestBed.createComponent(MemoryCuratorTabComponent);
    fixture.detectChanges();

    const input = getPurgeInput(fixture.nativeElement as HTMLElement);
    input.value = 'foo';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const btn = getPurgeButton(fixture.nativeElement as HTMLElement);
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('Open a workspace to purge memory.');
  });

  it('does not call RPC when window.confirm returns false', async () => {
    setupTestBed();
    const fixture = TestBed.createComponent(MemoryCuratorTabComponent);
    fixture.detectChanges();

    const input = getPurgeInput(fixture.nativeElement as HTMLElement);
    input.value = 'node_modules';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      const btn = getPurgeButton(fixture.nativeElement as HTMLElement);
      btn.click();
      await fixture.whenStable();

      expect(rpcMock.purgeBySubjectPattern).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('sets the info banner and refreshes state on successful purge', async () => {
    setupTestBed();
    rpcMock.purgeBySubjectPattern.mockResolvedValue({ deleted: 4 });
    const fixture = TestBed.createComponent(MemoryCuratorTabComponent);
    fixture.detectChanges();

    const input = getPurgeInput(fixture.nativeElement as HTMLElement);
    input.value = 'foo';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      const btn = getPurgeButton(fixture.nativeElement as HTMLElement);
      btn.click();
      // flush microtasks for the async runPurge chain
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(rpcMock.purgeBySubjectPattern).toHaveBeenCalledWith(
        'foo',
        'substring',
        '/ws',
      );
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Deleted 4 entries.');
      expect(stateMock.refresh).toHaveBeenCalled();
      expect(stateMock.loadStats).toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('sets the error banner when RPC rejects', async () => {
    setupTestBed();
    rpcMock.purgeBySubjectPattern.mockRejectedValue(
      new Error('store unavailable'),
    );
    const fixture = TestBed.createComponent(MemoryCuratorTabComponent);
    fixture.detectChanges();

    const input = getPurgeInput(fixture.nativeElement as HTMLElement);
    input.value = 'foo';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      const btn = getPurgeButton(fixture.nativeElement as HTMLElement);
      btn.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('store unavailable');
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('prevents re-entrant purge while one is in flight', async () => {
    setupTestBed();
    let resolveRpc: (value: { deleted: number }) => void = () => {
      /* assigned below */
    };
    rpcMock.purgeBySubjectPattern.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRpc = resolve;
        }),
    );

    const fixture = TestBed.createComponent(MemoryCuratorTabComponent);
    fixture.detectChanges();

    const input = getPurgeInput(fixture.nativeElement as HTMLElement);
    input.value = 'foo';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      const btn = getPurgeButton(fixture.nativeElement as HTMLElement);
      btn.click();
      await Promise.resolve();
      fixture.detectChanges();

      // Second click while in flight: onPurge() should early-return.
      btn.click();
      await Promise.resolve();

      expect(rpcMock.purgeBySubjectPattern).toHaveBeenCalledTimes(1);

      resolveRpc({ deleted: 1 });
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('clears purgeInfo and purgeError banners when the pattern input changes', async () => {
    setupTestBed();
    rpcMock.purgeBySubjectPattern.mockResolvedValue({ deleted: 2 });
    const fixture = TestBed.createComponent(MemoryCuratorTabComponent);
    fixture.detectChanges();

    const input = getPurgeInput(fixture.nativeElement as HTMLElement);
    input.value = 'foo';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      const btn = getPurgeButton(fixture.nativeElement as HTMLElement);
      btn.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      let text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Deleted 2 entries.');

      // After successful purge, pattern is cleared; typing a new pattern
      // must clear the success banner.
      const inputAfter = getPurgeInput(fixture.nativeElement as HTMLElement);
      inputAfter.value = 'bar';
      inputAfter.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('Deleted 2 entries.');
    } finally {
      confirmSpy.mockRestore();
    }
  });
});

describe('MemoryCuratorTabComponent — indexing banner three-state predicate', () => {
  function buildStateMock(): jest.Mocked<MemoryStateService> {
    return {
      entries: jest.fn(() => []),
      query: jest.fn(() => ''),
      tierFilter: jest.fn(() => 'all'),
      scopeFilter: jest.fn(() => 'workspace'),
      stats: jest.fn(() => null),
      loading: jest.fn(() => false),
      error: jest.fn(() => null),
      filteredEntries: jest.fn(() => []),
      totalsByTier: jest.fn(() => ({
        core: 0,
        recall: 0,
        archival: 0,
        codeIndex: 0,
        total: 0,
      })),
      setQuery: jest.fn(),
      setTierFilter: jest.fn(),
      setScopeFilter: jest.fn(),
      refresh: jest.fn(() => Promise.resolve()),
      search: jest.fn(() => Promise.resolve()),
      pin: jest.fn(() => Promise.resolve()),
      unpin: jest.fn(() => Promise.resolve()),
      forget: jest.fn(() => Promise.resolve()),
      rebuildIndex: jest.fn(() => Promise.resolve()),
      loadStats: jest.fn(() => Promise.resolve()),
      symbolQuery: jest.fn(() => ''),
      symbolItems: jest.fn(() => []),
      symbolTotal: jest.fn(() => 0),
      symbolLoading: jest.fn(() => false),
      symbolError: jest.fn(() => null),
      symbolOffset: jest.fn(() => 0),
      symbolLimit: jest.fn(() => 50),
      setSymbolQuery: jest.fn(),
      setSymbolPage: jest.fn(),
      loadSymbols: jest.fn(() => Promise.resolve()),
    } as unknown as jest.Mocked<MemoryStateService>;
  }

  function renderWith(uiState: IndexingUiState): HTMLElement {
    TestBed.resetTestingModule();
    const workspaceInfoSignal = signal<{
      name: string;
      path: string;
      type: string;
    } | null>({ name: 'w', path: '/ws', type: 'workspace' });

    TestBed.configureTestingModule({
      imports: [MemoryCuratorTabComponent],
      providers: [
        { provide: MemoryStateService, useValue: buildStateMock() },
        {
          provide: MemoryRpcService,
          useValue: { purgeBySubjectPattern: jest.fn() },
        },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
        {
          provide: AppStateManager,
          useValue: { workspaceInfo: workspaceInfoSignal },
        },
        {
          provide: WorkspaceIndexingService,
          useValue: indexingServiceStub(uiState),
        },
      ],
    });

    const fixture = TestBed.createComponent(MemoryCuratorTabComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the warning banner when both indexes are empty (never-indexed)', () => {
    const root = renderWith({ kind: 'never-indexed' });
    const neverIndexed = root.querySelector(
      '[data-testid="memory-banner-never-indexed"]',
    );
    const codeOnly = root.querySelector(
      '[data-testid="memory-banner-code-only"]',
    );
    expect(neverIndexed).not.toBeNull();
    expect(codeOnly).toBeNull();
    expect(neverIndexed?.textContent ?? '').toContain(
      "Your workspace isn't indexed yet",
    );
  });

  it('renders the informational code-only banner without an action button', () => {
    const root = renderWith({
      kind: 'code-only-no-memory',
      codeSymbolCount: 6992,
    });
    const codeOnly = root.querySelector(
      '[data-testid="memory-banner-code-only"]',
    );
    const neverIndexed = root.querySelector(
      '[data-testid="memory-banner-never-indexed"]',
    );
    expect(codeOnly).not.toBeNull();
    expect(neverIndexed).toBeNull();

    const text = codeOnly?.textContent ?? '';
    expect(text).toContain('Code index ready — chat to populate memory');
    expect(text).toContain('6992 symbols');

    expect(codeOnly?.querySelector('button')).toBeNull();
  });

  it('hides both banners when the indexed state is reported', () => {
    const root = renderWith({
      kind: 'indexed',
      lastIndexedAt: 1700000000000,
      isNonGit: false,
    });
    expect(
      root.querySelector('[data-testid="memory-banner-never-indexed"]'),
    ).toBeNull();
    expect(
      root.querySelector('[data-testid="memory-banner-code-only"]'),
    ).toBeNull();
  });
});
