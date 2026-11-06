import { basename } from 'path';
import { LANE_DEFAULT_MODEL, laneFamilyOf, normalizeWorkspaceRoot, SessionId } from '@ptah-extension/shared';
import type {
  AgentProcessInfo,
  CliOutputSegment,
  LaneCompletionSignal,
} from '@ptah-extension/shared';
import type { LaneOutcomeRecorder } from '@ptah-extension/lane-outcomes';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  parseSessionUsageContribution,
  usdToMicroUsd,
  type SessionUsageContribution,
  type SessionUsageSink,
} from '@ptah-extension/agent-sdk';
import { classifyLaneFailureClass } from './limits/lane-failure-class';

let recorderUnavailableWarned = false;

/** Synchronous enqueue. Store I/O belongs to the recorder's later drain. */
export function enqueueLaneCompletionOutcome(
  recorderForCompletion: () => Pick<
    LaneOutcomeRecorder,
    'recordLaneCompletion'
  > | null,
  logger: Logger,
  info: AgentProcessInfo,
  runId: string,
  signal: LaneCompletionSignal,
  authMatched: boolean,
  rateLimited: boolean,
  resolvedParentSessionId: string | null,
  usage?: CliOutputSegment['usage'],
): void {
  const startedAt = Date.parse(info.startedAt);
  const endedAt = Date.parse(signal.completedAt);
  try {
    const recorder = recorderForCompletion();
    if (!recorder) {
      if (!recorderUnavailableWarned) {
        recorderUnavailableWarned = true;
        logger.warn('[LaneCompletionNotifier] Outcome recorder unavailable', { runId });
      }
      logger.debug('[LaneCompletionNotifier] Outcome not recorded', { runId });
      return;
    }
    recorder.recordLaneCompletion({
      runId,
      executorKind: info.cli === 'ptah-cli' ? 'ptah-cli' : 'cli',
      laneId: info.ptahCliId ?? info.cli,
      agentId: info.agentId,
      parentSessionId: resolvedParentSessionId,
      workspaceRoot: info.workingDirectory ? normalizeWorkspaceRoot(info.workingDirectory) : null,
      family: laneFamilyOf({
        cli: info.cli,
        ptahCliId: info.ptahCliId,
        providerId: info.providerId ?? info.quotaOwner?.providerId,
      }),
      provider: info.providerId ?? info.quotaOwner?.providerId ?? null,
      model: info.model ?? LANE_DEFAULT_MODEL,
      role: info.role ?? null,
      taskKind: info.taskKind ?? null,
      taskId: info.taskFolder ? basename(info.taskFolder) : null,
      verdict: signal.verdict,
      failureClass: classifyLaneFailureClass({
        verdict: signal.verdict,
        status: info.status,
        failureKind: info.failureKind,
        authMatched,
        rateLimited,
      }),
      startedAt: Number.isFinite(startedAt) ? startedAt : null,
      endedAt: Number.isFinite(endedAt) ? endedAt : Date.now(),
      durationMs: signal.durationMs,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      costUsd: usage?.costUsd ?? null,
      routingSource: info.routingSource ?? 'not-routed',
      reviseRounds: 0,
      finalReview: null,
      deliverablesDeclaredAt: null,
      status: info.status,
      failureKind: info.failureKind ?? null,
      exitCode: info.exitCode ?? null,
    }, { brief: info.task });
  } catch (error: unknown) {
    logger.warn('[LaneCompletionNotifier] Outcome enqueue failed', {
      runId,
      code: error instanceof Error ? error.name : 'UNKNOWN',
    });
  }
}

/**
 * Record a lane's reported turn usage with the durable session usage sink
 * (TASK_2026_870 Phase 1). Called once per terminal transition, next to
 * `enqueueLaneCompletionOutcome`, under the same `agentId:completedAt`
 * identity — a lane that continues and ends again is a new event with a new
 * key, and a repeated call for the same ending converges to the same rows.
 *
 * The usage a lane reports here is its LAST turn's own total — only adapters
 * that guarantee that set `outcomeUsageIsTurnTotal`, so one completion
 * records one turn. Lanes whose adapter carries no usage (Cursor, ACP/Grok)
 * record nothing: an absent figure is never fabricated, and `modelId` stays
 * what the lane actually reported rather than a display fallback.
 *
 * Best effort by contract: the sink never throws and owns the logging of
 * every real write failure, so this backstop only guarantees the completion
 * path survives a misbehaving adapter.
 */
export function recordLaneUsageOutcome(
  sink: SessionUsageSink | null | undefined,
  logger: Logger,
  info: AgentProcessInfo,
  completedAt: string,
  usage: CliOutputSegment['usage'],
): void {
  if (!sink || !usage) return;
  const runId = String(info.agentId);
  try {
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const cacheReadTokens = usage.cacheReadTokens ?? 0;
    const cacheCreationTokens = usage.cacheWriteTokens ?? 0;
    const knownCostMicroUsd =
      usage.costUsd === undefined ? null : usdToMicroUsd(usage.costUsd);
    if (
      inputTokens === 0 &&
      outputTokens === 0 &&
      cacheReadTokens === 0 &&
      cacheCreationTokens === 0 &&
      (knownCostMicroUsd ?? 0) === 0
    ) {
      return;
    }
    const costAuthority =
      knownCostMicroUsd === null ? 'unpriced' : 'provider-reported';
    // `parentSessionId` holds the frontend tab id until the real SDK uuid
    // arrives, so a value that does not parse means the parent never
    // resolved one — the same rule the notifier's signal path follows.
    const parentSessionId = SessionId.safeParse(info.parentSessionId?.trim());
    const built: SessionUsageContribution = {
      // The lane's own durable identity: its native session id when the CLI
      // reported one, else the lane id.
      sessionId: info.cliSessionId ?? runId,
      producer: 'cli-lane',
      runId,
      turnId: info.turnSeq === undefined ? null : String(info.turnSeq),
      eventKey: `${runId}:${completedAt}`,
      parentSessionId: parentSessionId ?? null,
      subagentId: null,
      providerId: info.providerId ?? info.quotaOwner?.providerId ?? null,
      occurredAtMs: Date.parse(completedAt) || Date.now(),
      revision: info.turnSeq ?? 0,
      models: [
        {
          modelId: usage.model ?? info.model ?? null,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
          knownCostMicroUsd,
          costAuthority,
        },
      ],
      totalCostMicroUsd: knownCostMicroUsd,
      totalCostAuthority: costAuthority,
      pricingVersion: null,
      workspaceKey: normalizeWorkspaceRoot(info.workingDirectory),
      host: 'cli',
    };
    const contribution = parseSessionUsageContribution(built);
    if (contribution === null) {
      logger.warn(
        '[LaneCompletionNotifier] Usage contribution rejected at the capture boundary',
        { runId },
      );
      return;
    }
    void Promise.resolve(sink.recordUsage(contribution)).catch((error: unknown) => {
      logger.error('[LaneCompletionNotifier] Usage capture failed', error instanceof Error ? error : new Error(String(error)));
    });
  } catch (error: unknown) {
    logger.error(
      '[LaneCompletionNotifier] Usage capture failed; the completion signal is unaffected',
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}
