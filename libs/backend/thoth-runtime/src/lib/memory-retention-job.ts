import type { DependencyContainer } from 'tsyringe';

import {
  MEMORY_TOKENS,
  type MemoryRetentionService,
} from '@ptah-extension/memory-curator';
import {
  CRON_TOKENS,
  type IPowerMonitor,
  type JobHandler,
} from '@ptah-extension/cron-scheduler';
import {
  SKILL_SYNTHESIS_TOKENS,
  type ForegroundActivityTracker,
} from '@ptah-extension/skill-synthesis';

/** The shape of {@link MEMORY_RETENTION_JOB}. */
export interface MemoryRetentionJobSpec {
  readonly jobId: string;
  readonly name: string;
  readonly handlerName: string;
  readonly cronExpr: string;
  readonly timezone: 'UTC';
}

/**
 * The memory retention cron job — the ONE definition, read by every host that
 * starts Thoth cron (TASK_2026_440).
 *
 * Data, not lifecycle, on the precedent of `SKILL_DRAIN_JOBS`: `startThothCron`
 * and `cli-engine`'s `activateThoth` each register it their own way, but the id,
 * handler name and schedule cannot drift between them.
 *
 * Hourly at minute 17. That minute avoids :00 (daily backup and nightly drain),
 * :30 (integrity check) and the quarter-hour frequent-drain slots. It is a
 * constant, not a setting: the user-facing knobs are the retention days and
 * batch size, and the service decides for itself whether a tick is due.
 */
export const MEMORY_RETENTION_JOB: MemoryRetentionJobSpec = {
  jobId: '@ptah/memory-retention',
  name: 'Memory Retention',
  handlerName: 'memory:retention',
  cronExpr: '17 * * * *',
  timezone: 'UTC',
};

/**
 * Build the per-run handler for {@link MEMORY_RETENTION_JOB}.
 *
 * Every collaborator is resolved INSIDE the run, never captured at
 * registration: the handler fires hours after it was registered, the power
 * monitor is a live OS view, and a container disposed in between must produce a
 * skipped run rather than a thrown one.
 *
 * Failure channel: `MemoryRetentionService.run` never rejects and has already
 * recorded its own result, so nothing escapes into the scheduler loop. A
 * `failed` report is THROWN here on purpose — `JobRunner` turns a throw into the
 * run row's `failed` status, and returning a success or a skip for a failed run
 * would repeat the TASK_2026_315 defect. The message carries the failure token
 * only, never the sanitized error text, so no path reaches the run history.
 */
export function createMemoryRetentionHandler(
  container: DependencyContainer,
): JobHandler {
  return async (ctx) => {
    let service: MemoryRetentionService;
    try {
      service = container.resolve<MemoryRetentionService>(
        MEMORY_TOKENS.MEMORY_RETENTION_SERVICE,
      );
    } catch {
      return {
        outcome: 'skipped' as const,
        reason: 'retention-service-unavailable',
      };
    }

    const monitor = container.resolve<IPowerMonitor>(
      CRON_TOKENS.CRON_POWER_MONITOR,
    );
    const msSinceForegroundActivity = foregroundActivityReader(container);

    const report = await service.run({
      signal: ctx.signal,
      isOnBattery: () => monitor.isOnBattery(),
      msSinceForegroundActivity,
    });

    if (report.status === 'skipped') {
      return { outcome: 'skipped' as const, reason: report.reason };
    }
    if (report.status === 'failed') {
      throw new Error(
        `memory retention failed: ${report.reason ?? 'unknown'}`,
      );
    }
    const summary = `purged ${report.processedPurged} processed, quarantined ${report.stuckQuarantined} stuck, reclaimed ${report.pagesReclaimed} pages`;
    return {
      summary:
        report.status === 'partial'
          ? `${summary} (partial: ${report.reason ?? 'unknown'})`
          : summary,
    };
  };
}

/**
 * The foreground tracker is optional: a host without skill synthesis has none,
 * and `Infinity` is the tracker's own answer for "no activity observed".
 * `start()` is idempotent and subscribes the tracker when the skill drain has
 * not run yet in this process.
 */
function foregroundActivityReader(
  container: DependencyContainer,
): () => number {
  if (
    !container.isRegistered(SKILL_SYNTHESIS_TOKENS.FOREGROUND_ACTIVITY_TRACKER)
  ) {
    return () => Number.POSITIVE_INFINITY;
  }
  const tracker = container.resolve<ForegroundActivityTracker>(
    SKILL_SYNTHESIS_TOKENS.FOREGROUND_ACTIVITY_TRACKER,
  );
  tracker.start();
  return () => tracker.msSinceLastActivity();
}
