/**
 * Typed wrappers over the harness's interact JSON-RPC channel.
 *
 * The interact loop only registers FOUR inbound JSON-RPC handlers (verified
 * `apps/ptah-cli/src/cli/commands/interact.ts:504-643`):
 *
 *   - `task.submit`
 *   - `task.cancel`
 *   - `session.shutdown`
 *   - `session.history`
 *
 * Plus, when the embedded proxy is running:
 *
 *   - `proxy.shutdown`
 *
 * The other clusters from commit `0a810737` (`config:*`, `auth:*`,
 * `license:*`, `settings:*`) are NOT reachable on the interact stdio
 * inbound channel — they are dispatched through the in-process
 * `cli-message-transport` and only surface to external callers via
 * `ptah <subcommand>` spawns. Tests that need to exercise them call
 * `CliRunner.spawnOneshot()` instead of going through this client.
 */

import type { RunnerHandle } from './cli-runner.js';

// Mirror the wire shapes from `src/cli/commands/interact.ts` and
// `src/cli/session/chat-bridge.ts`. We don't import the source types directly
// because the harness drives the BUILT bundle (no source coupling).

export interface TaskSubmitParams {
  task: string;
  cwd?: string;
  profile?: string;
  workspacePath?: string;
}

export interface TaskSubmitResult {
  turn_id: string;
  complete: boolean;
  cancelled?: boolean;
  error?: string;
  session_id?: string;
}

export interface TaskCompleteParams {
  command: string;
  duration_ms: number;
  summary?: { session_id?: string; turn_id?: string; text?: string };
}

export interface TaskErrorParams {
  command: string;
  ptah_code: string;
  message: string;
  recoverable?: boolean;
  code?: number;
  details?: Record<string, unknown>;
}

export interface ProxyShutdownResult {
  stopped: boolean;
  port?: number;
  reason?: string;
}

export class InteractRpcClient {
  constructor(private readonly h: RunnerHandle) {}

  submitTask(
    params: TaskSubmitParams,
    timeoutMs = 30_000,
  ): Promise<TaskSubmitResult> {
    return this.h.request<TaskSubmitResult>('task.submit', params, timeoutMs);
  }

  cancelTask(
    turn_id: string,
  ): Promise<{ cancelled: boolean; reason?: string }> {
    return this.h.request('task.cancel', { turn_id });
  }

  sessionHistory(limit?: number): Promise<{
    messages: unknown[];
    session_id: string;
  }> {
    return this.h.request(
      'session.history',
      limit !== undefined ? { limit } : {},
    );
  }

  proxyShutdown(): Promise<ProxyShutdownResult> {
    return this.h.request<ProxyShutdownResult>('proxy.shutdown', {});
  }

  awaitTaskComplete(timeoutMs = 30_000): Promise<TaskCompleteParams> {
    return this.h.awaitNotification<TaskCompleteParams>(
      'task.complete',
      timeoutMs,
    );
  }

  awaitTaskError(timeoutMs = 30_000): Promise<TaskErrorParams> {
    return this.h.awaitNotification<TaskErrorParams>('task.error', timeoutMs);
  }

  /**
   * Race `task.complete` vs `task.error` — useful for specs which prove
   * chat-bridge emits a terminal envelope on every settle path.
   */
  awaitTaskTerminal(
    timeoutMs = 30_000,
  ): Promise<
    | { kind: 'complete'; params: TaskCompleteParams }
    | { kind: 'error'; params: TaskErrorParams }
  > {
    return Promise.race<
      | { kind: 'complete'; params: TaskCompleteParams }
      | { kind: 'error'; params: TaskErrorParams }
    >([
      this.awaitTaskComplete(timeoutMs).then((params) => ({
        kind: 'complete' as const,
        params,
      })),
      this.awaitTaskError(timeoutMs).then((params) => ({
        kind: 'error' as const,
        params,
      })),
    ]);
  }
}
