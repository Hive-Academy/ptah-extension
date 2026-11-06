import { TestBed } from '@angular/core/testing';
import type {
  IndexingProgressEvent,
  IndexingStatusWire,
} from '@ptah-extension/shared';
import { ClaudeRpcService } from '@ptah-extension/core';

import {
  WorkspaceIndexingService,
  type IndexingUiState,
} from './workspace-indexing.service';

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

function progress(
  overrides: Partial<IndexingProgressEvent> = {},
): IndexingProgressEvent {
  return {
    pipeline: 'symbols',
    percent: 0,
    currentLabel: '',
    elapsedMs: 0,
    totalKnown: false,
    ...overrides,
  };
}

describe('WorkspaceIndexingService — never-indexed override', () => {
  let service: WorkspaceIndexingService;
  let rpcCall: jest.Mock;

  beforeEach(() => {
    rpcCall = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        WorkspaceIndexingService,
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
      ],
    });
    service = TestBed.inject(WorkspaceIndexingService);
  });

  it('returns never-indexed after status loads with no progress event', async () => {
    rpcCall.mockResolvedValue(
      makeRpcResult(true, { status: baseStatus({ state: 'never-indexed' }) }),
    );
    await service.loadStatus('/ws');
    expect(service.uiState().kind).toBe('never-indexed');
  });

  it('overrides never-indexed with indexing shape when progress < 100% arrives', async () => {
    rpcCall.mockResolvedValue(
      makeRpcResult(true, { status: baseStatus({ state: 'never-indexed' }) }),
    );
    await service.loadStatus('/ws');
    service.handleMessage({
      type: 'indexing:progress',
      payload: progress({
        percent: 25,
        currentLabel: 'src/foo.ts',
        elapsedMs: 1234,
        totalKnown: true,
      }),
    });
    expect(service.uiState()).toEqual({
      kind: 'indexing',
      percent: 25,
      label: 'src/foo.ts',
      elapsedMs: 1234,
      totalKnown: true,
    });
  });

  it('keeps never-indexed when progress percent === 100 (terminal event)', async () => {
    rpcCall.mockResolvedValue(
      makeRpcResult(true, { status: baseStatus({ state: 'never-indexed' }) }),
    );
    await service.loadStatus('/ws');
    service.handleMessage({
      type: 'indexing:progress',
      payload: progress({
        percent: 100,
        currentLabel: 'src/last.ts',
        elapsedMs: 9999,
        totalKnown: true,
      }),
    });
    expect(service.uiState().kind).toBe('never-indexed');
  });

  it('regression: indexing status + progress still yields indexing shape', async () => {
    rpcCall.mockResolvedValue(
      makeRpcResult(true, { status: baseStatus({ state: 'indexing' }) }),
    );
    await service.loadStatus('/ws');
    service.handleMessage({
      type: 'indexing:progress',
      payload: progress({
        percent: 50,
        currentLabel: 'src/bar.ts',
        elapsedMs: 4200,
        totalKnown: true,
      }),
    });
    const ui = service.uiState() as Extract<
      IndexingUiState,
      { kind: 'indexing' }
    >;
    expect(ui.kind).toBe('indexing');
    expect(ui.percent).toBe(50);
    expect(ui.label).toBe('src/bar.ts');
  });

  it('no-workspace short-circuit wins over in-flight progress events', async () => {
    rpcCall.mockResolvedValue(
      makeRpcResult(true, { status: baseStatus({ state: 'never-indexed' }) }),
    );
    await service.loadStatus('/ws');
    service.handleMessage({
      type: 'indexing:progress',
      payload: progress({ percent: 33 }),
    });
    service.setWorkspaceAvailability(false);
    expect(service.uiState().kind).toBe('no-workspace');
  });
});

describe('WorkspaceIndexingService — banner three-state predicate', () => {
  let service: WorkspaceIndexingService;
  let rpcCall: jest.Mock;

  beforeEach(() => {
    rpcCall = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        WorkspaceIndexingService,
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
      ],
    });
    service = TestBed.inject(WorkspaceIndexingService);
  });

  it('returns never-indexed when both counts are zero', async () => {
    rpcCall.mockResolvedValue(
      makeRpcResult(true, {
        status: baseStatus({
          state: 'never-indexed',
          codeSymbolCount: 0,
          memoryChunkCount: 0,
        }),
      }),
    );
    await service.loadStatus('/ws');
    expect(service.uiState()).toEqual({ kind: 'never-indexed' });
  });

  it('returns code-only-no-memory when code symbols exist but memory is empty', async () => {
    rpcCall.mockResolvedValue(
      makeRpcResult(true, {
        status: baseStatus({
          state: 'never-indexed',
          codeSymbolCount: 6992,
          memoryChunkCount: 0,
        }),
      }),
    );
    await service.loadStatus('/ws');
    expect(service.uiState()).toEqual({
      kind: 'code-only-no-memory',
      codeSymbolCount: 6992,
    });
  });

  it('returns indexed when state is indexed regardless of counts', async () => {
    rpcCall.mockResolvedValue(
      makeRpcResult(true, {
        status: baseStatus({
          state: 'indexed',
          lastIndexedAt: 1700000000000,
          codeSymbolCount: 6992,
          memoryChunkCount: 10,
        }),
      }),
    );
    await service.loadStatus('/ws');
    const ui = service.uiState() as Extract<
      IndexingUiState,
      { kind: 'indexed' }
    >;
    expect(ui.kind).toBe('indexed');
    expect(ui.lastIndexedAt).toBe(1700000000000);
  });

  it('defaults missing wire fields to zero (backwards-compat with older backends)', async () => {
    rpcCall.mockResolvedValue(
      makeRpcResult(true, {
        status: baseStatus({ state: 'never-indexed' }),
      }),
    );
    await service.loadStatus('/ws');
    expect(service.uiState()).toEqual({ kind: 'never-indexed' });
  });
});

describe('WorkspaceIndexingService — running state, action messages, failed push', () => {
  let service: WorkspaceIndexingService;
  let rpcCall: jest.Mock;

  /** Route RPC calls by method; getStatus returns `status`. */
  function routeRpc(
    status: IndexingStatusWire,
    byMethod: Record<string, unknown> = {},
  ): void {
    rpcCall.mockImplementation((method: string) => {
      if (method === 'indexing:getStatus') {
        return Promise.resolve(makeRpcResult(true, { status }));
      }
      if (method in byMethod) return Promise.resolve(byMethod[method]);
      return Promise.resolve(
        makeRpcResult(true, { accepted: true, state: status.state }),
      );
    });
  }

  beforeEach(() => {
    rpcCall = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        WorkspaceIndexingService,
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
      ],
    });
    service = TestBed.inject(WorkspaceIndexingService);
  });

  it('reports indexing with processed/total from a manual running view before any push', async () => {
    routeRpc(
      baseStatus({
        state: 'indexing',
        running: {
          origin: 'manual',
          startedAt: 1,
          force: true,
          processed: 25,
          total: 100,
        },
      }),
    );
    await service.loadStatus('/ws');
    expect(service.uiState()).toEqual({
      kind: 'indexing',
      percent: 25,
      label: '',
      elapsedMs: 0,
      totalKnown: true,
      processed: 25,
      total: 100,
    });
    expect(service.runningOrigin()).toBe('manual');
    expect(service.isBusy()).toBe(true);
  });

  it('reports indexing (indeterminate) for a background run even when the row says indexed', async () => {
    routeRpc(
      baseStatus({
        state: 'indexed',
        running: { origin: 'background', startedAt: 1, force: false },
      }),
    );
    await service.loadStatus('/ws');
    expect(service.uiState()).toEqual({
      kind: 'indexing',
      percent: 0,
      label: '',
      elapsedMs: 0,
      totalKnown: false,
    });
    expect(service.runningOrigin()).toBe('background');
    expect(service.isBusy()).toBe(false);
  });

  it('reports indexing when a progress push below 100 arrives in the indexed state', async () => {
    routeRpc(baseStatus({ state: 'indexed' }));
    await service.loadStatus('/ws');
    service.handleMessage({
      type: 'indexing:progress',
      payload: progress({ percent: 40, totalKnown: true }),
    });
    expect(service.uiState().kind).toBe('indexing');
  });

  it('keeps the paused view while its last progress push is below 100', async () => {
    routeRpc(baseStatus({ state: 'paused' }));
    await service.loadStatus('/ws');
    service.handleMessage({
      type: 'indexing:progress',
      payload: progress({ percent: 40 }),
    });
    expect(service.uiState()).toEqual({ kind: 'paused', percent: 40 });
  });

  it('counts a manual start that joined a background scan as busy', async () => {
    routeRpc(
      baseStatus({
        state: 'indexing',
        running: {
          origin: 'background',
          startedAt: 1,
          force: true,
          joinedBackground: true,
        },
      }),
    );
    await service.loadStatus('/ws');
    expect(service.isBusy()).toBe(true);
  });

  it('exposes lastRun from the status', async () => {
    const lastRun = {
      origin: 'background',
      outcome: 'succeeded',
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
    } as const;
    routeRpc(baseStatus({ state: 'indexed', lastRun }));
    expect(service.lastRun()).toBeNull();
    await service.loadStatus('/ws');
    expect(service.lastRun()).toEqual(lastRun);
  });

  it.each([
    [
      'already-running',
      'info',
      'A full index is already running.',
    ],
    [
      'indexer-not-ready',
      'error',
      'The code indexer is not ready yet. Open a workspace folder and try again.',
    ],
    ['no-workspace', 'error', 'Open a workspace folder to index it.'],
    ['setup-failed', 'error', 'Could not start indexing. See the logs.'],
  ] as const)(
    'start refusal %s sets a fixed %s message',
    async (reason, tone, text) => {
      routeRpc(baseStatus({ state: 'indexed' }), {
        'indexing:start': makeRpcResult(true, {
          accepted: false,
          reason,
          state: 'indexed',
        }),
      });
      await expect(service.start('/ws', true)).resolves.toBeUndefined();
      expect(service.actionMessage()).toEqual({ tone, text });
      expect(service.isBusy()).toBe(false);
    },
  );

  it('resume refusal sets the same fixed message', async () => {
    routeRpc(baseStatus({ state: 'paused' }), {
      'indexing:resume': makeRpcResult(true, {
        accepted: false,
        reason: 'indexer-not-ready',
        state: 'paused',
      }),
    });
    await service.resume('/ws');
    expect(service.actionMessage()).toEqual({
      tone: 'error',
      text: 'The code indexer is not ready yet. Open a workspace folder and try again.',
    });
  });

  it('a start that joins a background scan sets the joined info message', async () => {
    routeRpc(
      baseStatus({
        state: 'indexing',
        running: {
          origin: 'background',
          startedAt: 1,
          force: true,
          joinedBackground: true,
        },
      }),
    );
    await service.start('/ws', true);
    expect(service.actionMessage()).toEqual({
      tone: 'info',
      text: 'Joined the scan already in progress. Progress appears after its next batch.',
    });
  });

  it('a failed start RPC sets the fixed error and never shows transport text', async () => {
    const failed = makeRpcResult(false, undefined);
    failed.error = 'ECONNRESET /home/secret/path';
    routeRpc(baseStatus({ state: 'indexed' }), { 'indexing:start': failed });
    await service.start('/ws');
    expect(service.actionMessage()).toEqual({
      tone: 'error',
      text: 'Could not start indexing. See the logs.',
    });
  });

  it('start, pause and cancel never reject when the transport throws', async () => {
    rpcCall.mockRejectedValue(new Error('boom'));
    await expect(service.start('/ws')).resolves.toBeUndefined();
    expect(service.actionMessage()?.text).toBe(
      'Could not start indexing. See the logs.',
    );
    expect(service.starting()).toBe(false);
    await expect(service.pause('/ws')).resolves.toBeUndefined();
    expect(service.actionMessage()?.text).toBe(
      'Could not pause indexing. See the logs.',
    );
    await expect(service.cancel('/ws')).resolves.toBeUndefined();
    expect(service.actionMessage()?.text).toBe(
      'Could not cancel indexing. See the logs.',
    );
    await expect(service.resume('/ws')).resolves.toBeUndefined();
  });

  it('is busy while a start is in flight and ignores a second start', async () => {
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
    const first = service.start('/ws');
    expect(service.isBusy()).toBe(true);
    await service.start('/ws');
    expect(
      rpcCall.mock.calls.filter(([m]) => m === 'indexing:start'),
    ).toHaveLength(1);
    release(makeRpcResult(true, { accepted: true, state: 'indexing' }));
    await first;
    expect(service.isBusy()).toBe(false);
  });

  it('indexing:failed clears progress and reloads the status', async () => {
    routeRpc(baseStatus({ state: 'error' }));
    service.handleMessage({
      type: 'indexing:progress',
      payload: progress({ percent: 30 }),
    });
    rpcCall.mockClear();
    service.handleMessage({
      type: 'indexing:failed',
      payload: {
        workspaceRoot: '/ws',
        workspaceFingerprint: 'fp',
        failedAt: 5,
        elapsedMs: 4,
        origin: 'manual',
      },
    });
    expect(service.progress()).toBeNull();
    expect(rpcCall).toHaveBeenCalledWith('indexing:getStatus', {
      workspaceRoot: '/ws',
    });
    expect(service.handledMessageTypes).toContain('indexing:failed');
  });

  it('cancel clears the last progress event', async () => {
    routeRpc(baseStatus({ state: 'indexed' }));
    service.handleMessage({
      type: 'indexing:progress',
      payload: progress({ percent: 30 }),
    });
    await service.cancel('/ws');
    expect(service.progress()).toBeNull();
    expect(service.uiState().kind).toBe('indexed');
  });
});
