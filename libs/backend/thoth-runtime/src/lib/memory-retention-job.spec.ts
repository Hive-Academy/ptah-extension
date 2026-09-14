import type { DependencyContainer } from 'tsyringe';

import {
  MEMORY_TOKENS,
  type MemoryRetentionReport,
  type MemoryRetentionRunOptions,
  type MemoryRetentionRunReport,
} from '@ptah-extension/memory-curator';
import {
  CRON_TOKENS,
  type JobHandlerContext,
} from '@ptah-extension/cron-scheduler';
import { SKILL_SYNTHESIS_TOKENS } from '@ptah-extension/skill-synthesis';

import {
  MEMORY_RETENTION_JOB,
  createMemoryRetentionHandler,
} from './memory-retention-job';

type Entry = readonly [unknown, unknown];

function makeContainer(entries: Entry[]): DependencyContainer {
  const map = new Map<unknown, unknown>(entries);
  return {
    isRegistered: (token: unknown) => map.has(token),
    resolve: jest.fn((token: unknown) => {
      if (!map.has(token)) {
        throw new Error(`not registered: ${String(token)}`);
      }
      return map.get(token);
    }),
  } as unknown as DependencyContainer;
}

function runReport(
  overrides: Partial<MemoryRetentionRunReport> = {},
): MemoryRetentionRunReport {
  return {
    status: 'completed',
    reason: null,
    processedPurged: 120,
    stuckQuarantined: 4,
    ledgerPruned: 0,
    freedBytes: 4096,
    pagesReclaimed: 9,
    backlogRemaining: false,
    durationMs: 12,
    error: null,
    ...overrides,
  };
}

function makeCtx(signal = new AbortController().signal): JobHandlerContext {
  return {
    job: { id: MEMORY_RETENTION_JOB.jobId } as never,
    scheduledFor: 0,
    signal,
  };
}

function makeDoubles(opts: { withTracker?: boolean } = {}) {
  const service = {
    run: jest.fn(
      async (
        _options: MemoryRetentionRunOptions,
      ): Promise<MemoryRetentionReport> => runReport(),
    ),
  };
  const powerMonitor = { isOnBattery: jest.fn(() => false) };
  const tracker = {
    start: jest.fn(),
    msSinceLastActivity: jest.fn(() => 42_000),
  };
  const entries: Entry[] = [
    [MEMORY_TOKENS.MEMORY_RETENTION_SERVICE, service],
    [CRON_TOKENS.CRON_POWER_MONITOR, powerMonitor],
  ];
  if (opts.withTracker !== false) {
    entries.push([SKILL_SYNTHESIS_TOKENS.FOREGROUND_ACTIVITY_TRACKER, tracker]);
  }
  return { container: makeContainer(entries), service, powerMonitor, tracker };
}

describe('MEMORY_RETENTION_JOB', () => {
  it('pins the job id, handler name and hourly minute-17 UTC schedule', () => {
    expect(MEMORY_RETENTION_JOB).toEqual({
      jobId: '@ptah/memory-retention',
      name: 'Memory Retention',
      handlerName: 'memory:retention',
      cronExpr: '17 * * * *',
      timezone: 'UTC',
    });
  });
});

describe('createMemoryRetentionHandler', () => {
  it('passes the cron signal and live gate readers to service.run', async () => {
    const { container, service, powerMonitor, tracker } = makeDoubles();
    const controller = new AbortController();
    const handler = createMemoryRetentionHandler(container);

    await handler(makeCtx(controller.signal));

    expect(service.run).toHaveBeenCalledTimes(1);
    const options = service.run.mock.calls[0][0];
    expect(options.signal).toBe(controller.signal);

    powerMonitor.isOnBattery.mockReturnValue(true);
    expect(options.isOnBattery()).toBe(true);
    expect(options.msSinceForegroundActivity()).toBe(42_000);
    expect(tracker.start).toHaveBeenCalledTimes(1);
  });

  it('maps a completed report to a summary', async () => {
    const { container } = makeDoubles();
    const handler = createMemoryRetentionHandler(container);

    await expect(handler(makeCtx())).resolves.toEqual({
      summary: 'purged 120 processed, quarantined 4 stuck, reclaimed 9 pages',
    });
  });

  it('maps a partial report to a summary carrying its stop reason', async () => {
    const { container, service } = makeDoubles();
    service.run.mockResolvedValue(
      runReport({
        status: 'partial',
        reason: 'time-budget',
        backlogRemaining: true,
      }),
    );
    const handler = createMemoryRetentionHandler(container);

    await expect(handler(makeCtx())).resolves.toEqual({
      summary:
        'purged 120 processed, quarantined 4 stuck, reclaimed 9 pages (partial: time-budget)',
    });
  });

  it('maps a skipped report to a skipped OUTCOME with the gate reason', async () => {
    const { container, service } = makeDoubles();
    service.run.mockResolvedValue({ status: 'skipped', reason: 'on-battery' });
    const handler = createMemoryRetentionHandler(container);

    await expect(handler(makeCtx())).resolves.toEqual({
      outcome: 'skipped',
      reason: 'on-battery',
    });
  });

  it('throws on a failed report with the reason token and no error text', async () => {
    const { container, service } = makeDoubles();
    service.run.mockResolvedValue(
      runReport({
        status: 'failed',
        reason: 'purge-failed',
        error: 'SQLITE_IOERR at <path>',
        backlogRemaining: true,
      }),
    );
    const handler = createMemoryRetentionHandler(container);

    const run = handler(makeCtx());

    await expect(run).rejects.toThrow(
      new Error('memory retention failed: purge-failed'),
    );
    await expect(run).rejects.not.toThrow(/SQLITE_IOERR/);
  });

  it('resolves the service and the power monitor on every run', async () => {
    const { container } = makeDoubles();
    const handler = createMemoryRetentionHandler(container);
    const resolve = container.resolve as unknown as jest.Mock;

    expect(resolve).not.toHaveBeenCalled();
    await handler(makeCtx());
    await handler(makeCtx());

    const tokens = resolve.mock.calls.map((call) => call[0]);
    expect(
      tokens.filter((t) => t === MEMORY_TOKENS.MEMORY_RETENTION_SERVICE),
    ).toHaveLength(2);
    expect(
      tokens.filter((t) => t === CRON_TOKENS.CRON_POWER_MONITOR),
    ).toHaveLength(2);
  });

  it('reports Infinity foreground idle time when the host has no tracker', async () => {
    const { container, service, tracker } = makeDoubles({
      withTracker: false,
    });
    const handler = createMemoryRetentionHandler(container);

    await handler(makeCtx());

    const options = service.run.mock.calls[0][0];
    expect(options.msSinceForegroundActivity()).toBe(Number.POSITIVE_INFINITY);
    expect(tracker.start).not.toHaveBeenCalled();
  });

  it('returns a skipped outcome when the service cannot be resolved', async () => {
    const { container, service } = makeDoubles();
    const handler = createMemoryRetentionHandler(container);
    (container.resolve as unknown as jest.Mock).mockImplementationOnce(() => {
      throw new Error('container disposed');
    });

    await expect(handler(makeCtx())).resolves.toEqual({
      outcome: 'skipped',
      reason: 'retention-service-unavailable',
    });
    expect(service.run).not.toHaveBeenCalled();
  });
});
