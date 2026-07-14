/**
 * TaskStartService — orchestration launch flow (R6 / §8, F-D1).
 *
 * Stubs `AppStateManager` and `TasksStore` to exercise the sequence:
 * `ChatPromptRequest` bridge → `updateStatus` on resolved success ONLY, plus
 * each non-success branch (structural failure, 30s guard timeout) leaving no
 * phantom transition. The host no longer creates a worktree (F-D1): isolation
 * is an agent-managed prompt directive, so NO `git:addWorktree` RPC is fired.
 */
import { TestBed } from '@angular/core/testing';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import type { ChatPromptRequest } from '@ptah-extension/core';
import { TasksStore } from './tasks-store.service';
import { TaskStartService } from './task-start.service';

const ISOLATION_HINT = 'Isolate all implementation for this task';

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
        // Provided purely as a regression guard: the launch flow must never
        // touch the RPC layer (no host-side `git:addWorktree`, F-D1).
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

  it('isolate=false: sends the plain prompt and transitions to in_progress on success', async () => {
    const pending = service.start('TASK_2026_200', false);
    await Promise.resolve();

    expect(rpcCall).not.toHaveBeenCalled(); // no host-side worktree RPC
    expect(requestChatPrompt).toHaveBeenCalledTimes(1);
    expect(lastPromptRequest?.prompt).toBe(
      '/ptah-core:orchestrate TASK_2026_200',
    );
    expect(lastPromptRequest?.prompt).not.toContain(ISOLATION_HINT);
    expect(lastPromptRequest?.sessionName).toBe('TASK_2026_200');

    lastPromptRequest?.resolve?.({ success: true });
    await pending;

    expect(updateStatus).toHaveBeenCalledWith('TASK_2026_200', 'in_progress');
    expect(service.error()).toBeNull();
    expect(service.busyTaskId()).toBeNull();
  });

  it('isolate=true: appends the worktree-isolation directive and makes NO addWorktree RPC call', async () => {
    const pending = service.start('TASK_2026_201', true);
    await Promise.resolve();

    // The whole point of F-D1: no host-created worktree, no git RPC.
    expect(rpcCall).not.toHaveBeenCalled();
    expect(requestChatPrompt).toHaveBeenCalledTimes(1);
    expect(lastPromptRequest?.prompt).toContain(
      '/ptah-core:orchestrate TASK_2026_201',
    );
    expect(lastPromptRequest?.prompt).toContain(ISOLATION_HINT);
    expect(lastPromptRequest?.prompt).toContain('worktree');

    lastPromptRequest?.resolve?.({ success: true });
    await pending;

    expect(updateStatus).toHaveBeenCalledWith('TASK_2026_201', 'in_progress');
  });

  it('structural session failure: status untouched, error surfaced', async () => {
    const pending = service.start('TASK_2026_202', false);
    await Promise.resolve();

    lastPromptRequest?.resolve?.({ success: false, error: 'AUTH_REQUIRED' });
    await pending;

    expect(updateStatus).not.toHaveBeenCalled();
    expect(service.error()).toContain('Could not start orchestration');
    expect(service.error()).toContain('AUTH_REQUIRED');
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
