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
import type {
  SessionChildCompletionDelivery,
  SessionChildCompletionEnvelope,
  SessionChildCompletionRefusalReason,
  SessionChildCompletionSubject,
  SessionChildSettle,
} from '../session-children/session-spawner.port';

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

/** What the deliverable check needs, for a lane and a session child alike. */
interface DeliverableTarget {
  readonly deliverables: readonly string[];
  readonly taskFolder?: string;
  readonly workingDirectory: string;
  /** Agent or child id, for the log line only. */
  readonly id: string;
}

/** One rendered deliverable line: `- {path} — MISSING | EMPTY | N bytes [(NOT written by this run)]`. */
function deliverableLine(check: LaneDeliverableCheck): string {
  const state = !check.exists
    ? 'MISSING'
    : (check.bytes ?? 0) === 0
      ? 'EMPTY'
      : `${check.bytes} bytes` +
        (check.writtenAfterSpawn === false ? ' (NOT written by this run)' : '');
  return `- ${check.path} — ${state}`;
}

/**
 * The verdict for a session child's settled turn.
 *
 * The lane semantics, plus one stricter rule (TASK_2026_584, Revision 1 fix
 * 3): a deliverable whose mtime is earlier than the child's `startedAt`
 * (`writtenAfterSpawn === false`) counts as NOT delivered. A child works in a
 * fresh worktree, so every tracked file already "exists" there with a
 * checkout-time mtime; existence alone must not read as the child's work. An
 * absent flag (mtime unreadable) keeps the lane rule: existence + non-empty.
 */
export function sessionChildVerdictOf(
  status: SessionChildSettle['status'],
  deliverables: readonly LaneDeliverableCheck[],
): LaneCompletionVerdict {
  if (status !== 'completed') return 'failed';
  if (deliverables.length === 0) return 'unverified';
  const allWritten = deliverables.every(
    (check) =>
      check.exists &&
      (check.bytes ?? 0) > 0 &&
      check.writtenAfterSpawn !== false,
  );
  return allWritten ? 'delivered' : 'no-deliverable';
}

function sessionChildNextAction(verdict: LaneCompletionVerdict): string {
  const keepOpen =
    'The child stays open in its tab and holds a slot until ' +
    'ptah_session_stop; the user owns merge, PR and worktree cleanup.';
  switch (verdict) {
    case 'delivered':
      return (
        'Next: read the deliverable files in the worktree and verify the work ' +
        'yourself; a file being written is not proof the content is right. ' +
        'Steer the child with ptah_session_send or inspect it with ' +
        `ptah_session_read. ${keepOpen}`
      );
    case 'no-deliverable':
      return (
        'Next: the child went idle without writing every deliverable it was ' +
        'given, so treat the task as NOT done. Inspect it with ' +
        'ptah_session_read, then steer it with ptah_session_send naming the ' +
        `missing paths. ${keepOpen}`
      );
    case 'failed':
      return (
        'Next: the turn did not finish. Inspect the child with ' +
        'ptah_session_read, then steer it with ptah_session_send or stop it ' +
        `with ptah_session_stop. ${keepOpen}`
      );
    case 'unverified':
    default:
      return (
        'Next: no deliverables were declared, so nothing was checked. Inspect ' +
        'the child with ptah_session_read and check its claims against the ' +
        'files and the project tests; steer it with ptah_session_send. ' +
        keepOpen
      );
  }
}

/**
 * The completion envelope for one settled turn of a session child. Pure: the
 * deliverable checks are passed in, so a held completion is rendered exactly
 * as it would have been delivered.
 */
export function buildSessionChildCompletionEnvelope(
  subject: SessionChildCompletionSubject,
  settle: SessionChildSettle,
  deliverables: readonly LaneDeliverableCheck[],
): SessionChildCompletionEnvelope {
  const verdict = sessionChildVerdictOf(settle.status, deliverables);
  const startedMs = Date.parse(subject.startedAt);
  const completedMs = Date.parse(settle.completedAt);
  const durationMs =
    Number.isFinite(startedMs) && Number.isFinite(completedMs)
      ? Math.max(completedMs - startedMs, 0)
      : 0;

  const attrs = [
    `agent-id="${escapeAttribute(subject.childSessionId)}"`,
    `agent="${escapeAttribute(subject.label)}"`,
    'cli="ptah-session"',
    `status="${escapeAttribute(settle.status)}"`,
    `verdict="${escapeAttribute(verdict)}"`,
    `turn="${settle.turn}"`,
  ].join(' ');

  const lines: string[] = [
    `Child session ${subject.label} settled: ${settle.status} after ` +
      `${formatDuration(durationMs)} (settled turn ${settle.turn}).`,
    `Task: ${headline(subject.task) || '(no task headline)'}`,
    `Branch: ${subject.branch}`,
    `Worktree: ${subject.worktreePath}`,
  ];
  if (subject.taskFolder) lines.push(`Task folder: ${subject.taskFolder}`);
  if (deliverables.length === 0) {
    lines.push('Deliverables: none were declared, so nothing was checked.');
  } else {
    lines.push('Deliverables:');
    lines.push(...deliverables.map(deliverableLine));
  }
  lines.push(`Reports sent by this child so far: ${subject.reportsDelivered}.`);
  const recap = subject.lastRecap?.trim();
  if (recap) lines.push(`Last message: ${recap}`);
  lines.push(sessionChildNextAction(verdict));

  return {
    childSessionId: subject.childSessionId,
    turn: settle.turn,
    verdict,
    text: `<agent-lane-completed ${attrs}>\n${lines.join(
      '\n',
    )}\n</agent-lane-completed>`,
  };
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

  /**
   * Push the completion of one settled turn of a session child
   * (`ptah_session_start`, TASK_2026_584) into its parent.
   *
   * One signal per `{childSessionId}:turn:{n}` — the spawner may observe the
   * same settle twice (turn-ended and session-end paths) and the second call
   * is `already-signalled`. Deliverables are checked against the child's
   * `startedAt`, which is fixed for the child's life: a file written in an
   * earlier turn is still this run's work.
   *
   * When no parent id is live the refusal carries the BUILT envelope, so the
   * spawner can hold it and hand it to the parent's next `ptah_session_*`
   * call. Nothing here queues or retries.
   */
  async signalSessionChild(
    subject: SessionChildCompletionSubject,
    settle: SessionChildSettle,
  ): Promise<SessionChildCompletionDelivery> {
    const key = `${subject.childSessionId}:turn:${settle.turn}`;
    if (this.signalledKeys.includes(key)) {
      return { delivered: false, reason: 'already-signalled' };
    }
    this.remember(key);

    const startedMs = Date.parse(subject.startedAt);
    const measured = await this.checkDeliverables(
      {
        deliverables: subject.deliverables,
        taskFolder: subject.taskFolder,
        workingDirectory: subject.worktreePath,
        id: subject.childSessionId,
      },
      startedMs,
    );
    // Without a reference time nothing can prove a deliverable is this
    // child's work, and in a fresh worktree every tracked file already
    // exists. Fail closed: every deliverable counts as NOT written by this run
    // (verdict `no-deliverable`), never as delivered. Session subjects only —
    // the lane path keeps omitting the flag.
    let checks = measured;
    if (!Number.isFinite(startedMs)) {
      this.logger.warn(
        '[LaneCompletionNotifier] Session child startedAt is not a date; ' +
          'treating every deliverable as not written by this run',
        {
          childSessionId: subject.childSessionId,
          startedAt: subject.startedAt,
        },
      );
      checks = measured.map((check) => ({
        ...check,
        writtenAfterSpawn: false,
      }));
    }
    const envelope = buildSessionChildCompletionEnvelope(
      subject,
      settle,
      checks,
    );

    const candidates = subject.parentSessionIds
      .map((id) => SessionId.safeParse(id?.trim()))
      .filter((id): id is SessionId => !!id);
    if (candidates.length === 0) {
      return this.refuseSessionChild('no-parent-recorded', envelope, {
        detail: 'the child records no parent session id',
      });
    }

    if (!this.agentAdapter) {
      return this.refuseSessionChild('chat-runtime-unavailable', envelope, {
        detail:
          'no agent adapter is registered in this host, so no chat session ' +
          'can be driven',
      });
    }

    const adapter = this.agentAdapter;
    const parentSessionId = candidates.find((id) =>
      adapter.isSessionActive(id),
    );
    if (!parentSessionId) {
      return this.refuseSessionChild('parent-session-not-active', envelope, {
        parentSessionIds: candidates,
      });
    }

    try {
      await adapter.sendMessageToSession(parentSessionId, envelope.text, {
        origin: {
          kind: 'peer',
          from: `ptah-session:${subject.childSessionId}`,
          name: `session · ${subject.label}`,
        },
      });
    } catch (error: unknown) {
      return this.refuseSessionChild('delivery-failed', envelope, {
        parentSessionId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    this.logger.info(
      '[LaneCompletionNotifier] Session child completion delivered',
      {
        childSessionId: subject.childSessionId,
        parentSessionId,
        turn: settle.turn,
        status: settle.status,
        verdict: envelope.verdict,
        deliverables: checks.length,
      },
    );

    return { delivered: true, parentSessionId, envelope };
  }

  private refuseSessionChild(
    reason: SessionChildCompletionRefusalReason,
    envelope: SessionChildCompletionEnvelope,
    context: Record<string, unknown> & { detail?: string } = {},
  ): SessionChildCompletionDelivery {
    this.logger.warn(
      '[LaneCompletionNotifier] Session child completion not delivered',
      {
        reason,
        childSessionId: envelope.childSessionId,
        turn: envelope.turn,
        verdict: envelope.verdict,
        ...context,
      },
    );
    return {
      delivered: false,
      reason,
      ...(context.detail ? { detail: context.detail } : {}),
      envelope,
    };
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

    const deliverables = await this.checkDeliverables(
      {
        deliverables: info.deliverables ?? [],
        taskFolder: info.taskFolder,
        workingDirectory: info.workingDirectory,
        id: info.agentId,
      },
      startedMs,
    );

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
    target: DeliverableTarget,
    startedMs: number,
  ): Promise<readonly LaneDeliverableCheck[]> {
    const checks: LaneDeliverableCheck[] = [];
    for (const entry of target.deliverables) {
      checks.push(await this.checkOne(target, entry, startedMs));
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
    target: DeliverableTarget,
    entry: string,
    startedMs: number,
  ): Promise<LaneDeliverableCheck> {
    const path = this.resolveDeliverablePath(target, entry);
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
          agentId: target.id,
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
  private resolveDeliverablePath(
    target: DeliverableTarget,
    entry: string,
  ): string {
    // `resolve` even for an already-absolute entry: the path is reported to the
    // orchestrator, and one canonical spelling beats echoing whatever mix of
    // separators the caller typed.
    if (isAbsolute(entry)) return resolve(entry);
    const base = target.taskFolder
      ? isAbsolute(target.taskFolder)
        ? target.taskFolder
        : resolve(target.workingDirectory, target.taskFolder)
      : target.workingDirectory;
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
      lines.push(...signal.deliverables.map(deliverableLine));
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
