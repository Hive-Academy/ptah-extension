/**
 * Lane → orchestrator completion signal (TASK_2026_515).
 *
 * A lane spawned with `ptah_agent_spawn` used to end in silence. The
 * orchestrator had two options, both bad: poll `ptah_agent_status` in a loop,
 * or wait with no information. This service closes that gap — when a lane
 * reaches a terminal status, it pushes ONE turn into the session that spawned
 * the lane.
 *
 * Three properties hold the design together:
 *
 *  - **It is the same transport `ptah_agent_report` already uses.**
 *    `IAgentAdapter.sendMessageToSession` drives a chat session from a backend
 *    lib and is registered in every host that registers `agent-sdk`, so the
 *    signal fires in VS Code, Electron and the headless CLI alike. There is no
 *    new port, no new RPC namespace and no dependence on an open webview — the
 *    `background_agent_completed` stream event was rejected for exactly that
 *    reason (see `implementation-notes.md`).
 *  - **It reports the WORK, not the exit.** Exit code 0 with no deliverable
 *    written is the failure this task was filed for, so every signal carries a
 *    {@link LaneCompletionVerdict} derived from the declared deliverables as
 *    observed on disk. A lane that exits clean without writing its file
 *    produces `no-deliverable`, not a success.
 *  - **It never claims a delivery it did not make.** Every branch either
 *    performed a `sendMessageToSession` or returns `delivered: false` with a
 *    reason. A refusal leaves the poll-based read path (§4 of the
 *    `agent-lanes` skill) as the fallback, which is why that path stays
 *    documented rather than being replaced.
 *
 * Deliberately NOT rate-limited and NOT deduplicated by body: one signal per
 * terminal transition is already the ceiling, and {@link signalledKeys} pins
 * it. The per-agent burst limits in `AgentReportRouter` exist because a model
 * chooses when to call that tool; nothing chooses when a process exits.
 */
import { isAbsolute, resolve } from 'path';
import { inject, injectable } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import { SessionId } from '@ptah-extension/shared';
import type {
  AgentProcessInfo,
  IAgentAdapter,
  LaneCompletionDelivery,
  LaneCompletionRefusalReason,
  LaneCompletionSignal,
  LaneCompletionVerdict,
  LaneDeliverableCheck,
} from '@ptah-extension/shared';

/** Characters of the task echoed into the signal for recognition. */
const TASK_HEADLINE_LENGTH = 120;

/**
 * How many terminal transitions are remembered, so a long-lived host cannot
 * grow {@link LaneCompletionNotifier.signalledKeys} without limit. One entry
 * per lane turn; a host that ran more lanes than this has long since lost
 * interest in the oldest.
 */
const SIGNALLED_HISTORY_SIZE = 256;

/** XML attribute values are model-facing text; a stray quote must not reshape the envelope. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The label a person recognizes this lane by, without naming a vendor in code. */
function laneLabel(info: AgentProcessInfo): string {
  return info.ptahCliName ?? info.displayName ?? info.cli;
}

function headline(task: string): string {
  const line = (task.split('\n', 1)[0] ?? '').trim();
  return line.length > TASK_HEADLINE_LENGTH
    ? `${line.slice(0, TASK_HEADLINE_LENGTH)}…`
    : line;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export interface LaneCompletionContext {
  /** Reports this lane delivered through `ptah_agent_report` before it ended. */
  readonly reportsDelivered: number;
}

@injectable()
export class LaneCompletionNotifier {
  /**
   * Terminal transitions already signalled, keyed by
   * `${agentId}:${completedAt}`.
   *
   * The timestamp is part of the key on purpose. A continuation-capable lane
   * goes back to `running` and ends again, and that SECOND ending is a real
   * new event the orchestrator must hear about — keying on the agent id alone
   * would swallow it. Within one ending, every terminal path stamps the same
   * `completedAt`, so the timeout path and the exit path that follows it
   * collapse to one signal.
   */
  private readonly signalledKeys: string[] = [];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fileSystem: IFileSystemProvider,
    /**
     * Optional because a host may register `cli-agent-runtime` without a chat
     * runtime. Absence is reported as `chat-runtime-unavailable`, never
     * silently swallowed.
     */
    @inject(TOKENS.AGENT_ADAPTER, { isOptional: true })
    private readonly agentAdapter: IAgentAdapter | null = null,
  ) {}

  /**
   * Build and deliver the completion signal for a lane that has just reached a
   * terminal status.
   *
   * Safe to call from every terminal path — the duplicate guard is inside.
   * `info` must already carry its terminal `status` and `completedAt`.
   */
  async signal(
    info: AgentProcessInfo,
    context: LaneCompletionContext = { reportsDelivered: 0 },
  ): Promise<LaneCompletionDelivery> {
    if (info.status === 'running') {
      // Not a modelled refusal: a caller that reaches here has a bug, and the
      // orchestrator must never be told a running lane finished.
      this.logger.warn(
        '[LaneCompletionNotifier] Ignored a signal for a running lane',
        { agentId: info.agentId, cli: info.cli },
      );
      return { delivered: false, reason: 'already-signalled' };
    }

    const completedAt = info.completedAt ?? new Date().toISOString();
    const key = `${info.agentId}:${completedAt}`;
    if (this.signalledKeys.includes(key)) {
      return { delivered: false, reason: 'already-signalled' };
    }
    this.remember(key);

    const signal = await this.buildSignal(info, completedAt, context);

    // `safeParse`, not `from`: `parentSessionId` holds the frontend tab id
    // until the real SDK uuid arrives, so a value that is not a session id
    // means the parent never resolved one. That is a modelled state, not an
    // exception — the same rule `AgentReportRouter` follows.
    const parentSessionId = SessionId.safeParse(info.parentSessionId?.trim());
    if (!parentSessionId) {
      return this.refuse('no-parent-recorded', signal, {
        detail: info.parentSessionId
          ? 'the parent session recorded at spawn never resolved to a real session id'
          : 'the lane was spawned without a parent session',
      });
    }

    if (!this.agentAdapter) {
      return this.refuse('chat-runtime-unavailable', signal, {
        detail:
          'no agent adapter is registered in this host, so no chat session ' +
          'can be driven',
      });
    }

    if (!this.agentAdapter.isSessionActive(parentSessionId)) {
      return this.refuse('parent-session-not-active', signal, {
        parentSessionId,
      });
    }

    try {
      await this.agentAdapter.sendMessageToSession(
        parentSessionId,
        LaneCompletionNotifier.buildEnvelope(signal),
        {
          origin: {
            kind: 'peer',
            from: `ptah-agent:${signal.agentId}`,
            name: `${signal.cli} · ${signal.agentLabel}`,
          },
        },
      );
    } catch (error: unknown) {
      return this.refuse('delivery-failed', signal, {
        parentSessionId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    this.logger.info('[LaneCompletionNotifier] Completion signal delivered', {
      agentId: signal.agentId,
      parentSessionId,
      cli: signal.cli,
      status: signal.status,
      verdict: signal.verdict,
      deliverables: signal.deliverables.length,
    });

    return { delivered: true, parentSessionId, signal };
  }

  /** The signal, with every declared deliverable checked against disk. */
  private async buildSignal(
    info: AgentProcessInfo,
    completedAt: string,
    context: LaneCompletionContext,
  ): Promise<LaneCompletionSignal> {
    const startedMs = Date.parse(info.startedAt);
    const completedMs = Date.parse(completedAt);
    const durationMs =
      Number.isFinite(startedMs) && Number.isFinite(completedMs)
        ? Math.max(completedMs - startedMs, 0)
        : 0;

    const deliverables = await this.checkDeliverables(info, startedMs);

    return {
      agentId: info.agentId,
      cli: info.cli,
      agentLabel: laneLabel(info),
      ...(info.role ? { role: info.role } : {}),
      status: info.status,
      ...(info.exitCode !== undefined ? { exitCode: info.exitCode } : {}),
      startedAt: info.startedAt,
      completedAt,
      durationMs,
      ...(info.taskFolder ? { taskFolder: info.taskFolder } : {}),
      taskHeadline: headline(info.task),
      deliverables,
      verdict: LaneCompletionNotifier.verdictOf(info.status, deliverables),
      reportsDelivered: context.reportsDelivered,
      ...(info.cliSessionId ? { cliSessionId: info.cliSessionId } : {}),
    };
  }

  private async checkDeliverables(
    info: AgentProcessInfo,
    startedMs: number,
  ): Promise<readonly LaneDeliverableCheck[]> {
    const declared = info.deliverables ?? [];
    const checks: LaneDeliverableCheck[] = [];
    for (const entry of declared) {
      checks.push(await this.checkOne(info, entry, startedMs));
    }
    return checks;
  }

  /**
   * One deliverable. A read failure is reported as `exists: false` rather than
   * thrown: the signal is worth more than its most pessimistic field, and an
   * unreadable deliverable is indistinguishable from a missing one for every
   * decision the orchestrator makes next.
   */
  private async checkOne(
    info: AgentProcessInfo,
    entry: string,
    startedMs: number,
  ): Promise<LaneDeliverableCheck> {
    const path = this.resolveDeliverablePath(info, entry);
    try {
      if (!(await this.fileSystem.exists(path))) {
        return { path, exists: false };
      }
      const stat = await this.fileSystem.stat(path);
      return {
        path,
        exists: true,
        bytes: stat.size,
        ...(Number.isFinite(startedMs)
          ? { writtenAfterSpawn: stat.mtime >= startedMs }
          : {}),
      };
    } catch (error: unknown) {
      this.logger.warn(
        '[LaneCompletionNotifier] Could not read a declared deliverable',
        {
          agentId: info.agentId,
          path,
          detail: error instanceof Error ? error.message : String(error),
        },
      );
      return { path, exists: false };
    }
  }

  /**
   * A relative deliverable is resolved against `taskFolder` when the lane was
   * given one, because that is where the spawn prompt told the lane to write.
   * Otherwise it resolves against the lane's working directory.
   */
  private resolveDeliverablePath(info: AgentProcessInfo, entry: string): string {
    // `resolve` even for an already-absolute entry: the path is reported to the
    // orchestrator, and one canonical spelling beats echoing whatever mix of
    // separators the caller typed.
    if (isAbsolute(entry)) return resolve(entry);
    const base = info.taskFolder
      ? isAbsolute(info.taskFolder)
        ? info.taskFolder
        : resolve(info.workingDirectory, info.taskFolder)
      : info.workingDirectory;
    return resolve(base, entry);
  }

  /**
   * An existing but EMPTY deliverable counts as missing. A zero-byte file is
   * what a lane leaves behind when it opened its output and then died, and
   * calling that `delivered` would reintroduce the defect in a new shape.
   */
  private static verdictOf(
    status: AgentProcessInfo['status'],
    deliverables: readonly LaneDeliverableCheck[],
  ): LaneCompletionVerdict {
    if (status !== 'completed') return 'failed';
    if (deliverables.length === 0) return 'unverified';
    const allPresent = deliverables.every(
      (check) => check.exists && (check.bytes ?? 0) > 0,
    );
    return allPresent ? 'delivered' : 'no-deliverable';
  }

  /**
   * The envelope the orchestrator's model reads. It mirrors the
   * `<agent-report>` wrapper `AgentReportRouter` builds, so a model meets ONE
   * mental model for "something arrived from a lane".
   *
   * The verdict is stated in words as well as in the attribute, and the
   * required next action is spelled out for the two verdicts where doing
   * nothing is the wrong answer.
   */
  private static buildEnvelope(signal: LaneCompletionSignal): string {
    const attrs = [
      `agent-id="${escapeAttribute(signal.agentId)}"`,
      `agent="${escapeAttribute(signal.agentLabel)}"`,
      `cli="${escapeAttribute(signal.cli)}"`,
      `status="${escapeAttribute(signal.status)}"`,
      `verdict="${escapeAttribute(signal.verdict)}"`,
    ].join(' ');

    const lines: string[] = [
      `Lane ${signal.agentLabel} finished: ${signal.status}` +
        (signal.exitCode !== undefined
          ? ` (exit code ${signal.exitCode})`
          : '') +
        ` after ${formatDuration(signal.durationMs)}.`,
      `Task: ${signal.taskHeadline || '(no task headline)'}`,
    ];
    if (signal.role) lines.push(`Role: ${signal.role}`);
    if (signal.taskFolder) lines.push(`Task folder: ${signal.taskFolder}`);

    if (signal.deliverables.length === 0) {
      lines.push(
        'Deliverables: none were declared at spawn, so nothing was checked. ' +
          'Read the lane output before you trust this result, and declare ' +
          '"deliverables" on the next spawn so the next signal can verify it.',
      );
    } else {
      lines.push('Deliverables:');
      for (const check of signal.deliverables) {
        const state = !check.exists
          ? 'MISSING'
          : (check.bytes ?? 0) === 0
            ? 'EMPTY'
            : `${check.bytes} bytes` +
              (check.writtenAfterSpawn === false
                ? ' (NOT written by this run)'
                : '');
        lines.push(`- ${check.path} — ${state}`);
      }
    }

    lines.push(
      `Reports sent by this lane before it ended: ${signal.reportsDelivered}.`,
    );
    if (signal.cliSessionId) {
      lines.push(
        `CLI Session ID: ${signal.cliSessionId} — pass it as ` +
          'resume_session_id to continue this lane instead of respawning it.',
      );
    }
    lines.push(LaneCompletionNotifier.nextAction(signal));

    return `<agent-lane-completed ${attrs}>\n${lines.join(
      '\n',
    )}\n</agent-lane-completed>`;
  }

  private static nextAction(signal: LaneCompletionSignal): string {
    switch (signal.verdict) {
      case 'delivered':
        return (
          'Next: read the deliverable files and verify the work yourself. A ' +
          'lane writing its file is not proof the content is right.'
        );
      case 'no-deliverable':
        return (
          'Next: this lane exited without writing every deliverable it was ' +
          'given, so treat the task as NOT done. Read its output with ' +
          'ptah_agent_read to see how far it got, then resume it with the ' +
          'missing paths named, or do the work another way. Do not report ' +
          'this lane as complete.'
        );
      case 'failed':
        return (
          'Next: the lane did not finish. Read its output with ' +
          'ptah_agent_read, then resume it when a CLI Session ID is present ' +
          'or respawn with a smaller task.'
        );
      case 'unverified':
      default:
        return (
          'Next: read the lane output and check its claims against the files ' +
          'and the project tests before you use them.'
        );
    }
  }

  /**
   * A refusal is logged at `warn` with its reason: on the orchestrator side an
   * undelivered signal is completely invisible, and the poll fallback is only
   * reachable by someone who knows the push did not arrive.
   */
  private refuse(
    reason: LaneCompletionRefusalReason,
    signal: LaneCompletionSignal,
    context: Record<string, unknown> = {},
  ): LaneCompletionDelivery {
    this.logger.warn(
      '[LaneCompletionNotifier] Completion signal not delivered',
      {
        reason,
        agentId: signal.agentId,
        cli: signal.cli,
        status: signal.status,
        verdict: signal.verdict,
        ...context,
      },
    );
    return { delivered: false, reason, signal };
  }

  private remember(key: string): void {
    this.signalledKeys.push(key);
    if (this.signalledKeys.length > SIGNALLED_HISTORY_SIZE) {
      this.signalledKeys.splice(
        0,
        this.signalledKeys.length - SIGNALLED_HISTORY_SIZE,
      );
    }
  }
}
