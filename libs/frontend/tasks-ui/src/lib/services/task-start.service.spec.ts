/**
 * TaskStartService — orchestration launch flow (R6 / §8).
 *
 * Stubs `ClaudeRpcService`, `AppStateManager`, and `TasksStore` to exercise the
 * sequence: optional worktree → `ChatPromptRequest` bridge → `updateStatus` on
 * success ONLY, plus each failure branch (worktree fail, session fail, 30s
 * guard timeout) leaving no phantom transition.
 */
import { TestBed } from '@angular/core/testing';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import type { ChatPromptRequest } from '@ptah-extension/core';
import { TasksStore } from './tasks-store.service';
import { TaskStartService } from './task-start.service';

const ok = <T>(data: T) => ({ success: true, isSuccess: () => true, data });

/** Flush several microtask turns so awaited promise chains settle. */
const tick = async (turns = 6): Promise<void> => {
  for (let i = 0; i < turns; i++) await Promise.resolve();
};
const fail = (error: string) => ({
  success: false,
  isSuccess: () => false,
  error,
});

describe('TaskStartService', () => {
  let service: TaskStartService;
  let rpcCall: jest.Mock;
  let requestChatPrompt: jest.Mock;
  let updateStatus: jest.Mock;
  let lastPromptRequest: ChatPromptRequest | null;

  beforeEach(() => {
    lastPromptRequest = null;
    rpcCall = jest.fn();
    requestChatPrompt = jest.fn((req: ChatPromptRequest) => {
      lastPromptRequest = req;
    });
    updateStatus = jest.fn().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        TaskStartService,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
        {
          provide: AppStateManager,
          useValue: { requestChatPrompt },
        },
        { provide: TasksStore, useValue: { updateStatus } },
      ],
    });
    service = TestBed.inject(TaskStartService);
  });

  it('happy path (no worktree): fires the prompt bridge and transitions to in_progress on success', async () => {
    const pending = service.start('TASK_2026_200', false);
    await Promise.resolve();

    expect(rpcCall).not.toHaveBeenCalled(); // no worktree call
    expect(requestChatPrompt).toHaveBeenCalledTimes(1);
    expect(lastPromptRequest?.prompt).toBe(
      '/ptah-core:orchestrate TASK_2026_200',
    );
    expect(lastPromptRequest?.sessionName).toBe('TASK_2026_200');
    expect(lastPromptRequest?.cwd).toBeUndefined();

    lastPromptRequest?.resolve?.({ success: true });
    await pending;

    expect(updateStatus).toHaveBeenCalledWith('TASK_2026_200', 'in_progress');
    expect(service.error()).toBeNull();
    expect(service.busyTaskId()).toBeNull();
  });

  it('worktree path: awaits the correlated push, passes cwd, then transitions', async () => {
    rpcCall.mockImplementation(
      (_method: string, params: { operationId: string }) =>
        Promise.resolve(
          ok({ success: true, pending: true, operationId: params.operationId }),
        ),
    );

    const pending = service.start('TASK_2026_201', true);
    await tick();

    const opId = (rpcCall.mock.calls[0][1] as { operationId: string })
      .operationId;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'git:worktreeChanged',
          payload: {
            action: 'created',
            operationId: opId,
            success: true,
            path: '/wt/task-201',
          },
        },
      }),
    );
    await tick();

    expect(lastPromptRequest?.cwd).toBe('/wt/task-201');
    lastPromptRequest?.resolve?.({ success: true });
    await pending;

    expect(rpcCall).toHaveBeenCalledWith('git:addWorktree', {
      branch: 'task/TASK_2026_201',
      createBranch: true,
      operationId: opId,
    });
    expect(updateStatus).toHaveBeenCalledWith('TASK_2026_201', 'in_progress');
  });

  it('worktree failure: no prompt, no status transition, error surfaced', async () => {
    rpcCall.mockResolvedValue(fail('git exploded'));

    await service.start('TASK_2026_202', true);

    expect(requestChatPrompt).not.toHaveBeenCalled();
    expect(updateStatus).not.toHaveBeenCalled();
    expect(service.error()).toContain('Worktree for TASK_2026_202 failed');
  });

  it('session failure: status untouched, error mentions the worktree is left in place', async () => {
    rpcCall.mockImplementation(() =>
      Promise.resolve(
        ok({ success: true, pending: false, worktreePath: '/wt/task-203' }),
      ),
    );

    const pending = service.start('TASK_2026_203', true);
    await tick();

    lastPromptRequest?.resolve?.({ success: false, error: 'no session' });
    await pending;

    expect(updateStatus).not.toHaveBeenCalled();
    expect(service.error()).toContain('worktree left in place');
  });

  it('30s resolve guard: a never-resolved bridge is treated as failure (no transition)', async () => {
    jest.useFakeTimers();
    try {
      const pending = service.start('TASK_2026_204', false);
      await Promise.resolve();
      expect(requestChatPrompt).toHaveBeenCalled();

      jest.advanceTimersByTime(30_000);
      await pending;

      expect(updateStatus).not.toHaveBeenCalled();
      expect(service.error()).toContain('Timed out');
    } finally {
      jest.useRealTimers();
    }
  });

  it('is re-entrancy guarded: a second start while busy is a no-op', async () => {
    const first = service.start('TASK_2026_205', false);
    await Promise.resolve();
    await service.start('TASK_2026_205', false); // ignored — first still in flight

    expect(requestChatPrompt).toHaveBeenCalledTimes(1);
    lastPromptRequest?.resolve?.({ success: true });
    await first;
  });
});
