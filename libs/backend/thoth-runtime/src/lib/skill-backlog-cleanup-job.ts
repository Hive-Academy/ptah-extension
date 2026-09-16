import type { DependencyContainer } from 'tsyringe';

import {
  SKILL_SYNTHESIS_TOKENS,
  type BacklogCleanupReport,
  type SkillBacklogCleanupService,
} from '@ptah-extension/skill-synthesis';
import {
  CRON_TOKENS,
  type IPowerMonitor,
  type JobHandler,
} from '@ptah-extension/cron-scheduler';

export interface SkillBacklogCleanupJobSpec {
  readonly jobId: string;
  readonly name: string;
  readonly handlerName: string;
  readonly cronExpr: string;
  readonly timezone: 'UTC';
}

export const SKILL_BACKLOG_CLEANUP_JOB: SkillBacklogCleanupJobSpec = {
  jobId: '@ptah/skills-backlog-cleanup',
  name: 'Skills Backlog Cleanup',
  handlerName: 'skills:backlog-cleanup',
  cronExpr: '41 * * * *',
  timezone: 'UTC',
};

export function createSkillBacklogCleanupHandler(
  container: DependencyContainer,
): JobHandler {
  return async (ctx) => {
    let service: SkillBacklogCleanupService;
    let monitor: IPowerMonitor;
    // Two resolves, two reason tokens: the run row must name the dependency
    // that is actually missing, not blame the service for the power monitor.
    try {
      service = container.resolve<SkillBacklogCleanupService>(
        SKILL_SYNTHESIS_TOKENS.SKILL_BACKLOG_CLEANUP_SERVICE,
      );
    } catch {
      return {
        outcome: 'skipped' as const,
        reason: 'backlog-cleanup-service-unavailable',
      };
    }
    try {
      monitor = container.resolve<IPowerMonitor>(
        CRON_TOKENS.CRON_POWER_MONITOR,
      );
    } catch {
      return {
        outcome: 'skipped' as const,
        reason: 'backlog-cleanup-power-monitor-unavailable',
      };
    }

    const report = await service.run({
      signal: ctx.signal,
      isOnBattery: () => monitor.isOnBattery(),
    });
    if (report.status === 'skipped') {
      return { outcome: 'skipped' as const, reason: report.reason };
    }
    if (report.status === 'failed') {
      throw new Error(report.reason ?? 'unknown');
    }

    const summary = summarizeCleanup(report);
    return {
      summary:
        report.status === 'partial'
          ? `${summary} (partial: ${report.reason ?? 'unknown'})`
          : summary,
    };
  };
}

function summarizeCleanup(
  report: Exclude<BacklogCleanupReport, { status: 'skipped' }>,
): string {
  const rejected =
    report.rejectedNoEvidence + report.rejectedTranscriptUnreadable;
  const kept =
    report.keptEvidence + report.keptVerdict + report.keptDegradedVerdict;
  return `examined ${report.examined}, rejected ${rejected}, kept ${kept}, invocations deleted ${report.invocationsDeleted}, deferred on error ${report.deferredOnError}`;
}
