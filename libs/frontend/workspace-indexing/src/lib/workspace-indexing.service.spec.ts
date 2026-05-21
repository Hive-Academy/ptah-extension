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
    isLicenseError(): boolean {
      return false;
    },
    isProRequired(): boolean {
      return false;
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
