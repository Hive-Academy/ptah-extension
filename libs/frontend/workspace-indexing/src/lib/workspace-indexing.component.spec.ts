import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type {
  IndexingProgressEvent,
  IndexingStatusWire,
} from '@ptah-extension/shared';
import { AppStateManager, ClaudeRpcService, WallClockService, WALL_CLOCK_COARSE_MS } from '@ptah-extension/core';

import {
  WorkspaceIndexingService,
  type IndexingUiState,
} from './workspace-indexing.service';
import { WorkspaceIndexingComponent } from './workspace-indexing.component';

// --- Helpers ---------------------------------------------------------------

function baseStatus(
  overrides: Partial<IndexingStatusWire> = {},
): IndexingStatusWire {
  return {
    state: 'never-indexed',
    workspaceFingerprint: 'fp-test',
    gitHeadSha: null,
    currentGitHeadSha: null,
    lastIndexedAt: null,
    symbolsEnabled: true,
    memoryEnabled: true,
    symbolsCursor: null,
    disclosureAcknowledgedAt: null,
    lastDismissedStaleSha: null,
    errorMessage: null,
    ...overrides,
  };
}

function makeRpcResult<T>(success: boolean, data?: T) {
  return {
    success,
    data,
    error: undefined as string | undefined,
    errorCode: undefined,
    isSuccess(): boolean {
      return success && data !== undefined;
    },
    isError(): boolean {
      return !success;
    },
  };
}

// --- Service tests ---------------------------------------------------------

describe('WorkspaceIndexingService', () => {
  let service: WorkspaceIndexingService;
  let rpcCall: jest.Mock;

  beforeEach(() => {
    rpcCall = jest.fn();
    const rpcStub = { call: rpcCall };
    TestBed.configureTestingModule({
      providers: [
        WorkspaceIndexingService,
        { provide: ClaudeRpcService, useValue: rpcStub },
      ],
    });
    service = TestBed.inject(WorkspaceIndexingService);
  });

  describe('uiState computed', () => {
    it('returns loading before status loads', () => {
      const ui = service.uiState();
      expect(ui.kind).toBe('loading');
    });

    it('returns no-workspace when workspace gating is off', () => {
      service.setWorkspaceAvailability(false);
      expect(service.uiState().kind).toBe('no-workspace');
    });

    it('maps never-indexed', () => {
      rpcCall.mockResolvedValue(
        makeRpcResult(true, { status: baseStatus({ state: 'never-indexed' }) }),
      );
      return service.loadStatus('/ws').then(() => {
        expect(service.uiState().kind).toBe('never-indexed');
      });
    });

    it('maps indexing with progress event values', async () => {
      rpcCall.mockResolvedValue(
        makeRpcResult(true, { status: baseStatus({ state: 'indexing' }) }),
      );
      await service.loadStatus('/ws');
      const progress: IndexingProgressEvent = {
        pipeline: 'symbols',
        percent: 42,
        currentLabel: 'src/foo.ts',
        elapsedMs: 1200,
        totalKnown: true,
      };
      service.handleMessage({ type: 'indexing:progress', payload: progress });
      const ui = service.uiState() as Extract<
        IndexingUiState,
        { kind: 'indexing' }
      >;
      expect(ui.kind).toBe('indexing');
      expect(ui.percent).toBe(42);
      expect(ui.label).toBe('src/foo.ts');
      expect(ui.totalKnown).toBe(true);
    });

    it('maps paused', async () => {
      rpcCall.mockResolvedValue(
        makeRpcResult(true, { status: baseStatus({ state: 'paused' }) }),
      );
      await service.loadStatus('/ws');
      service.handleMessage({
        type: 'indexing:progress',
        payload: {
          pipeline: 'symbols',
          percent: 18,
          currentLabel: '',
          elapsedMs: 0,
          totalKnown: true,
        } satisfies IndexingProgressEvent,
      });
      const ui = service.uiState() as Extract<
        IndexingUiState,
        { kind: 'paused' }
      >;
      expect(ui.kind).toBe('paused');
      expect(ui.percent).toBe(18);
    });

    it('maps indexed (git workspace)', async () => {
      rpcCall.mockResolvedValue(
        makeRpcResult(true, {
          status: baseStatus({
            state: 'indexed',
            gitHeadSha: 'abcdef0',
            currentGitHeadSha: 'abcdef0',
            lastIndexedAt: 1000,
          }),
        }),
      );
      await service.loadStatus('/ws');
      const ui = service.uiState() as Extract<
        IndexingUiState,
        { kind: 'indexed' }
      >;
      expect(ui.kind).toBe('indexed');
      expect(ui.isNonGit).toBe(false);
      expect(ui.lastIndexedAt).toBe(1000);
    });

    it('maps indexed with isNonGit when both SHAs are null', async () => {
      rpcCall.mockResolvedValue(
        makeRpcResult(true, {
          status: baseStatus({
            state: 'indexed',
            gitHeadSha: null,
            currentGitHeadSha: null,
          }),
        }),
      );
      await service.loadStatus('/ws');
      const ui = service.uiState() as Extract<
        IndexingUiState,
        { kind: 'indexed' }
      >;
      expect(ui.isNonGit).toBe(true);
    });

    it('maps stale when SHAs differ and not dismissed', async () => {
      rpcCall.mockResolvedValue(
        makeRpcResult(true, {
          status: baseStatus({
            state: 'stale',
            gitHeadSha: 'aaa1111',
            currentGitHeadSha: 'bbb2222',
            lastDismissedStaleSha: null,
          }),
        }),
      );
      await service.loadStatus('/ws');
      const ui = service.uiState() as Extract<
        IndexingUiState,
        { kind: 'stale' }
      >;
      expect(ui.kind).toBe('stale');
      expect(ui.prevSha).toBe('aaa1111');
      expect(ui.currentSha).toBe('bbb2222');
    });

    it('downgrades stale to indexed when current SHA matches dismissed SHA', async () => {
      rpcCall.mockResolvedValue(
        makeRpcResult(true, {
          status: baseStatus({
            state: 'stale',
            gitHeadSha: 'aaa1111',
            currentGitHeadSha: 'bbb2222',
            lastDismissedStaleSha: 'bbb2222',
          }),
        }),
      );
      await service.loadStatus('/ws');
      expect(service.uiState().kind).toBe('indexed');
    });

    it('maps error with message', async () => {
      rpcCall.mockResolvedValue(
        makeRpcResult(true, {
          status: baseStatus({ state: 'error', errorMessage: 'disk full' }),
        }),
      );
      await service.loadStatus('/ws');
      const ui = service.uiState() as Extract<
        IndexingUiState,
        { kind: 'error' }
      >;
      expect(ui.kind).toBe('error');
      expect(ui.message).toBe('disk full');
    });

    it('falls back to default error message when null', async () => {
      rpcCall.mockResolvedValue(
        makeRpcResult(true, {
          status: baseStatus({ state: 'error', errorMessage: null }),
        }),
      );
      await service.loadStatus('/ws');
      const ui = service.uiState() as Extract<
        IndexingUiState,
        { kind: 'error' }
      >;
      expect(ui.message).toBe('Indexing failed.');
    });
  });

  describe('handleMessage', () => {
    it('ignores unrelated message types', () => {
      service.handleMessage({ type: 'something:else', payload: { foo: 1 } });
      expect(service.progress()).toBeNull();
    });

    it('updates progress signal on indexing:progress', () => {
      const event: IndexingProgressEvent = {
        pipeline: 'symbols',
        percent: 99,
        currentLabel: 'last',
        elapsedMs: 5000,
        totalKnown: true,
      };
      service.handleMessage({ type: 'indexing:progress', payload: event });
      expect(service.progress()).toEqual(event);
    });
  });

  describe('RPC delegation', () => {
    beforeEach(() => {
      rpcCall.mockResolvedValue(
        makeRpcResult(true, { status: baseStatus({ state: 'indexed' }) }),
      );
    });

    it('loadStatus forwards workspaceRoot', async () => {
      await service.loadStatus('/abc');
      expect(rpcCall).toHaveBeenCalledWith('indexing:getStatus', {
        workspaceRoot: '/abc',
      });
    });

    it('start forwards force=true (re-index)', async () => {
      await service.start('/abc', true);
      expect(rpcCall).toHaveBeenCalledWith('indexing:start', {
        workspaceRoot: '/abc',
        force: true,
      });
    });

    it('pause uses indexing:pause', async () => {
      await service.pause('/abc');
      expect(rpcCall).toHaveBeenCalledWith('indexing:pause', {});
    });

    it('resume uses indexing:resume', async () => {
      await service.resume('/abc');
      expect(rpcCall).toHaveBeenCalledWith('indexing:resume', {
        workspaceRoot: '/abc',
      });
    });

    it('cancel uses indexing:cancel', async () => {
      await service.cancel('/abc');
      expect(rpcCall).toHaveBeenCalledWith('indexing:cancel', {});
    });

    it('setPipelineEnabled forwards pipeline + enabled', async () => {
      await service.setPipelineEnabled('memory', false, '/abc');
      expect(rpcCall).toHaveBeenCalledWith('indexing:setPipelineEnabled', {
        workspaceRoot: '/abc',
        pipeline: 'memory',
        enabled: false,
      });
    });

    it('dismissStale uses indexing:dismissStale', async () => {
      await service.dismissStale('/abc');
      expect(rpcCall).toHaveBeenCalledWith('indexing:dismissStale', {
        workspaceRoot: '/abc',
      });
    });

    it('acknowledgeDisclosure uses indexing:acknowledgeDisclosure', async () => {
      await service.acknowledgeDisclosure('/abc');
      expect(rpcCall).toHaveBeenCalledWith('indexing:acknowledgeDisclosure', {
        workspaceRoot: '/abc',
      });
    });
  });
});

// --- Component tests -------------------------------------------------------

describe('WorkspaceIndexingComponent', () => {
  let rpcCall: jest.Mock;
  let workspaceInfoSig: ReturnType<
    typeof signal<{ name: string; path: string; type: string } | null>
  >;

  function setup() {
    rpcCall = jest
      .fn()
      .mockResolvedValue(
        makeRpcResult(true, { status: baseStatus({ state: 'never-indexed' }) }),
      );
    workspaceInfoSig = signal<{
      name: string;
      path: string;
      type: string;
    } | null>({
      name: 'ws',
      path: '/ws',
      type: 'folder',
    });
    const appStateStub = { workspaceInfo: workspaceInfoSig.asReadonly() };

    TestBed.configureTestingModule({
      imports: [WorkspaceIndexingComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        { provide: AppStateManager, useValue: appStateStub },
      ],
    });

    const fixture = TestBed.createComponent(WorkspaceIndexingComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders without throwing for default never-indexed status', async () => {
    const fixture = setup();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h2')?.textContent).toContain(
      'Workspace Indexing',
    );
  });

  it('formatRelativeTime uses a dash for missing data', () => {
    const fixture = setup();
    const cmp = fixture.componentInstance;
    expect(cmp.formatRelativeTime(null)).toBe('—');
  });

  it('updates relative time on coarse ticks and holds the label between ticks', () => {
    jest.useFakeTimers({
      doNotFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    }).setSystemTime(200_000);
    const setIntervalSpy = jest.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
    try {
      const fixture = setup();
      const clock = TestBed.inject(WallClockService);
      expect(clock.now('coarse')()).toBe(200_000);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), WALL_CLOCK_COARSE_MS);
      const interval = setIntervalSpy.mock.results.find((result) => result.type === 'return')?.value;
      const label = () => fixture.componentInstance.formatRelativeTime(110_000);
      expect(label()).toBe('1 minute ago');
      jest.advanceTimersByTime(WALL_CLOCK_COARSE_MS - 1);
      expect(label()).toBe('1 minute ago');
      jest.advanceTimersByTime(1);
      expect(label()).toBe('2 minutes ago');
      fixture.destroy();
      expect(clearIntervalSpy).toHaveBeenCalledWith(interval);
    } finally {
      jest.restoreAllMocks();
      jest.useRealTimers();
    }
  });

  it('shortSha truncates to 7 chars', () => {
    const fixture = setup();
    const cmp = fixture.componentInstance;
    expect(cmp.shortSha('abcdef0123456789')).toBe('abcdef0');
    expect(cmp.shortSha(null)).toBe('—');
  });

  it('onTogglePipeline forwards to RPC with workspace root', async () => {
    const fixture = setup();
    await fixture.whenStable();
    rpcCall.mockClear();
    rpcCall.mockResolvedValue(
      makeRpcResult(true, {
        applied: true,
        symbolsEnabled: false,
        memoryEnabled: true,
      }),
    );
    await fixture.componentInstance.onTogglePipeline('symbols', false);
    expect(rpcCall).toHaveBeenCalledWith('indexing:setPipelineEnabled', {
      workspaceRoot: '/ws',
      pipeline: 'symbols',
      enabled: false,
    });
  });
});

describe('WorkspaceIndexingComponent — busy state, last run, messages', () => {
  const NOW = 10_000_000;

  async function render(status: IndexingStatusWire, startResult?: unknown) {
    const rpcCall = jest.fn((method: string) => {
      if (method === 'indexing:getStatus') {
        return Promise.resolve(makeRpcResult(true, { status }));
      }
      if (method === 'indexing:start' && startResult !== undefined) {
        return Promise.resolve(startResult);
      }
      return Promise.resolve(
        makeRpcResult(true, { accepted: true, state: status.state }),
      );
    });
    TestBed.configureTestingModule({
      imports: [WorkspaceIndexingComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        {
          provide: AppStateManager,
          useValue: {
            workspaceInfo: signal({ name: 'ws', path: '/ws', type: 'folder' }),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(WorkspaceIndexingComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, rpcCall };
  }

  function query(fixture: { nativeElement: HTMLElement }, sel: string) {
    return fixture.nativeElement.querySelector(sel) as HTMLElement | null;
  }

  beforeEach(() => {
    jest
      .useFakeTimers({
        doNotFake: [
          'setTimeout',
          'clearTimeout',
          'setImmediate',
          'queueMicrotask',
          'nextTick',
          'requestAnimationFrame',
          'cancelAnimationFrame',
        ],
      })
      .setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('disables Re-index with a spinner while a manual start is in flight', async () => {
    const { fixture, rpcCall } = await render(baseStatus({ state: 'indexed' }));
    let release: (value: unknown) => void = () => undefined;
    rpcCall.mockImplementation((method: string) => {
      if (method === 'indexing:start') {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve(
        makeRpcResult(true, { status: baseStatus({ state: 'indexed' }) }),
      );
    });
    const button = query(
      fixture,
      '[aria-label="Re-index workspace"]',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    const pending = fixture.componentInstance.onStart(true);
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
    expect(button.querySelector('.loading-spinner')).not.toBeNull();
    release(makeRpcResult(true, { accepted: true, state: 'indexed' }));
    await pending;
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
  });

  it('shows the manual header and no Re-index while a manual run is live', async () => {
    const { fixture } = await render(
      baseStatus({
        state: 'indexing',
        running: { origin: 'manual', startedAt: 1, force: true },
      }),
    );
    expect(query(fixture, '[data-testid="indexing-header"]')?.textContent).toContain(
      'Indexing workspace…',
    );
    expect(query(fixture, '[data-testid="indexing-join-background"]')).toBeNull();
  });

  it('shows the background header with an enabled Re-index during a background-only run', async () => {
    const { fixture } = await render(
      baseStatus({
        state: 'indexing',
        running: {
          origin: 'background',
          startedAt: 1,
          force: false,
          processed: 10,
          total: 40,
        },
      }),
    );
    expect(
      query(fixture, '[data-testid="indexing-header"]')?.textContent?.trim(),
    ).toBe('Background scan in progress (startup or file changes)');
    const join = query(
      fixture,
      '[data-testid="indexing-join-background"]',
    ) as HTMLButtonElement;
    expect(join.disabled).toBe(false);
    expect(query(fixture, '[data-testid="state-indexing"]')?.textContent).toContain(
      '10 of 40 files',
    );
  });

  it('renders the last manual run summary with counts and duration', async () => {
    const { fixture } = await render(
      baseStatus({
        state: 'indexed',
        lastIndexedAt: NOW - 120_000,
        lastRun: {
          origin: 'manual',
          outcome: 'succeeded',
          startedAt: NOW - 120_000 - 8_700_000,
          finishedAt: NOW - 120_000,
          durationMs: 8_700_000,
          filesScanned: 3806,
          symbolsIndexed: 41371,
          errors: 16,
        },
      }),
    );
    expect(
      query(fixture, '[data-testid="last-run-summary"]')?.textContent?.trim(),
    ).toBe(
      'Last manual run 2 minutes ago: 3806 files, 41371 symbols, 16 errors, 2h 25m',
    );
  });

  it('renders a failed background scan with the fixed sentence and no raw error', async () => {
    const { fixture } = await render(
      baseStatus({
        state: 'error',
        errorMessage: 'SQLITE_BUSY at /home/secret/db',
        lastRun: {
          origin: 'background',
          outcome: 'failed',
          startedAt: NOW - 5_000,
          finishedAt: NOW - 1_000,
          durationMs: 4_000,
        },
      }),
    );
    expect(
      query(fixture, '[data-testid="last-run-summary"]')?.textContent?.trim(),
    ).toBe('Last background scan just now failed. See the logs for details.');
    expect(
      query(fixture, '[data-testid="callout-error"]')?.textContent?.trim(),
    ).toBe('Indexing failed. See the logs for details.');
    expect(fixture.nativeElement.textContent).not.toContain('SQLITE_BUSY');
  });

  it('renders a background scan summary in the never-indexed block', async () => {
    const { fixture } = await render(
      baseStatus({
        state: 'never-indexed',
        lastIndexedAt: null,
        lastRun: {
          origin: 'background',
          outcome: 'succeeded',
          startedAt: NOW - 5_000,
          finishedAt: NOW - 1_000,
          durationMs: 4_000,
          filesScanned: 12,
        },
      }),
    );
    expect(query(fixture, '[data-testid="state-never-indexed"]')).not.toBeNull();
    expect(
      query(fixture, '[data-testid="last-run-summary"]')?.textContent?.trim(),
    ).toBe('Last background scan just now: 12 files, 4s');
  });

  it('labels a kept manual error apart from a later successful background scan', async () => {
    const { fixture } = await render(
      baseStatus({
        state: 'error',
        errorMessage: 'boom',
        lastRun: {
          origin: 'background',
          outcome: 'succeeded',
          startedAt: NOW - 5_000,
          finishedAt: NOW - 1_000,
          durationMs: 4_000,
        },
      }),
    );
    const block = query(fixture, '[data-testid="state-error"]')?.textContent;
    expect(block).toContain('A manual index run did not finish.');
    expect(block).not.toContain('The last index run did not finish');
    expect(
      query(fixture, '[data-testid="last-run-summary"]')?.textContent?.trim(),
    ).toBe('Last background scan just now: 4s');
  });

  it('renders the last run line in the stale block', async () => {
    const { fixture } = await render(
      baseStatus({
        state: 'stale',
        gitHeadSha: 'aaa1111',
        currentGitHeadSha: 'bbb2222',
        lastRun: {
          origin: 'background',
          outcome: 'cancelled',
          startedAt: NOW - 5_000,
          finishedAt: NOW - 1_000,
          durationMs: 4_000,
        },
      }),
    );
    expect(
      query(fixture, '[data-testid="last-run-summary"]')?.textContent?.trim(),
    ).toBe('Last background scan just now was cancelled.');
  });

  it('renders a refusal as role="alert" and an info message as role="status"', async () => {
    const { fixture, rpcCall } = await render(
      baseStatus({ state: 'indexed' }),
      makeRpcResult(true, {
        accepted: false,
        reason: 'indexer-not-ready',
        state: 'indexed',
      }),
    );
    await fixture.componentInstance.onStart(true);
    fixture.detectChanges();
    let message = query(fixture, '[data-testid="indexing-action-message"]');
    expect(message?.getAttribute('role')).toBe('alert');
    expect(message?.textContent?.trim()).toBe(
      'The code indexer is not ready yet. Open a workspace folder and try again.',
    );

    rpcCall.mockImplementation((method: string) =>
      Promise.resolve(
        method === 'indexing:getStatus'
          ? makeRpcResult(true, { status: baseStatus({ state: 'indexed' }) })
          : makeRpcResult(true, {
              accepted: false,
              reason: 'already-running',
              state: 'indexing',
            }),
      ),
    );
    await fixture.componentInstance.onStart(true);
    fixture.detectChanges();
    message = query(fixture, '[data-testid="indexing-action-message"]');
    expect(message?.getAttribute('role')).toBe('status');
    expect(message?.textContent?.trim()).toBe('A full index is already running.');
  });

  it('renders the how-it-works text verbatim', async () => {
    const { fixture } = await render(baseStatus({ state: 'indexed' }));
    const text = query(fixture, '[data-testid="indexing-how-it-works"]')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim();
    expect(text).toBe(
      'Ptah parses the source files in this workspace into symbols and stores them in a local database, then keeps them current as files change. Re-index runs a full scan; on a large repository this can take a long time, and progress shows here while you can pause or cancel. If a startup or file-change scan is already running, Re-index joins it. Code search tools and memory search read this index.',
    );
  });
});
