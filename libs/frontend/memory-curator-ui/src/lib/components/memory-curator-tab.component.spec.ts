import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AppStateManager, VSCodeService } from '@ptah-extension/core';

import { MemoryStateService } from '../services/memory-state.service';
import { MemoryRpcService } from '../services/memory-rpc.service';

import { MemoryCuratorTabComponent } from './memory-curator-tab.component';

function vscodeServiceStub(isElectron: boolean): Partial<VSCodeService> {
  return {
    config: signal({ isElectron }),
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
    } as unknown as jest.Mocked<MemoryStateService>;

    stateMock = baseState;

    await TestBed.configureTestingModule({
      imports: [MemoryCuratorTabComponent],
      providers: [
        { provide: MemoryStateService, useValue: stateMock },
        { provide: VSCodeService, useValue: vscodeServiceStub(true) },
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
