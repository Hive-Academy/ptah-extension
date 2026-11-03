import { z } from 'zod';
import type {
  SessionUsageContribution as LiveUsageContribution,
  SessionUsageSink,
} from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  SessionStatsRepository,
  type SessionUsageContribution,
} from './session-stats-repository';

const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().min(1);
const authority = z.enum(['provider-reported', 'model-priced', 'unpriced']);
const liveContributionSchema: z.ZodType<LiveUsageContribution> = z
  .object({
    sessionId: identifier,
    producer: z.enum(['sdk-owner', 'codex-checkpoint', 'cli-lane']),
    runId: identifier,
    turnId: identifier.nullable(),
    eventKey: identifier,
    parentSessionId: identifier.nullable(),
    subagentId: identifier.nullable(),
    providerId: identifier.nullable(),
    occurredAtMs: safeInteger,
    revision: safeInteger,
    models: z
      .array(
        z
          .object({
            modelId: identifier.nullable(),
            inputTokens: safeInteger,
            outputTokens: safeInteger,
            cacheReadTokens: safeInteger,
            cacheCreationTokens: safeInteger,
            knownCostMicroUsd: safeInteger.nullable(),
            costAuthority: authority,
          })
          .strict(),
      )
      .max(256),
    totalCostMicroUsd: safeInteger.nullable(),
    totalCostAuthority: authority,
    pricingVersion: identifier.nullable(),
    runCostSnapshot: z.boolean().optional(),
    workspaceKey: identifier.nullable().optional(),
    host: identifier.nullable().optional(),
  })
  .strict();

/** Serializes accepted contributions and reports every failed write to its caller. */
export class SqliteSessionUsageSink implements SessionUsageSink {
  private static readonly MAX_PENDING_WRITES = 256;
  private tail: Promise<void> = Promise.resolve();
  private failedWrites = 0;
  private pendingWrites = 0;

  constructor(
    private readonly repository: SessionStatsRepository,
    private readonly logger: Pick<Logger, 'error'>,
  ) {}

  recordUsage(raw: LiveUsageContribution): Promise<void> {
    const parsed = liveContributionSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.error('[persistence-sqlite] rejected invalid session usage', parsed.error);
      return Promise.reject(parsed.error);
    }
    if (this.pendingWrites >= SqliteSessionUsageSink.MAX_PENDING_WRITES) {
      const error = new Error('Session usage queue is full');
      this.failedWrites += 1;
      this.logger.error('[persistence-sqlite] session usage queue overflow', error);
      return Promise.reject(error);
    }
    this.pendingWrites += 1;
    const write = this.tail.then(async () => {
      await this.repository.recordEvent(this.toRows(parsed.data));
    });
    this.tail = write.then(() => {
      this.pendingWrites -= 1;
    }, (error: unknown) => {
      this.pendingWrites -= 1;
      this.failedWrites += 1;
      this.logger.error('[persistence-sqlite] session usage write failed',
        error instanceof Error ? error : new Error(String(error)));
    });
    return write;
  }

  /** Waits for all writes accepted before this call, including failed writes. */
  async flush(): Promise<void> {
    await this.tail;
    if (this.failedWrites > 0) {
      const count = this.failedWrites;
      this.failedWrites = 0;
      throw new Error(`${count} session usage writes failed`);
    }
  }

  private toRows(event: LiveUsageContribution): SessionUsageContribution[] {
    const eventKey = JSON.stringify([event.runId, event.eventKey]);
    const attributed = event.models.reduce((sum, model) => {
      const next = sum + (model.knownCostMicroUsd ?? 0);
      if (!Number.isSafeInteger(next)) throw new Error('Usage cost overflow');
      return next;
    }, 0);
    const rows = event.models.map((model): SessionUsageContribution => ({
      sessionId: event.sessionId,
      producer: event.producer,
      runId: event.runId,
      turnId: event.turnId ?? event.eventKey,
      eventKey,
      modelId: model.modelId ?? '__unattributed__',
      providerId: event.providerId ?? 'unknown',
      occurredAtMs: event.occurredAtMs,
      inputTokens: model.inputTokens,
      outputTokens: model.outputTokens,
      cacheReadTokens: model.cacheReadTokens,
      cacheWriteTokens: model.cacheCreationTokens,
      knownCostMicroUsd: model.knownCostMicroUsd,
      costAuthority: model.costAuthority,
      source: 'live',
      pricingVersion: event.pricingVersion,
      workspaceKey: event.workspaceKey ?? null,
      host: event.host ?? null,
      revision: event.revision,
      runCostSnapshot: event.runCostSnapshot,
    }));
    if (rows.length === 0) {
      rows.push({
        sessionId: event.sessionId,
        producer: event.producer,
        runId: event.runId,
        turnId: event.turnId ?? event.eventKey,
        eventKey,
        modelId: '__unattributed__',
        providerId: event.providerId ?? 'unknown',
        occurredAtMs: event.occurredAtMs,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        knownCostMicroUsd: event.totalCostMicroUsd,
        costAuthority: event.totalCostAuthority,
        source: 'live',
        pricingVersion: event.pricingVersion,
        workspaceKey: event.workspaceKey ?? null,
        host: event.host ?? null,
        revision: event.revision,
        runCostSnapshot: event.runCostSnapshot,
      });
    }
    if (
      event.models.length > 0 &&
      event.totalCostMicroUsd !== null &&
      event.totalCostMicroUsd > attributed
    ) {
      rows.push({
        sessionId: event.sessionId,
        producer: event.producer,
        runId: event.runId,
        turnId: event.turnId ?? event.eventKey,
        eventKey,
        modelId: '__session_residual__',
        providerId: event.providerId ?? 'unknown',
        occurredAtMs: event.occurredAtMs,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        knownCostMicroUsd: event.totalCostMicroUsd - attributed,
        costAuthority: event.totalCostAuthority,
        source: 'live',
        pricingVersion: event.pricingVersion,
        workspaceKey: event.workspaceKey ?? null,
        host: event.host ?? null,
        revision: event.revision,
        runCostSnapshot: event.runCostSnapshot,
      });
    }
    return rows;
  }
}
