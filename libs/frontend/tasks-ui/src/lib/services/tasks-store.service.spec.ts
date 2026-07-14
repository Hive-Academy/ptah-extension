/**
 * TasksStore — signal store tests.
 *
 * Stubs `ClaudeRpcService.call` so board load, push-triggered refresh, and the
 * (non-optimistic) status-change path are exercised against the real `tasks:*`
 * RPC names without the message bus.
 */
import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  TASK_STATUSES,
  type TaskSpecSummary,
  type TaskStatus,
  type TasksBoardResult,
} from '@ptah-extension/shared';
import { TasksStore, TASKS_CHANGED_MESSAGE_TYPE } from './tasks-store.service';

function makeTask(
  id: string,
  status: TaskStatus,
  overrides: Partial<TaskSpecSummary> = {},
): TaskSpecSummary {
  return {
    id,
    folderName: id,
    status,
    type: 'FEATURE',
    title: `Title ${id}`,
    dependsOn: [],
    created: '2026-07-14T10:00:00.000Z',
    updated: '2026-07-14T10:00:00.000Z',
    frontmatterValid: true,
    validationIssues: [],
    ...overrides,
  };
}

function makeBoard(
  partial: Partial<Record<TaskStatus, TaskSpecSummary[]>>,
  meta: Partial<
    Pick<TasksBoardResult, 'excludedCount' | 'specsDirExists'>
  > = {},
): TasksBoardResult {
  const columns = TASK_STATUSES.reduce(
    (acc, status) => {
      acc[status] = partial[status] ?? [];
      return acc;
    },
    {} as Record<TaskStatus, TaskSpecSummary[]>,
  );
  return {
    columns,
    excludedCount: meta.excludedCount ?? 0,
    specsDirExists: meta.specsDirExists ?? true,
  };
}

const ok = <T>(data: T) => ({
  success: true,
  isSuccess: () => true,
  data,
});
const err = (error: string) => ({
  success: false,
  isSuccess: () => false,
  error,
});

describe('TasksStore', () => {
  let store: TasksStore;
  let rpcCall: jest.Mock;

  beforeEach(() => {
    rpcCall = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        TasksStore,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
      ],
    });
    store = TestBed.inject(TasksStore);
  });

  it('loadBoard() populates columns, excluded count, and specsDirExists', async () => {
    rpcCall.mockResolvedValue(
      ok(
        makeBoard(
          { backlog: [makeTask('TASK_2026_200', 'backlog')] },
          { excludedCount: 85, specsDirExists: true },
        ),
      ),
    );

    await store.loadBoard();

    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {});
    expect(store.columns().backlog).toHaveLength(1);
    expect(store.excludedCount()).toBe(85);
    expect(store.specsDirExists()).toBe(true);
    expect(store.totalCount()).toBe(1);
    expect(store.isEmpty()).toBe(false);
  });

  it('board() computed exposes all six columns in canonical order', async () => {
    rpcCall.mockResolvedValue(ok(makeBoard({})));

    await store.loadBoard();

    expect(store.board().map((c) => c.status)).toEqual([...TASK_STATUSES]);
  });

  it('isEmpty() is true after a load when the specs dir is absent', async () => {
    rpcCall.mockResolvedValue(ok(makeBoard({}, { specsDirExists: false })));

    await store.loadBoard();

    expect(store.isEmpty()).toBe(true);
  });

  it('records an error when the board load fails', async () => {
    rpcCall.mockResolvedValue(err('scan-failed'));

    await store.loadBoard();

    expect(store.error()).toBe('scan-failed');
  });

  it('handleMessage refreshes the board on a tasks:changed push', async () => {
    rpcCall.mockResolvedValue(ok(makeBoard({})));

    store.handleMessage({ type: TASKS_CHANGED_MESSAGE_TYPE });
    await Promise.resolve();
    await Promise.resolve();

    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {});
  });

  it('handleMessage ignores unrelated message types', () => {
    store.handleMessage({ type: 'something:else' });
    expect(rpcCall).not.toHaveBeenCalled();
  });

  it('updateStatus does NOT optimistically move the card before re-fetch', async () => {
    rpcCall.mockResolvedValueOnce(
      ok(makeBoard({ backlog: [makeTask('TASK_2026_200', 'backlog')] })),
    );
    await store.loadBoard();
    expect(store.columns().backlog).toHaveLength(1);

    // updateStatus success, then an authoritative re-fetch that moves the card.
    rpcCall.mockResolvedValueOnce(
      ok({ success: true, task: makeTask('TASK_2026_200', 'in_progress') }),
    );
    rpcCall.mockResolvedValueOnce(
      ok(
        makeBoard({ in_progress: [makeTask('TASK_2026_200', 'in_progress')] }),
      ),
    );

    await store.updateStatus('TASK_2026_200', 'in_progress');

    expect(rpcCall).toHaveBeenCalledWith('tasks:updateStatus', {
      taskId: 'TASK_2026_200',
      status: 'in_progress',
    });
    // The board reflects the server-authoritative re-fetch, not a local guess.
    expect(store.columns().backlog).toHaveLength(0);
    expect(store.columns().in_progress).toHaveLength(1);
  });

  it('updateStatus surfaces the structured backend error', async () => {
    rpcCall.mockResolvedValueOnce(
      ok({
        success: false,
        error: { code: 'TASK_EXCLUDED', message: 'excluded' },
      }),
    );

    await store.updateStatus('TASK_2026_200', 'done');

    expect(store.error()).toBe('excluded');
  });

  it('createTask reloads the board on success', async () => {
    rpcCall.mockResolvedValueOnce(
      ok({ success: true, task: makeTask('TASK_2026_201', 'backlog') }),
    );
    rpcCall.mockResolvedValueOnce(
      ok(makeBoard({ backlog: [makeTask('TASK_2026_201', 'backlog')] })),
    );

    const result = await store.createTask({ title: 'New', type: 'FEATURE' });

    expect(rpcCall).toHaveBeenCalledWith('tasks:create', {
      title: 'New',
      type: 'FEATURE',
    });
    expect(result?.success).toBe(true);
    expect(store.columns().backlog).toHaveLength(1);
  });

  it('reindex sets an action message and reloads', async () => {
    rpcCall.mockResolvedValueOnce(
      ok({ success: true, indexedCount: 3, excludedCount: 85, durationMs: 12 }),
    );
    rpcCall.mockResolvedValueOnce(ok(makeBoard({})));

    await store.reindex();

    expect(rpcCall).toHaveBeenCalledWith('tasks:reindex', {});
    expect(store.actionMessage()).toContain('3');
  });

  it('openTask fetches and stores the detail', async () => {
    const detail = {
      ...makeTask('TASK_2026_200', 'backlog'),
      body: '# body',
      artifacts: ['task.md'],
    };
    rpcCall.mockResolvedValueOnce(ok({ task: detail }));

    await store.openTask('TASK_2026_200');

    expect(rpcCall).toHaveBeenCalledWith('tasks:get', {
      taskId: 'TASK_2026_200',
    });
    expect(store.selectedTaskId()).toBe('TASK_2026_200');
    expect(store.taskDetail()?.body).toBe('# body');
  });
});
