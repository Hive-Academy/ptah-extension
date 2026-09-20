import { Injectable, inject, signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import { TaskPromptContextService } from './task-prompt-context.service';
import type { TaskAgentTarget } from '../types/task-agent.types';

/**
 * The slash command Start submits — UN-NAMESPACED, and it has to stay that way.
 *
 * This was `/ptah-core:orchestrate` and every Start click answered "Unknown
 * command" for zero tokens (TASK_2026_252). The harness reconciler copies
 * skills into `.claude/skills/` and commands into `.claude/commands/`
 * precisely so the SDK sees them un-namespaced — plugins are not passed via the
 * SDK query option, so a `plugin:command` form resolves to nothing. See
 * `CommandDiscoveryService`'s header in `@ptah-extension/workspace-intelligence`.
 */
const ORCHESTRATE_COMMAND = '/orchestrate';

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
 * What it does: build the orchestrate prompt (the agent-managed worktree-
 * isolation directive when `isolate` is chosen, then a deterministic
 * launch-time context block from {@link TaskPromptContextService}), publish it
 * on the `AppStateManager` `ChatPromptRequest` signal bridge, and surface a
 * launch error when the bridge reports one. The chat consumer PREFILLS a
 * composer tab with the prompt — the user reviews and presses send; nothing
 * is sent from here. All frontend; only `AppStateManager` is touched —
 * **no `chat` import**, NFR-11.
 *
 * **The AGENT owns the status transition.** This service never writes task
 * status: the agent that receives the prompt moves the task to `in_progress`
 * as part of the run it starts. Do not restore an `updateStatus` call on
 * launch as a "missing feature" — the board deliberately stopped owning task
 * status (TASK_2026_471, Batch C).
 */
@Injectable({ providedIn: 'root' })
export class TaskStartService {
  private readonly appState = inject(AppStateManager);
  private readonly promptContext = inject(TaskPromptContextService);

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
  public async start(
    taskId: string,
    isolate: boolean,
    targetAgent?: TaskAgentTarget,
  ): Promise<void> {
    if (this._busyTaskId()) return;
    this._error.set(null);
    this._busyTaskId.set(taskId);
    try {
      const launch = await this.launchPrompt(taskId, isolate, targetAgent);
      if (!launch.success) {
        this._error.set(
          `Could not start orchestration for ${taskId}: ${launch.error ?? 'unknown error'}`,
        );
      }
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
   * Fire the `ChatPromptRequest` bridge and await the chat consumer's resolve
   * — no timer. The consumer (`TaskPromptBridgeService`) settles `resolve`
   * from its `finally` on both the prefill path and a caught tab-creation
   * throw, so a structural failure reaches the error banner and success never
   * stalls the launch.
   */
  private async launchPrompt(
    taskId: string,
    isolate: boolean,
    targetAgent?: TaskAgentTarget,
  ): Promise<{ success: boolean; error?: string }> {
    const prompt = await this.buildPrompt(taskId, isolate, targetAgent);
    return new Promise((resolve) => {
      this.appState.requestChatPrompt({
        prompt,
        sessionName: taskId,
        resolve: (result) => resolve(result),
      });
    });
  }

  /**
   * Prompt body + optional isolation directive + launch-time context block,
   * in that order: the context block is always the LAST thing in the prompt.
   */
  private async buildPrompt(
    taskId: string,
    isolate: boolean,
    targetAgent?: TaskAgentTarget,
  ): Promise<string> {
    const body = this.buildPromptBody(taskId, targetAgent);
    const withIsolation = isolate ? `${body}${ISOLATION_DIRECTIVE}` : body;
    const contextBlock = await this.promptContext.buildContextBlock(taskId);
    return contextBlock ? `${withIsolation}${contextBlock}` : withIsolation;
  }

  private buildPromptBody(
    taskId: string,
    targetAgent?: TaskAgentTarget,
  ): string {
    if (targetAgent?.category === 'specialist' && targetAgent.role) {
      return (
        `${ORCHESTRATE_COMMAND} ${taskId} --agent ${targetAgent.role}\n\n` +
        `Execute phase for task ${taskId} using role @${targetAgent.role}. ` +
        `Refer to .ptah/specs/${taskId}/ for requirements and context.`
      );
    }

    if (targetAgent?.category === 'lane' && targetAgent.cli) {
      return (
        `${ORCHESTRATE_COMMAND} ${taskId} --lane ${targetAgent.cli}\n\n` +
        `Assign task ${taskId} execution to background CLI lane ${targetAgent.cli} ` +
        `per agent-lanes guidelines. Deliverables belong in .ptah/specs/${taskId}/.`
      );
    }

    return `${ORCHESTRATE_COMMAND} ${taskId}`;
  }
}
