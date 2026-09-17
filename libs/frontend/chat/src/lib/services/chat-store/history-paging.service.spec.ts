import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
  RpcResult,
  VSCodeService,
} from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  HISTORY_TAIL_PAGE_EVENTS,
  type ChatHistoryPageResult,
  type ChatResumeResult,
  type SessionId,
} from '@ptah-extension/shared';
import { HistoryPagingService } from './history-paging.service';
import { SessionHistoryReplayer } from './session-history-replayer.service';

const TAB = 'tab-history';
const SESSION = 'session-history' as SessionId;

describe('HistoryPagingService', () => {
  let cursor: string | null | undefined;
  let rpcCall: jest.Mock;
  let setOlderHistoryCursor: jest.Mock;
  let canReplayOlderPage: jest.Mock;
  let replayOlderPage: jest.Mock;
  let service: HistoryPagingService;

  beforeEach(() => {
    cursor = 'cursor-1';
    rpcCall = jest.fn();
    setOlderHistoryCursor = jest.fn((_: string, next: string | null) => {
      cursor = next;
    });
    canReplayOlderPage = jest.fn().mockReturnValue(true);
    replayOlderPage = jest.fn().mockResolvedValue('prepended');

    TestBed.configureTestingModule({
      providers: [
        HistoryPagingService,
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        {
          provide: VSCodeService,
          useValue: { config: () => ({ workspaceRoot: 'D:/repo' }) },
        },
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: jest.fn(() => ({
              tab: {
                id: TAB,
                claudeSessionId: SESSION,
                get olderHistoryCursor() {
                  return cursor;
                },
              },
              workspacePath: 'D:/repo',
            })),
            setOlderHistoryCursor,
          },
        },
        {
          provide: SessionHistoryReplayer,
          useValue: { canReplayOlderPage, replayOlderPage },
        },
      ],
    });
    service = TestBed.inject(HistoryPagingService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('uses the dedicated tail event budget and records paging metadata', () => {
    expect(service.tailRequest()).toEqual({
      maxEvents: HISTORY_TAIL_PAGE_EVENTS,
    });

    service.recordTail(TAB, {
      historyPage: { olderCursor: 'older' },
    } as ChatResumeResult);
    service.recordTail(TAB, {} as ChatResumeResult);

    expect(setOlderHistoryCursor.mock.calls).toEqual([
      [TAB, 'older'],
      [TAB, null],
    ]);
  });

  it('shares one in-flight request per tab and publishes loading state', async () => {
    let resolve!: (result: RpcResult<ChatHistoryPageResult>) => void;
    rpcCall.mockReturnValue(
      new Promise<RpcResult<ChatHistoryPageResult>>((done) => {
        resolve = done;
      }),
    );

    const first = service.loadOlder(TAB);
    const second = service.loadOlder(TAB);

    expect(second).toBe(first);
    expect(service.loadingTabIds()).toEqual(new Set([TAB]));
    expect(rpcCall).toHaveBeenCalledTimes(1);
    resolve(
      new RpcResult(true, {
        events: [],
        olderCursor: null,
        resumableSubagents: [],
      }),
    );

    await expect(first).resolves.toBe('prepended');
    expect(service.loadingTabIds()).toEqual(new Set());
    expect(replayOlderPage).toHaveBeenCalledWith(
      [],
      TAB,
      SESSION,
      'cursor-1',
      null,
      [],
    );
  });

  it('deduplicates same-tick manual-click and auto-load routes', async () => {
    let resolve!: (result: RpcResult<ChatHistoryPageResult>) => void;
    rpcCall.mockReturnValue(
      new Promise<RpcResult<ChatHistoryPageResult>>((done) => {
        resolve = done;
      }),
    );

    const manualClick = service.loadOlder(TAB);
    const autoLoadEmit = service.loadOlder(TAB);

    expect(autoLoadEmit).toBe(manualClick);
    expect(rpcCall).toHaveBeenCalledTimes(1);

    resolve(
      new RpcResult(true, {
        events: [],
        olderCursor: null,
        resumableSubagents: [],
      }),
    );
    await expect(Promise.all([manualClick, autoLoadEmit])).resolves.toEqual([
      'prepended',
      'prepended',
    ]);
  });

  it.each([undefined, null] as const)(
    'returns none without an RPC when the cursor is %s',
    async (missingCursor) => {
      cursor = missingCursor;

      await expect(service.loadOlder(TAB)).resolves.toBe('none');

      expect(rpcCall).not.toHaveBeenCalled();
      expect(service.loadingTabIds()).toEqual(new Set());
    },
  );

  it('does not send an RPC while a resume claim is held', async () => {
    canReplayOlderPage.mockReturnValue(false);

    await expect(service.loadOlder(TAB)).resolves.toBe('superseded');

    expect(canReplayOlderPage).toHaveBeenCalledWith(TAB, SESSION, 'cursor-1');
    expect(rpcCall).not.toHaveBeenCalled();
    expect(replayOlderPage).not.toHaveBeenCalled();
    expect(service.loadingTabIds()).toEqual(new Set());
  });

  it('hides a stale cursor and returns stale without replaying', async () => {
    rpcCall.mockResolvedValue(
      new RpcResult<ChatHistoryPageResult>(
        false,
        undefined,
        'cursor is stale',
        'HISTORY_CURSOR_STALE',
      ),
    );

    await expect(service.loadOlder(TAB)).resolves.toBe('stale');

    expect(setOlderHistoryCursor).toHaveBeenCalledWith(TAB, null);
    expect(replayOlderPage).not.toHaveBeenCalled();
  });

  it('keeps the cursor and returns failed for an ordinary RPC failure', async () => {
    rpcCall.mockResolvedValue(
      new RpcResult<ChatHistoryPageResult>(false, undefined, 'offline'),
    );

    await expect(service.loadOlder(TAB)).resolves.toBe('failed');

    expect(cursor).toBe('cursor-1');
    expect(setOlderHistoryCursor).not.toHaveBeenCalled();
  });

  it('keeps the cursor and returns failed when page building throws', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    rpcCall.mockResolvedValue(
      new RpcResult<ChatHistoryPageResult>(true, {
        events: [],
        olderCursor: null,
        resumableSubagents: [],
      }),
    );
    replayOlderPage.mockRejectedValue(new Error('build failed'));

    await expect(service.loadOlder(TAB)).resolves.toBe('failed');

    expect(cursor).toBe('cursor-1');
    expect(setOlderHistoryCursor).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
