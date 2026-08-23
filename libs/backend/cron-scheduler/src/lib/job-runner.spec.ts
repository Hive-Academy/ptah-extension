/**
 * JobRunner — the three terminal outcomes a handler that actually RAN can
 * produce, and which store call each one lands on.
 *
 * The defect this file pins (TASK_2026_315 / C2): `markSucceeded` was called
 * unconditionally after `dispatch` resolved, so a `skills:drain:*` handler that
 * stopped at its daily token budget was recorded as `succeeded`. The captured
 * log has four pairs of
 *
 *   [skill-synthesis] drain skipped: {"reason":"daily-token-budget-exhausted"}
 *   [cron-scheduler]  run succeeded: {"jobId":"@ptah/skills-drain-frequent"}
 *
 * roughly a minute apart. `cron:runs` is exactly where a user looks to find out
 * why background synthesis stopped, and it was the one surface claiming it had
 * not.
 *
 * The three cases below are asserted TOGETHER on purpose: the fix is a branch,
 * and a branch can be wrong in both directions. Skipped-not-succeeded is the
 * regression; succeeded-still-succeeded is the guard against over-widening it;
 * failed-still-failed is the guard against swallowing a real error as "did
 * nothing". The two skips the RUNNER owns (concurrency cap, abort) are pinned
 * here too, because the handler-declared skip must not disturb them.
 *
 * Collaborators are hand-rolled fakes rather than a tsyringe graph: `JobRunner`
 * takes its five dependencies by constructor, and better-sqlite3 cannot load in
 * the Jest runner anyway (this repo rebuilds it against Electron's ABI) — the
 * same reason `run.store.spec.ts` and `job.store.spec.ts` fake the driver.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { JobId, RunId } from '@ptah-extension/shared';
import { JobRunner } from './job-runner';
import type { IJobStore } from './job.store';
import type { IRunStore } from './run.store';
import { SlotAlreadyClaimedError } from './run.store';
import type {
  IHandlerRegistry,
  JobHandler,
  JobHandlerResult,
  ScheduledJob,
} from './types';

const JOB_ID = JobId.from('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const RUN_ID = RunId.from('01ARZ3NDEKTSV4RRFFQ69G5FAW');

function drainJob(): ScheduledJob {
  return {
    id: JOB_ID,
    name: 'Skill Synthesis Drain (frequent)',
    cronExpr: '*/15 * * * *',
    timezone: 'UTC',
    prompt: 'handler:skills:drain:frequent',
    workspaceRoot: null,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    lastRunAt: null,
    nextRunAt: null,
  };
}

interface Harness {
  runner: JobRunner;
  runs: {
    tryClaim: jest.Mock;
    markStarted: jest.Mock;
    markSucceeded: jest.Mock;
    markFailed: jest.Mock;
    markSkipped: jest.Mock;
    list: jest.Mock;
    get: jest.Mock;
    latestForJob: jest.Mock;
  };
  jobs: { update: jest.Mock };
  internalQuery: { execute: jest.Mock };
}

/**
 * @param handler - what the registry resolves for `skills:drain:frequent`.
 *   Pass `null` to leave the registry empty.
 */
function makeHarness(handler: JobHandler | null): Harness {
  const runs = {
    tryClaim: jest.fn(() => ({
      id: RUN_ID,
      jobId: JOB_ID,
      scheduledFor: 0,
      startedAt: null,
      endedAt: null,
      status: 'pending' as const,
      resultSummary: null,
      errorMessage: null,
    })),
    markStarted: jest.fn(),
    markSucceeded: jest.fn(),
    markFailed: jest.fn(),
    markSkipped: jest.fn(),
    list: jest.fn(() => []),
    get: jest.fn(() => null),
    latestForJob: jest.fn(() => null),
  };
  const jobs = { update: jest.fn() };
  const internalQuery = { execute: jest.fn() };
  const handlers: IHandlerRegistry = {
    register: jest.fn(),
    unregister: jest.fn(),
    has: jest.fn(() => handler !== null),
    resolve: jest.fn(() => handler ?? undefined),
  };
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    logWithContext: jest.fn(),
  } as unknown as Logger;

  const runner = new JobRunner(
    runs as unknown as IRunStore,
    jobs as unknown as IJobStore,
    internalQuery,
    handlers,
    logger,
    null,
  );
  return { runner, runs, jobs, internalQuery };
}

describe('JobRunner outcomes', () => {
  it('records a handler that deliberately did nothing as SKIPPED, not succeeded', async () => {
    // Exactly what the skill-drain seam returns when the daily token budget
    // gate closes before any queue row is claimed.
    const result: JobHandlerResult = {
      outcome: 'skipped',
      reason: 'daily-token-budget-exhausted',
    };
    const { runner, runs } = makeHarness(async () => result);

    await runner.run(drainJob(), 1_700_000_000_000);

    expect(runs.markSucceeded).not.toHaveBeenCalled();
    expect(runs.markFailed).not.toHaveBeenCalled();
    expect(runs.markSkipped).toHaveBeenCalledTimes(1);
    // The reason is the payload, not decoration: `markSkipped` writes it into
    // `job_runs.result_summary`, which is the string the run-history drawer
    // renders. A user asking "why did synthesis stop" reads this exact token.
    expect(runs.markSkipped).toHaveBeenCalledWith(
      RUN_ID,
      'daily-token-budget-exhausted',
    );
  });

  it('still records a handler that did real work as SUCCEEDED', async () => {
    const { runner, runs, jobs } = makeHarness(async () => ({
      summary: 'claimed 4, done 4, failed 0',
    }));

    await runner.run(drainJob(), 1_700_000_000_000);

    expect(runs.markSkipped).not.toHaveBeenCalled();
    expect(runs.markFailed).not.toHaveBeenCalled();
    expect(runs.markSucceeded).toHaveBeenCalledWith(
      RUN_ID,
      'claimed 4, done 4, failed 0',
    );
    expect(jobs.update).toHaveBeenCalledWith(JOB_ID, {
      lastRunAt: expect.any(Number),
    });
  });

  it('treats a handler that omits `outcome` as succeeded', async () => {
    // Every handler predating the channel returns a bare `{ summary }`; the
    // daily backup still does. Absent must keep meaning success.
    const { runner, runs } = makeHarness(async () => ({
      summary: 'backup written to /backups/daily.db',
    }));

    await runner.run(drainJob(), 1_700_000_000_000);

    expect(runs.markSucceeded).toHaveBeenCalledWith(
      RUN_ID,
      'backup written to /backups/daily.db',
    );
    expect(runs.markSkipped).not.toHaveBeenCalled();
  });

  it('still records a thrown handler as FAILED', async () => {
    const { runner, runs } = makeHarness(async () => {
      throw new Error('drain exploded');
    });

    await runner.run(drainJob(), 1_700_000_000_000);

    expect(runs.markSucceeded).not.toHaveBeenCalled();
    expect(runs.markSkipped).not.toHaveBeenCalled();
    expect(runs.markFailed).toHaveBeenCalledWith(RUN_ID, 'drain exploded');
  });

  it('falls back to the summary, then a token, when a skip carries no reason', async () => {
    const { runner, runs } = makeHarness(async () => ({
      outcome: 'skipped' as const,
    }));

    await runner.run(drainJob(), 1_700_000_000_000);

    // Never `null` — a blank run row in the history is the same dead end as
    // the wrong status.
    expect(runs.markSkipped).toHaveBeenCalledWith(RUN_ID, 'handler-skipped');
  });
});

describe('JobRunner skips the RUNNER owns (unchanged by the handler channel)', () => {
  it('marks the concurrency cap as skipped without entering the handler', async () => {
    // The first run parks inside the handler, so the second finds the single
    // slot occupied. Two runs on ONE runner is what the cap guards.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = jest.fn(async () => {
      await gate;
      return { summary: 'claimed 4, done 4, failed 0' };
    });
    const { runner, runs, jobs } = makeHarness(handler);
    runner.setMaxConcurrent(1);

    const first = runner.run(drainJob(), 1);
    const second = runner.run(drainJob(), 2);
    release();
    await Promise.all([first, second]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(runs.markSkipped).toHaveBeenCalledWith(RUN_ID, 'concurrency-limit');
    expect(runs.markSucceeded).toHaveBeenCalledTimes(1);
    // The capped slot never reached the handler, so only the run that actually
    // executed bumped the job row.
    expect(jobs.update).toHaveBeenCalledTimes(1);
  });

  it('marks an aborted run as skipped with reason `aborted`', async () => {
    const ctl = new AbortController();
    const { runner, runs, jobs } = makeHarness(async (ctx) => {
      ctl.abort();
      // Mirror a cooperative handler: it observes the signal and throws.
      if (ctx.signal.aborted) throw new Error('aborted mid-flight');
      return { summary: 'unreachable' };
    });

    await runner.run(drainJob(), 1_700_000_000_000, { signal: ctl.signal });

    expect(runs.markSkipped).toHaveBeenCalledWith(RUN_ID, 'aborted');
    expect(runs.markFailed).not.toHaveBeenCalled();
    // An abort is not evidence the job ran, so the timestamp stays put.
    expect(jobs.update).not.toHaveBeenCalled();
  });

  it('returns quietly when another runner already claimed the slot', async () => {
    const handler = jest.fn(async () => ({ summary: 'should not run' }));
    const { runner, runs } = makeHarness(handler);
    runs.tryClaim.mockImplementation(() => {
      throw new SlotAlreadyClaimedError(JOB_ID, 1);
    });

    await runner.run(drainJob(), 1);

    expect(handler).not.toHaveBeenCalled();
    expect(runs.markSkipped).not.toHaveBeenCalled();
    expect(runs.markSucceeded).not.toHaveBeenCalled();
    expect(runs.markFailed).not.toHaveBeenCalled();
  });
});
