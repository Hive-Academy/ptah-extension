import type { DependencyContainer } from 'tsyringe';

import {
  SKILL_SYNTHESIS_TOKENS,
  type BacklogCleanupReport,
  type BacklogCleanupRunOptions,
  type BacklogCleanupRunReport,
} from '@ptah-extension/skill-synthesis';
import {
  CRON_TOKENS,
  type JobHandlerContext,
} from '@ptah-extension/cron-scheduler';

import {
  SKILL_BACKLOG_CLEANUP_JOB,
  createSkillBacklogCleanupHandler,
} from './skill-backlog-cleanup-job';

type Entry = readonly [unknown, unknown];

function makeContainer(entries: Entry[]): DependencyContainer {
  const values = new Map(entries);
  return {
    isRegistered: jest.fn((token: unknown) => values.has(token)),
    resolve: jest.fn((token: unknown) => {
      if (!values.has(token))
        throw new Error(`not registered: ${String(token)}`);
      return values.get(token);
    }),
  } as unknown as DependencyContainer;
}

function runReport(
  overrides: Partial<BacklogCleanupRunReport> = {},
): BacklogCleanupRunReport {
  return {
    status: 'completed',
    reason: null,
    examined: 12,
    keptEvidence: 2,
    keptVerdict: 3,
    keptDegradedVerdict: 1,
    rejectedNoEvidence: 4,
    rejectedTranscriptUnreadable: 2,
    invocationsDeleted: 9,
    deferredOnError: 5,
    keptRootUnknown: 7,
    rejectedNoTranscript: 2,
    durationMs: 10,
    error: null,
    ...overrides,
  };
}

function makeCtx(signal = new AbortController().signal): JobHandlerContext {
  return {
    job: { id: SKILL_BACKLOG_CLEANUP_JOB.jobId } as never,
    scheduledFor: 0,
    signal,
  };
}

function makeDoubles() {
  const service = {
    run: jest.fn(
      async (
        _options: BacklogCleanupRunOptions,
      ): Promise<BacklogCleanupReport> => runReport(),
    ),
  };
  const monitor = { isOnBattery: jest.fn(() => false) };
  const container = makeContainer([
    [SKILL_SYNTHESIS_TOKENS.SKILL_BACKLOG_CLEANUP_SERVICE, service],
    [CRON_TOKENS.CRON_POWER_MONITOR, monitor],
  ]);
  return { container, service, monitor };
}

describe('SKILL_BACKLOG_CLEANUP_JOB', () => {
  it('pins the job id, handler name and minute-41 UTC schedule', () => {
    expect(SKILL_BACKLOG_CLEANUP_JOB).toEqual({
      jobId: '@ptah/skills-backlog-cleanup',
      name: 'Skills Backlog Cleanup',
      handlerName: 'skills:backlog-cleanup',
      cronExpr: '41 * * * *',
      timezone: 'UTC',
    });
  });
});

describe('createSkillBacklogCleanupHandler', () => {
  it('passes the cron signal and live battery reader to the service', async () => {
    const { container, service, monitor } = makeDoubles();
    const signal = new AbortController().signal;

    await createSkillBacklogCleanupHandler(container)(makeCtx(signal));

    const options = service.run.mock.calls[0][0];
    expect(options.signal).toBe(signal);
    monitor.isOnBattery.mockReturnValue(true);
    expect(options.isOnBattery()).toBe(true);
  });

  it('summarizes every outcome counter including per-run counters', async () => {
    const { container } = makeDoubles();

    await expect(
      createSkillBacklogCleanupHandler(container)(makeCtx()),
    ).resolves.toEqual({
      summary:
        'examined 12, rejected 6, kept 6, invocations deleted 9, deferred on error 5, root unknown 7, no transcript 2',
    });
  });

  it('maps a skipped report to a skipped outcome', async () => {
    const { container, service } = makeDoubles();
    service.run.mockResolvedValue({ status: 'skipped', reason: 'complete' });

    await expect(
      createSkillBacklogCleanupHandler(container)(makeCtx()),
    ).resolves.toEqual({ outcome: 'skipped', reason: 'complete' });
  });

  it('throws only the failed report reason token', async () => {
    const { container, service } = makeDoubles();
    service.run.mockResolvedValue(
      runReport({
        status: 'failed',
        reason: 'unexpected-error',
        error: 'SQLITE_IOERR at <path>',
      }),
    );

    const run = createSkillBacklogCleanupHandler(container)(makeCtx());
    await expect(run).rejects.toThrow(new Error('unexpected-error'));
    await expect(run).rejects.not.toThrow(
      /SQLITE_IOERR|backlog cleanup failed/,
    );
  });

  it('names the service when the cleanup service cannot be resolved', async () => {
    const container = makeContainer([
      [CRON_TOKENS.CRON_POWER_MONITOR, { isOnBattery: jest.fn(() => false) }],
    ]);

    await expect(
      createSkillBacklogCleanupHandler(container)(makeCtx()),
    ).resolves.toEqual({
      outcome: 'skipped',
      reason: 'backlog-cleanup-service-unavailable',
    });
  });

  it('names the power monitor when only the power monitor cannot be resolved', async () => {
    const service = {
      run: jest.fn(async (): Promise<BacklogCleanupReport> => runReport()),
    };
    const container = makeContainer([
      [SKILL_SYNTHESIS_TOKENS.SKILL_BACKLOG_CLEANUP_SERVICE, service],
    ]);

    await expect(
      createSkillBacklogCleanupHandler(container)(makeCtx()),
    ).resolves.toEqual({
      outcome: 'skipped',
      reason: 'backlog-cleanup-power-monitor-unavailable',
    });
    expect(service.run).not.toHaveBeenCalled();
  });
});
