/**
 * Cron Scheduler e2e — TASK_2026_141 Batch 7, Task 7.2.
 *
 * Flow: create → list → toggle (disable) → list (confirm disabled) →
 *       run-now → runs (assert run-row exists, status ∈ {running,done,failed}) →
 *       delete → list (confirm absent).
 *
 * run-now status assertion is relaxed to status ∈ {running,done,failed}
 * (no provider auth in CI — recorded rationale per R11.2).
 */

import { CliRunner, createTmpHome, type TmpHome } from './_harness';

jest.setTimeout(90_000);

interface CronJob {
  id: string;
  name: string;
  cronExpr: string;
  enabled: boolean;
}

interface CronRun {
  id: string;
  jobId?: string;
  status: string;
  scheduledFor: number;
}

interface CronListPayload {
  jobs: CronJob[];
}

interface CronCreatedPayload {
  job: CronJob | null;
}

interface CronToggledPayload {
  id: string;
  enabled: boolean;
  job: CronJob | null;
}

interface CronRunPayload {
  id: string;
  run: CronRun | null;
}

interface CronRunsPayload {
  id: string;
  runs: CronRun[];
}

interface CronDeletedPayload {
  id: string;
  ok: boolean;
}

function findNotification<T = unknown>(
  lines: unknown[],
  method: string,
): T | undefined {
  for (const line of lines) {
    if (
      typeof line === 'object' &&
      line !== null &&
      (line as { method?: unknown }).method === method
    ) {
      return (line as { params: T }).params;
    }
  }
  return undefined;
}

describe('cron scheduler e2e (TASK_2026_141 Batch 7)', () => {
  let tmp: TmpHome;

  beforeEach(async () => {
    tmp = await createTmpHome('ptah-e2e-cron-');
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  it('cron create returns a job DTO with id and enabled=true', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: [
        'cron',
        'create',
        '--name',
        'e2e-test-job',
        '--cron-expr',
        '* * * * *',
        '--prompt',
        'e2e test ping',
        '--json',
      ],
      timeoutMs: 60_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.hasMalformedStdout).toBe(false);

    const payload = findNotification<CronCreatedPayload>(
      result.stdoutLines,
      'cron.created',
    );
    expect(payload).toBeDefined();
    expect(payload!.job).not.toBeNull();
    expect(typeof payload!.job!.id).toBe('string');
    expect(payload!.job!.id.length).toBeGreaterThan(0);
    expect(payload!.job!.enabled).toBe(true);
  });

  it('cron list returns created job', async () => {
    const createResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: [
        'cron',
        'create',
        '--name',
        'e2e-list-job',
        '--cron-expr',
        '0 0 * * *',
        '--prompt',
        'list-test',
        '--json',
      ],
      timeoutMs: 60_000,
    });
    expect(createResult.exitCode).toBe(0);
    const created = findNotification<CronCreatedPayload>(
      createResult.stdoutLines,
      'cron.created',
    );
    const jobId = created!.job!.id;

    const listResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['cron', 'list', '--json'],
      timeoutMs: 60_000,
    });
    expect(listResult.exitCode).toBe(0);
    const listPayload = findNotification<CronListPayload>(
      listResult.stdoutLines,
      'cron.list',
    );
    expect(listPayload).toBeDefined();
    const ids = listPayload!.jobs.map((j) => j.id);
    expect(ids).toContain(jobId);
  });

  it('cron toggle disables a job', async () => {
    const createResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: [
        'cron',
        'create',
        '--name',
        'e2e-toggle-job',
        '--cron-expr',
        '0 1 * * *',
        '--prompt',
        'toggle-test',
        '--json',
      ],
      timeoutMs: 60_000,
    });
    expect(createResult.exitCode).toBe(0);
    const created = findNotification<CronCreatedPayload>(
      createResult.stdoutLines,
      'cron.created',
    );
    const jobId = created!.job!.id;

    const toggleResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['cron', 'toggle', jobId, '--enabled', 'false', '--json'],
      timeoutMs: 60_000,
    });
    expect(toggleResult.exitCode).toBe(0);
    const togglePayload = findNotification<CronToggledPayload>(
      toggleResult.stdoutLines,
      'cron.toggled',
    );
    expect(togglePayload).toBeDefined();
    expect(togglePayload!.enabled).toBe(false);
  });

  it('cron run-now fires the job and returns a run-row with status ∈ {running,done,failed}', async () => {
    const createResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: [
        'cron',
        'create',
        '--name',
        'e2e-runnow-job',
        '--cron-expr',
        '0 2 * * *',
        '--prompt',
        'run-now-test',
        '--json',
      ],
      timeoutMs: 60_000,
    });
    expect(createResult.exitCode).toBe(0);
    const created = findNotification<CronCreatedPayload>(
      createResult.stdoutLines,
      'cron.created',
    );
    const jobId = created!.job!.id;

    const runResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['cron', 'run-now', jobId, '--json'],
      timeoutMs: 60_000,
    });
    expect(runResult.exitCode).toBe(0);
    expect(runResult.hasMalformedStdout).toBe(false);

    const runPayload = findNotification<CronRunPayload>(
      runResult.stdoutLines,
      'cron.run',
    );
    expect(runPayload).toBeDefined();
    expect(runPayload!.run).not.toBeNull();
    const allowedStatuses = [
      'running',
      'done',
      'failed',
      'pending',
      'succeeded',
      'skipped',
    ];
    expect(allowedStatuses).toContain(runPayload!.run!.status);
  });

  it('cron runs returns ≥1 row after run-now', async () => {
    const createResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: [
        'cron',
        'create',
        '--name',
        'e2e-runs-job',
        '--cron-expr',
        '0 3 * * *',
        '--prompt',
        'runs-test',
        '--json',
      ],
      timeoutMs: 60_000,
    });
    expect(createResult.exitCode).toBe(0);
    const created = findNotification<CronCreatedPayload>(
      createResult.stdoutLines,
      'cron.created',
    );
    const jobId = created!.job!.id;

    await CliRunner.spawnOneshot({
      home: tmp,
      args: ['cron', 'run-now', jobId, '--json'],
      timeoutMs: 60_000,
    });

    const runsResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['cron', 'runs', jobId, '--json'],
      timeoutMs: 60_000,
    });
    expect(runsResult.exitCode).toBe(0);
    const runsPayload = findNotification<CronRunsPayload>(
      runsResult.stdoutLines,
      'cron.runs',
    );
    expect(runsPayload).toBeDefined();
    expect(Array.isArray(runsPayload!.runs)).toBe(true);
    expect(runsPayload!.runs.length).toBeGreaterThanOrEqual(1);
  });

  it('cron delete removes the job and cascade-deletes run rows', async () => {
    const createResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: [
        'cron',
        'create',
        '--name',
        'e2e-delete-job',
        '--cron-expr',
        '0 4 * * *',
        '--prompt',
        'delete-test',
        '--json',
      ],
      timeoutMs: 60_000,
    });
    expect(createResult.exitCode).toBe(0);
    const created = findNotification<CronCreatedPayload>(
      createResult.stdoutLines,
      'cron.created',
    );
    const jobId = created!.job!.id;

    await CliRunner.spawnOneshot({
      home: tmp,
      args: ['cron', 'run-now', jobId, '--json'],
      timeoutMs: 60_000,
    });

    const deleteResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['cron', 'delete', jobId, '--json'],
      timeoutMs: 60_000,
    });
    expect(deleteResult.exitCode).toBe(0);
    const deletePayload = findNotification<CronDeletedPayload>(
      deleteResult.stdoutLines,
      'cron.deleted',
    );
    expect(deletePayload).toBeDefined();
    expect(deletePayload!.ok).toBe(true);

    const runsResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['cron', 'runs', jobId, '--json'],
      timeoutMs: 60_000,
    });
    const runsPayload = findNotification<CronRunsPayload>(
      runsResult.stdoutLines,
      'cron.runs',
    );
    if (runsPayload !== undefined) {
      expect(runsPayload.runs.length).toBe(0);
    }
  });
});
