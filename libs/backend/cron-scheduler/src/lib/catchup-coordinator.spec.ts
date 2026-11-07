import 'reflect-metadata';
import type { JobId } from '@ptah-extension/shared';
import { Logger } from '@ptah-extension/vscode-core';
import { CatchupCoordinator } from './catchup-coordinator';
import { loadCron } from './croner-loader';
import type { IJobStore } from './job.store';
import { JobRunner } from './job-runner';
import { NoopPowerMonitor } from './power-monitor.interface';
import type { ScheduledJob } from './types';

const NOW = Date.parse('2026-01-02T00:00:00Z');

function oldSlots(expr: string, since: number, now: number): number[] {
  const Cron = loadCron();
  const cron = new Cron(expr, { timezone: 'UTC', protect: false, paused: true });
  const slots: number[] = [];
  let cursor = new Date(since);
  for (let i = 0; i < 2000; i += 1) {
    const next = cron.nextRun(cursor);
    if (!next || next.getTime() > now) break;
    slots.push(next.getTime());
    cursor = next;
  }
  return slots;
}

function setup(expr: string, lastRunAt: number, window: number) {
  const job: ScheduledJob = {
    id: 'test' as JobId,
    name: 'test', cronExpr: expr, timezone: 'UTC', prompt: 'test',
    workspaceRoot: null, enabled: true, createdAt: 0, updatedAt: 0,
    lastRunAt, nextRunAt: null,
  };
  const run = jest.fn().mockResolvedValue(undefined);
  const jobs: IJobStore = {
    list: jest.fn().mockReturnValue([job]),
    create: jest.fn(), get: jest.fn(), update: jest.fn(),
    delete: jest.fn(), upsert: jest.fn(),
  };
  const runner = Object.assign(Object.create(JobRunner.prototype) as JobRunner, { run });
  const logger = Object.assign(Object.create(Logger.prototype) as Logger, { error: jest.fn() });
  const coordinator = new CatchupCoordinator(jobs, runner, new NoopPowerMonitor(), logger);
  return { coordinator, run, job, options: {
    enabled: true, maxConcurrentJobs: 1, catchupWindowMs: window,
  } };
}

describe('CatchupCoordinator cooperative slot enumeration', () => {
  it.each(['* * * * * *', '*/5 * * * *', '0 0 * * *'])('matches the old capped sequence for %s', async (expr) => {
    const since = NOW - 86_400_000;
    const { coordinator, run, job, options } = setup(expr, since, 86_400_000);
    await coordinator.replayMissed(options, () => 'all', NOW);
    expect(run.mock.calls.map((call) => call[1])).toEqual(oldSlots(expr, since, NOW));
    expect(run.mock.calls.every((call) => call[0] === job)).toBe(true);
  });

  it('yields to the event loop before finishing a large window', async () => {
    const { coordinator, run, options } = setup('* * * * * *', NOW - 86_400_000, 86_400_000);
    let settled = false;
    const replay = coordinator.replayMissed(options, () => 'last', NOW).then(() => { settled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    await replay;
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toBe(oldSlots('* * * * * *', NOW - 86_400_000, NOW).at(-1));
  });
});
