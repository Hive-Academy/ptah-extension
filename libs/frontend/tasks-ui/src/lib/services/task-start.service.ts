import { Injectable, inject, signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import { TasksStore } from './tasks-store.service';

/** Guard for the `ChatPromptRequest.resolve` bridge (§8.3): treat as failure. */
const RESOLVE_GUARD_TIMEOUT_MS = 30_000;

/**
 * Self-contained natural-language directive appended to the orchestrate prompt
 * when the user asks for isolated implementation. Rather than the host creating
 * a worktree up front (which the session can't be authorized into), the AGENT
 * isolates its own file-editing work in a worktree: the SDK's `WorktreeCreate`
 * hook creates `.claude-worktrees/<name>` INSIDE the authorized workspace root
 * when a subagent runs isolated, so no cwd/authorization plumbing is needed.
 */
const ISOLATION_DIRECTIVE =
  '\n\nIsolate all implementation for this task in a dedicated git worktree — ' +
  'delegate file-editing work to worktree-isolated subagents so changes stay ' +
  'off the main working tree until reviewed.';

/**
 * TaskStartService — orchestration launch flow for a board task (R6).
 *
 * Sequence (all frontend; only `AppStateManager` + `TasksStore` are touched —
 * **no `chat` import**, NFR-11):
 *   1. Build the prompt `/ptah-core:orchestrate <TASK_ID>`, appending an
 *      agent-managed worktree-isolation directive when `isolate` is chosen (the
 *      agent isolates its own work; the host never creates a worktree — F-D1).
 *   2. `appState.requestChatPrompt(...)` behind a 30s resolve guard.
 *   3. on resolved success ONLY → `TasksStore.updateStatus(taskId, 'in_progress')`.
 *
 * Failure posture (§8.3): a structural session failure / guard timeout leaves
 * the status untouched (no phantom transition). `updateStatus` fail post-start →
 * `TasksStore.error` surfaces; the session keeps running (no phantom rollback).
 */
@Injectable({ providedIn: 'root' })
export class TaskStartService {
  private readonly appState = inject(AppStateManager);
  private readonly store = inject(TasksStore);

  private readonly _busyTaskId = signal<string | null>(null);
  private readonly _error = signal<string | null>(null);

  /** The task currently launching (null when idle) — drives per-card busy UI. */
  public readonly busyTaskId = this._busyTaskId.asReadonly();
  /** Last launch error (session start), or null. */
  public readonly error = this._error.asReadonly();

  /** Dismiss the transient launch-error banner. */
  public clearError(): void {
    this._error.set(null);
  }

  /**
   * Launch orchestration for `taskId`. When `isolate` is true, an
   * agent-managed worktree-isolation directive is appended to the prompt so the
   * agent keeps its implementation off the main working tree — the host does
   * NOT create a worktree. Guarded so a second click while a launch is in
   * flight is a no-op.
   */
  public async start(taskId: string, isolate: boolean): Promise<void> {
    if (this._busyTaskId()) return;
    this._error.set(null);
    this._busyTaskId.set(taskId);
    try {
      const launch = await this.launchPrompt(taskId, isolate);
      if (!launch.success) {
        this._error.set(
          `Could not start orchestration for ${taskId}: ${launch.error ?? 'unknown error'}`,
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
    isolate: boolean,
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

      const prompt = isolate
        ? `/ptah-core:orchestrate ${taskId}${ISOLATION_DIRECTIVE}`
        : `/ptah-core:orchestrate ${taskId}`;

      this.appState.requestChatPrompt({
        prompt,
        sessionName: taskId,
        resolve: (result) => settle(result),
      });
    });
  }
}
