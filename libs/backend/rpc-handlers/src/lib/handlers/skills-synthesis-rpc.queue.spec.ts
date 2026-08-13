/**
 * `skillSynthesis:queue` — criterion P0-7, backend half.
 *
 * P0-7 as written ("`JobRun` rows visible in Activity") is not assertable: it
 * spans two processes and "visible" is not a predicate. The restatement splits
 * it in two, and this file is the first half — the method returns the seeded
 * queue rows AND the seeded drain runs. The component half lives in
 * `skill-synthesis-ui/.../skill-pipeline-status.component.spec.ts` (batch B0.7).
 */
import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import { SKILL_SYNTHESIS_TOKENS } from '@ptah-extension/skill-synthesis';
import { CRON_TOKENS } from '@ptah-extension/cron-scheduler';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import {
  SKILL_DRAIN_JOB_IDS,
  type SkillSynthesisQueueResult,
} from '@ptah-extension/shared';
import { SkillsSynthesisRpcHandlers } from './skills-synthesis-rpc.handlers';

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  };
}

function makeRpcHandler() {
  const methods = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    registerMethod: jest.fn(
      (name: string, fn: (p: unknown) => Promise<unknown>) => {
        methods.set(name, fn);
      },
    ),
    call: async (name: string, params: unknown) => {
      const fn = methods.get(name);
      if (!fn) throw new Error(`No handler registered for ${name}`);
      return fn(params);
    },
  };
}

/** A full `skill_synthesis_queue` row as `SkillQueueStore.listRecent` returns it. */
function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '01JQ0000000000000000000001',
    sessionId: 'session-a',
    workspaceRoot: 'D:/projects/demo',
    transcriptPath: null,
    source: 'session-end',
    stage: 'prefilter',
    dependsOn: null,
    status: 'queued',
    turnCount: 12,
    attemptCount: 0,
    enqueuedAt: 1_700_000_000_000,
    notBefore: 0,
    claimedBy: null,
    claimedAt: null,
    finishedAt: null,
    lane: null,
    reason: null,
    lastError: null,
    candidateId: null,
    payload: {},
    ...overrides,
  };
}

/** A `job_runs` row as `CronScheduler.listRuns` returns it. */
function jobRun(jobId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `run-${jobId}`,
    jobId,
    scheduledFor: 1_700_000_000_000,
    startedAt: 1_700_000_000_100,
    endedAt: 1_700_000_002_100,
    status: 'succeeded',
    resultSummary: 'drained 3 items',
    errorMessage: null,
    ...overrides,
  };
}

interface BuildOptions {
  rows?: ReturnType<typeof queueRow>[];
  runsByJobId?: Record<string, ReturnType<typeof jobRun>[]>;
  /** Omit the cron scheduler entirely — the "cron failed to boot" host. */
  withCron?: boolean;
}

function buildHandlers(opts: BuildOptions = {}) {
  const rows = opts.rows ?? [];
  const runsByJobId = opts.runsByJobId ?? {};
  const withCron = opts.withCron ?? true;

  const logger = makeLogger();
  const rpcHandler = makeRpcHandler();
  const sentry = { captureException: jest.fn() };
  const queueStore = { listRecent: jest.fn().mockReturnValue(rows) };
  const cron = {
    listRuns: jest.fn((jobId: string) => runsByJobId[jobId] ?? []),
  };

  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, logger);
  child.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
  child.registerInstance(TOKENS.SENTRY_SERVICE, sentry);
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE, {
    readSettings: jest.fn().mockReturnValue({}),
  });
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE, {
    listByStatus: jest.fn().mockReturnValue([]),
    getStats: jest.fn().mockReturnValue({
      candidates: 0,
      promoted: 0,
      rejected: 0,
      invocations: 0,
    }),
    getInvocationStats: jest.fn(),
  });
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_DIAGNOSTICS_SERVICE, {
    getSnapshot: jest.fn(),
  });
  child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_QUEUE_STORE, queueStore);
  if (withCron) {
    child.registerInstance(CRON_TOKENS.CRON_SCHEDULER, cron);
  }
  child.registerInstance(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    createMockWorkspaceProvider({ folders: ['D:/projects/demo'] }),
  );
  child.register(SkillsSynthesisRpcHandlers, {
    useClass: SkillsSynthesisRpcHandlers,
  });

  const handlers = child.resolve(SkillsSynthesisRpcHandlers);
  handlers.register();

  const call = (params?: unknown) =>
    rpcHandler.call(
      'skillSynthesis:queue',
      params,
    ) as Promise<SkillSynthesisQueueResult>;

  return { call, queueStore, cron, logger, sentry };
}

describe('skillSynthesis:queue — queue items', () => {
  it('returns the seeded rows in wire shape', async () => {
    const { call } = buildHandlers({
      rows: [
        queueRow({
          id: 'q-1',
          stage: 'synthesis',
          status: 'unscored',
          attemptCount: 2,
          notBefore: 1_700_000_600_000,
          lane: 'synthesis',
          reason: 'Lane synthesis: provider auth unavailable',
        }),
      ],
    });

    const result = await call();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      id: 'q-1',
      sessionId: 'session-a',
      workspaceRoot: 'D:/projects/demo',
      stage: 'synthesis',
      status: 'unscored',
      attemptCount: 2,
      enqueuedAt: 1_700_000_000_000,
      notBefore: 1_700_000_600_000,
      finishedAt: null,
      lane: 'synthesis',
      reason: 'Lane synthesis: provider auth unavailable',
      candidateId: null,
    });
  });

  /**
   * The point of the whole restatement: a stalled item must EXPLAIN itself.
   * `reason` is the authored sentence; it is the field B0.7 renders.
   */
  it('surfaces the stall reason and the attempt count together', async () => {
    const { call } = buildHandlers({
      rows: [
        queueRow({
          status: 'queued',
          attemptCount: 4,
          reason: 'judge failed, will retry',
        }),
      ],
    });

    const [item] = (await call()).items;

    expect(item.reason).toBe('judge failed, will retry');
    expect(item.attemptCount).toBe(4);
  });

  /**
   * `last_error` holds whatever a stage threw. Forwarding it verbatim is the
   * raw-error-message leak the house rule forbids — the short `reason` is the
   * display surface and the full text stays in the log.
   */
  it('never puts the raw stage error on the wire', async () => {
    const { call } = buildHandlers({
      rows: [
        queueRow({
          status: 'failed',
          reason: 'synthesis failed after 5 attempts',
          lastError:
            'AuthenticationError: invalid x-api-key sk-live-DEADBEEF at /home/u/.ptah/creds.json',
        }),
      ],
    });

    const [item] = (await call()).items;

    expect(item).not.toHaveProperty('lastError');
    expect(JSON.stringify(item)).not.toContain('sk-live-DEADBEEF');
    expect(item.reason).toBe('synthesis failed after 5 attempts');
  });

  it('drops the stage scratch payload', async () => {
    const { call } = buildHandlers({
      rows: [queueRow({ payload: { prompt: 'a very long prompt' } })],
    });

    const [item] = (await call()).items;

    expect(item).not.toHaveProperty('payload');
  });
});

describe('skillSynthesis:queue — drain runs', () => {
  it('returns runs from all three tiers, newest scheduled first', async () => {
    const { call } = buildHandlers({
      runsByJobId: {
        [SKILL_DRAIN_JOB_IDS.frequent]: [
          jobRun(SKILL_DRAIN_JOB_IDS.frequent, {
            id: 'r-freq',
            scheduledFor: 3_000,
          }),
        ],
        [SKILL_DRAIN_JOB_IDS.nightly]: [
          jobRun(SKILL_DRAIN_JOB_IDS.nightly, {
            id: 'r-night',
            scheduledFor: 2_000,
          }),
        ],
        [SKILL_DRAIN_JOB_IDS.weekly]: [
          jobRun(SKILL_DRAIN_JOB_IDS.weekly, {
            id: 'r-week',
            scheduledFor: 1_000,
          }),
        ],
      },
    });

    const { recentRuns } = await call();

    expect(recentRuns.map((r) => r.id)).toEqual([
      'r-freq',
      'r-night',
      'r-week',
    ]);
    expect(recentRuns.map((r) => r.tier)).toEqual([
      'frequent',
      'nightly',
      'weekly',
    ]);
  });

  it('carries the status and a computed duration for a finished run', async () => {
    const { call } = buildHandlers({
      runsByJobId: {
        [SKILL_DRAIN_JOB_IDS.frequent]: [
          jobRun(SKILL_DRAIN_JOB_IDS.frequent, {
            startedAt: 1_000,
            endedAt: 3_500,
            status: 'succeeded',
            resultSummary: 'drained 3 items',
          }),
        ],
      },
    });

    const [run] = (await call()).recentRuns;

    expect(run.status).toBe('succeeded');
    expect(run.durationMs).toBe(2_500);
    expect(run.summary).toBe('drained 3 items');
  });

  // A run still in flight has no end. `null` says so; `endedAt - startedAt`
  // would hand the renderer a NaN to format.
  it('reports a null duration for a run still in flight', async () => {
    const { call } = buildHandlers({
      runsByJobId: {
        [SKILL_DRAIN_JOB_IDS.frequent]: [
          jobRun(SKILL_DRAIN_JOB_IDS.frequent, {
            startedAt: 1_000,
            endedAt: null,
            status: 'running',
            resultSummary: null,
          }),
        ],
      },
    });

    const [run] = (await call()).recentRuns;

    expect(run.status).toBe('running');
    expect(run.durationMs).toBeNull();
  });

  it('never puts the job handler error text on the wire', async () => {
    const { call } = buildHandlers({
      runsByJobId: {
        [SKILL_DRAIN_JOB_IDS.nightly]: [
          jobRun(SKILL_DRAIN_JOB_IDS.nightly, {
            status: 'failed',
            resultSummary: null,
            errorMessage: 'ENOENT: no such file or directory, open /secret/db',
          }),
        ],
      },
    });

    const [run] = (await call()).recentRuns;

    expect(run.status).toBe('failed');
    expect(run).not.toHaveProperty('errorMessage');
    expect(JSON.stringify(run)).not.toContain('/secret/db');
  });

  it('returns an empty run feed when no cron scheduler is registered', async () => {
    const { call } = buildHandlers({
      rows: [queueRow()],
      withCron: false,
    });

    const result = await call();

    expect(result.recentRuns).toEqual([]);
    expect(result.items).toHaveLength(1);
  });
});

describe('skillSynthesis:queue — boundary validation', () => {
  it('applies the default limits when called with no params', async () => {
    const { call, queueStore, cron } = buildHandlers();

    await call();

    expect(queueStore.listRecent).toHaveBeenCalledWith(50);
    expect(cron.listRuns).toHaveBeenCalledTimes(3);
    expect(cron.listRuns).toHaveBeenCalledWith(SKILL_DRAIN_JOB_IDS.frequent, {
      limit: 20,
    });
  });

  it('honours caller-supplied limits', async () => {
    const { call, queueStore, cron } = buildHandlers();

    await call({ limit: 5, runLimit: 3 });

    expect(queueStore.listRecent).toHaveBeenCalledWith(5);
    expect(cron.listRuns).toHaveBeenCalledWith(SKILL_DRAIN_JOB_IDS.weekly, {
      limit: 3,
    });
  });

  // The caller is a renderer painting a short list. An unbounded limit would be
  // a way to ask the host to serialize the whole table across the bridge.
  it.each([
    ['limit above the cap', { limit: 5000 }],
    ['runLimit above the cap', { runLimit: 5000 }],
    ['a zero limit', { limit: 0 }],
    ['a non-numeric limit', { limit: 'all' }],
  ])('rejects %s', async (_label, params) => {
    const { call } = buildHandlers();

    await expect(call(params)).rejects.toBeInstanceOf(RpcUserError);
  });

  it('caps the merged run feed at runLimit across all three tiers', async () => {
    const many = (jobId: string) =>
      [5, 4, 3].map((n) =>
        jobRun(jobId, { id: `${jobId}-${n}`, scheduledFor: n * 1_000 }),
      );
    const { call } = buildHandlers({
      runsByJobId: {
        [SKILL_DRAIN_JOB_IDS.frequent]: many(SKILL_DRAIN_JOB_IDS.frequent),
        [SKILL_DRAIN_JOB_IDS.nightly]: many(SKILL_DRAIN_JOB_IDS.nightly),
        [SKILL_DRAIN_JOB_IDS.weekly]: many(SKILL_DRAIN_JOB_IDS.weekly),
      },
    });

    const { recentRuns } = await call({ runLimit: 4 });

    expect(recentRuns).toHaveLength(4);
  });
});

describe('skillSynthesis:queue — failure', () => {
  it('reports a sanitized error when the store throws', async () => {
    const { call, queueStore, sentry } = buildHandlers();
    queueStore.listRecent.mockImplementation(() => {
      throw new Error('SQLITE_CORRUPT: database disk image is malformed');
    });

    await expect(call()).rejects.toThrow(
      'skillSynthesis:queue failed; please try again.',
    );
    expect(sentry.captureException).toHaveBeenCalled();
  });
});
