import { basename } from 'path';
import { LANE_DEFAULT_MODEL, laneFamilyOf } from '@ptah-extension/shared';
import type {
  AgentProcessInfo,
  LaneCompletionSignal,
} from '@ptah-extension/shared';
import type { LaneOutcomeRecorder } from '@ptah-extension/lane-outcomes';
import type { Logger } from '@ptah-extension/vscode-core';
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
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
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
