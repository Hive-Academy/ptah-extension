import 'reflect-metadata';
import {
  MAX_FINISHED_RUN_CHECK_JOBS,
  RUN_CHECK_RESULT_TTL_MS,
  createRunCheckJobRegistry,
} from './run-check-jobs';
import type { RunCheckOutcome } from './run-check.tool';
import { RunCheckArgsSchema } from './wait-tools-args.schema';

const args = RunCheckArgsSchema.parse({ project: 'app', targets: ['lint'] });
const owner = 'c:/ws||agent';

function outcome(): RunCheckOutcome {
  return {
    isError: false,
    text: 'done',
    logPath: 'c:/ws/.ptah/tmp/checks/check.log',
    structured: {
      cwd: 'c:/ws',
      project: 'app',
      targets: ['lint'],
      verdict: 'passed',
      exitCode: 0,
      logPath: 'c:/ws/.ptah/tmp/checks/check.log',
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('run check jobs', () => {
  it('attaches the same caller/check, but hides a different caller busy job', async () => {
    const registry = createRunCheckJobRegistry();
    const done = deferred<RunCheckOutcome>();
    const start = registry.start(
      args,
      'c:/ws',
      owner,
      async () => done.promise,
    );
    expect('job' in start).toBe(true);
    if (!('job' in start)) return;
    expect(
      registry.start(args, 'c:/ws', owner, async () => done.promise),
    ).toMatchObject({
      job: { id: start.job.id },
      attached: true,
    });
    expect(
      registry.start(
        { ...args, project: 'other' },
        'c:/ws',
        owner,
        async () => done.promise,
      ),
    ).toMatchObject({ busy: { id: start.job.id }, external: false });
    expect(
      registry.start(args, 'c:/ws', 'elsewhere', async () => done.promise),
    ).toMatchObject({ busy: undefined, external: true });
    done.resolve(outcome());
    await start.job.done;
  });

  it('lets an aborted caller stop waiting without stopping the job', async () => {
    const registry = createRunCheckJobRegistry();
    const done = deferred<RunCheckOutcome>();
    let jobSignal: AbortSignal | undefined;
    const start = registry.start(args, 'c:/ws', owner, async (signal) => {
      jobSignal = signal;
      return done.promise;
    });
    if (!('job' in start)) return;
    const waiting = new AbortController();
    const result = registry.waitFor(start.job, 10_000, waiting.signal);
    waiting.abort();
    await expect(result).resolves.toBeUndefined();
    expect(jobSignal?.aborted).toBe(false);
    done.resolve(outcome());
    await expect(start.job.done).resolves.toEqual(outcome());
  });

  it('cancels only on explicit cancellation and stores repeatable finished results', async () => {
    const registry = createRunCheckJobRegistry();
    const done = deferred<RunCheckOutcome>();
    let signal!: AbortSignal;
    const start = registry.start(args, 'c:/ws', owner, async (next) => {
      signal = next;
      return done.promise;
    });
    if (!('job' in start)) return;
    await Promise.resolve();
    registry.cancel(start.job);
    expect(signal.aborted).toBe(true);
    done.resolve(outcome());
    await start.job.done;
    expect(await registry.waitFor(start.job, 0)).toEqual(outcome());
    expect(registry.get(start.job.id, 'other')).toBeUndefined();
  });

  it('releases the busy slot after rejected and synchronously throwing runs', async () => {
    const registry = createRunCheckJobRegistry();
    const rejected = registry.start(args, 'c:/ws', owner, async () => {
      throw new Error('rejected');
    });
    if (!('job' in rejected)) throw new Error('expected a job');
    await expect(rejected.job.done).resolves.toMatchObject({
      structured: { verdict: 'not_run' },
    });
    const afterRejected = registry.start(args, 'c:/ws', owner, () => {
      throw new Error('synchronous');
    });
    if (!('job' in afterRejected)) throw new Error('expected a job');
    await expect(afterRejected.job.done).resolves.toMatchObject({
      structured: { verdict: 'not_run' },
    });
    expect(
      registry.start(args, 'c:/ws', owner, async () => outcome()),
    ).toMatchObject({
      attached: false,
    });
  });

  it('does not attach a same-owner check while cancellation is settling', async () => {
    const registry = createRunCheckJobRegistry();
    const done = deferred<RunCheckOutcome>();
    const first = registry.start(
      args,
      'c:/ws',
      owner,
      async () => done.promise,
    );
    if (!('job' in first)) throw new Error('expected a job');
    registry.cancel(first.job);
    expect(
      registry.start(args, 'c:/ws', owner, async () => outcome()),
    ).toMatchObject({
      busy: { id: first.job.id },
      external: false,
    });
    done.resolve({
      ...outcome(),
      structured: { ...outcome().structured, verdict: 'cancelled' },
    });
    await first.job.done;
    const restarted = registry.start(args, 'c:/ws', owner, async () =>
      outcome(),
    );
    expect(restarted).toMatchObject({ attached: false });
    if ('job' in restarted) await restarted.job.done;
  });

  it('leaves no timeout or abort listener after an aborted collection wait', async () => {
    jest.useFakeTimers();
    try {
      const registry = createRunCheckJobRegistry();
      const done = deferred<RunCheckOutcome>();
      const start = registry.start(
        args,
        'c:/ws',
        owner,
        async () => done.promise,
      );
      if (!('job' in start)) throw new Error('expected a job');
      const caller = new AbortController();
      const waiting = registry.waitFor(start.job, 10_000, caller.signal);
      caller.abort();
      await expect(waiting).resolves.toBeUndefined();
      expect(jest.getTimerCount()).toBe(0);
      done.resolve(outcome());
      await start.job.done;
    } finally {
      jest.useRealTimers();
    }
  });

  it('expires old results and evicts the oldest after sixteen', async () => {
    let clock = 0;
    const registry = createRunCheckJobRegistry(() => clock);
    const ids: string[] = [];
    for (let i = 0; i < MAX_FINISHED_RUN_CHECK_JOBS + 1; i++) {
      const start = registry.start(
        { ...args, project: `app-${i}` },
        'c:/ws',
        owner,
        async () => outcome(),
      );
      if (!('job' in start)) throw new Error('expected a job');
      ids.push(start.job.id);
      await start.job.done;
      clock++;
    }
    expect(registry.get(ids[0], owner)).toBeUndefined();
    expect(registry.get(ids.at(-1)!, owner)).toBeDefined();
    clock += RUN_CHECK_RESULT_TTL_MS + 1;
    expect(registry.get(ids.at(-1)!, owner)).toBeUndefined();
  });
});
