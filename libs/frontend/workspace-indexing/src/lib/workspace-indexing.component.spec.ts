import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type {
  IndexingProgressEvent,
  IndexingStatusWire,
} from '@ptah-extension/shared';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';

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
    isLicenseError(): boolean {
      return false;
    },
    isProRequired(): boolean {
      return false;
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

  it('formatRelativeTime returns "just now" for null', () => {
    const fixture = setup();
    const cmp = fixture.componentInstance;
    expect(cmp.formatRelativeTime(null)).toBe('just now');
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
