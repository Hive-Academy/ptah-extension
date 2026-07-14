import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import type { GitWorktreeChangedNotification } from '@ptah-extension/shared';
import { TasksStore } from './tasks-store.service';

/** Raw webview push emitted by the backend git handler on worktree add/remove. */
const GIT_WORKTREE_CHANGED_MESSAGE_TYPE = 'git:worktreeChanged';

/** Guard for the `ChatPromptRequest.resolve` bridge (§8.3): treat as failure. */
const RESOLVE_GUARD_TIMEOUT_MS = 30_000;

/** Correlated `git:worktreeChanged` await ceiling — slow `git worktree add`. */
const WORKTREE_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingWorktreeOp {
  resolve: (result: {
    success: boolean;
    error?: string;
    path?: string;
  }) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * TaskStartService — orchestration launch flow for a board task (R6).
 *
 * Sequence (all frontend; only `ClaudeRpcService` + `AppStateManager` +
 * `TasksStore` are touched — **no `chat` import**, NFR-11):
 *   1. (optional) `git:addWorktree` on branch `task/<TASK_ID>`, awaiting the
 *      correlated `git:worktreeChanged` push (WorktreeService semantics).
 *   2. `appState.requestChatPrompt('/ptah-core:orchestrate <TASK_ID>', cwd?)`
 *      behind a 30s resolve guard.
 *   3. on resolved success ONLY → `TasksStore.updateStatus(taskId, 'in_progress')`.
 *
 * Failure posture (§8.3): worktree fail → stop, surface error, no session, no
 * status change. Session fail / guard timeout → status untouched, worktree (if
 * created) left in place with a notice. `updateStatus` fail post-start →
 * `TasksStore.error` surfaces; the session keeps running (no phantom rollback).
 */
@Injectable({ providedIn: 'root' })
export class TaskStartService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly appState = inject(AppStateManager);
  private readonly store = inject(TasksStore);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _busyTaskId = signal<string | null>(null);
  private readonly _error = signal<string | null>(null);

  /** The task currently launching (null when idle) — drives per-card busy UI. */
  public readonly busyTaskId = this._busyTaskId.asReadonly();
  /** Last launch error (worktree / session), or null. */
  public readonly error = this._error.asReadonly();

  private readonly pendingWorktreeOps = new Map<string, PendingWorktreeOp>();

  public constructor() {
    this.setupWorktreeListener();
  }

  /** Dismiss the transient launch-error banner. */
  public clearError(): void {
    this._error.set(null);
  }

  /**
   * Launch orchestration for `taskId`. When `useWorktree` is true, an isolated
   * git worktree is created first and its path is passed as the session `cwd`.
   * Guarded so a second click while a launch is in flight is a no-op.
   */
  public async start(taskId: string, useWorktree: boolean): Promise<void> {
    if (this._busyTaskId()) return;
    this._error.set(null);
    this._busyTaskId.set(taskId);
    try {
      let cwd: string | undefined;
      if (useWorktree) {
        const worktree = await this.addWorktree(taskId);
        if (!worktree.success) {
          this._error.set(
            `Worktree for ${taskId} failed: ${worktree.error ?? 'unknown error'}`,
          );
          return; // no session, no status change (§8.3)
        }
        cwd = worktree.path;
      }

      const launch = await this.launchPrompt(taskId, cwd);
      if (!launch.success) {
        const worktreeNote = useWorktree
          ? ' (worktree left in place — remove it from the editor if unused)'
          : '';
        this._error.set(
          `Could not start orchestration for ${taskId}: ${launch.error ?? 'unknown error'}${worktreeNote}`,
        );
        return; // status untouched (§8.3)
      }

      // Success ONLY here — TasksStore surfaces its own error if this fails,
      // and the running session is intentionally left alone (§8.3).
      await this.store.updateStatus(taskId, 'in_progress');
    } catch (error: unknown) {
      // Defense-in-depth: the awaited calls above are all verified to resolve
      // (never reject) today, so this is dormant — but a future change that
      // makes any of them throw would otherwise surface only as a silent
      // unhandled rejection (the call site uses `void`). Narrow and surface it.
      this._error.set(
        `Could not start orchestration for ${taskId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this._busyTaskId.set(null);
    }
  }

  /**
   * Fire the `ChatPromptRequest` bridge and await the chat consumer's resolve,
   * behind a 30s guard that maps a missing resolve to a failure (no transition).
   */
  private launchPrompt(
    taskId: string,
    cwd?: string,
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: { success: boolean; error?: string }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(
        () =>
          settle({
            success: false,
            error: 'Timed out waiting for the session to start',
          }),
        RESOLVE_GUARD_TIMEOUT_MS,
      );

      this.appState.requestChatPrompt({
        prompt: `/ptah-core:orchestrate ${taskId}`,
        sessionName: taskId,
        ...(cwd ? { cwd } : {}),
        resolve: (result) => settle(result),
      });
    });
  }

  /**
   * Add a git worktree for the task, awaiting the correlated
   * `git:worktreeChanged` push — mirrors `WorktreeService.addWorktree`'s
   * async-pending contract so a slow subprocess never times the RPC out.
   */
  private async addWorktree(
    taskId: string,
  ): Promise<{ success: boolean; error?: string; path?: string }> {
    const operationId = this.generateOperationId();
    const pending = this.registerPendingWorktreeOp(operationId);

    const ack = await this.rpc.call('git:addWorktree', {
      branch: `task/${taskId}`,
      createBranch: true,
      operationId,
    });

    if (!ack.isSuccess() || !ack.data) {
      this.cancelPendingWorktreeOp(operationId);
      return { success: false, error: ack.error ?? 'Failed to add worktree' };
    }

    if (!ack.data.pending) {
      this.cancelPendingWorktreeOp(operationId);
      if (ack.data.success && ack.data.worktreePath) {
        return { success: true, path: ack.data.worktreePath };
      }
      return {
        success: false,
        error: ack.data.error ?? 'Failed to add worktree',
      };
    }

    return pending;
  }

  private registerPendingWorktreeOp(
    operationId: string,
  ): Promise<{ success: boolean; error?: string; path?: string }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingWorktreeOps.delete(operationId)) {
          resolve({
            success: false,
            error: 'Timed out waiting for the worktree to be created',
          });
        }
      }, WORKTREE_TIMEOUT_MS);
      this.pendingWorktreeOps.set(operationId, { resolve, timer });
    });
  }

  private cancelPendingWorktreeOp(operationId: string): void {
    const pending = this.pendingWorktreeOps.get(operationId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingWorktreeOps.delete(operationId);
  }

  private generateOperationId(): string {
    const cryptoRef = globalThis.crypto as Crypto | undefined;
    if (cryptoRef?.randomUUID) {
      return cryptoRef.randomUUID();
    }
    return `task-wt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private setupWorktreeListener(): void {
    const handler = (event: MessageEvent): void => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type !== GIT_WORKTREE_CHANGED_MESSAGE_TYPE) return;

      const payload = data.payload as
        | GitWorktreeChangedNotification
        | undefined;
      if (!payload?.operationId) return;

      const pending = this.pendingWorktreeOps.get(payload.operationId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingWorktreeOps.delete(payload.operationId);
      pending.resolve({
        success: payload.success !== false,
        error: payload.error,
        path: payload.path,
      });
    };

    window.addEventListener('message', handler);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('message', handler);
      for (const pending of this.pendingWorktreeOps.values()) {
        clearTimeout(pending.timer);
      }
      this.pendingWorktreeOps.clear();
    });
  }
}
