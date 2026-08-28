/**
 * `ts-diagnostics-worker.spec.ts` — TASK_2026_325 finding 6.
 *
 * `TsDiagnosticsWorker` had no spec of its own. Everything that reached it went
 * through `type-script-diagnostics-provider.spec.ts`, which drives real
 * fixtures through a real compiler — excellent coverage of the HAPPY path and
 * no coverage at all of the paths this class exists for. A worker `error`
 * event, a non-zero `exit`, a run that never answers, a second workspace
 * arriving with a different compiler, a `dispose()` landing mid-run: each is a
 * transition of a state machine, and none of them is reachable from a fixture.
 * Finding 4 (a cross-compiler replacement killing an unrelated in-flight run)
 * lived in exactly that blind spot.
 *
 * So `node:worker_threads` is mocked here. This is deliberately the inverse of
 * the provider spec's choice: that suite proves the compile is real, this one
 * proves the lifecycle is correct, and neither can do the other's job. A real
 * thread cannot be made to emit `error` on demand, and `RUN_TIMEOUT_MS` is five
 * minutes.
 */

import { Worker } from 'node:worker_threads';
import { TsDiagnosticsWorker } from './ts-diagnostics-worker';
import { TS_DIAGNOSTICS_WORKER_SOURCE } from './ts-diagnostics-worker-source';

jest.mock('node:worker_threads', () => {
  const { EventEmitter } =
    jest.requireActual<typeof import('node:events')>('node:events');

  class MockWorker extends EventEmitter {
    static instances: MockWorker[] = [];

    readonly posted: Array<Record<string, unknown>> = [];
    readonly workerData: { tsModulePath: string };
    terminateCalls = 0;
    refCalls = 0;
    unrefCalls = 0;
    /** When true, `terminate()` stays pending until `finishTerminate()`. */
    holdTerminate = false;
    private releaseTerminate: (() => void) | null = null;

    constructor(
      readonly source: string,
      options: { eval?: boolean; workerData?: { tsModulePath: string } },
    ) {
      super();
      this.workerData = options.workerData ?? { tsModulePath: '' };
      MockWorker.instances.push(this);
    }

    postMessage(message: Record<string, unknown>): void {
      this.posted.push(message);
    }

    ref(): void {
      this.refCalls += 1;
    }

    unref(): void {
      this.unrefCalls += 1;
    }

    terminate(): Promise<number> {
      this.terminateCalls += 1;
      if (!this.holdTerminate) return Promise.resolve(0);
      return new Promise<number>((resolve) => {
        this.releaseTerminate = () => resolve(0);
      });
    }

    finishTerminate(): void {
      this.releaseTerminate?.();
      this.releaseTerminate = null;
    }
  }

  return { Worker: MockWorker };
});

/** The mock's surface, as this spec drives it. */
interface MockWorkerInstance {
  emit(event: string, payload?: unknown): boolean;
  readonly posted: Array<Record<string, unknown>>;
  readonly workerData: { tsModulePath: string };
  readonly source: string;
  terminateCalls: number;
  refCalls: number;
  unrefCalls: number;
  holdTerminate: boolean;
  finishTerminate(): void;
}

const WorkerMock = Worker as unknown as { instances: MockWorkerInstance[] };

/** Let every already-queued microtask and immediate run. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function request(tsModulePath: string, root = '/ws') {
  return {
    tsModulePath,
    configPaths: [`${root}/tsconfig.json`],
    normRoot: root,
    platform: 'linux' as NodeJS.Platform,
  };
}

function idOf(instance: MockWorkerInstance): number {
  return instance.posted[instance.posted.length - 1]['id'] as number;
}

function reply(instance: MockWorkerInstance, programCount = 1): void {
  instance.emit('message', {
    id: idOf(instance),
    ok: true,
    collected: [],
    errors: [],
    programCount,
  });
}

describe('TsDiagnosticsWorker', () => {
  let sut: TsDiagnosticsWorker;

  beforeEach(() => {
    WorkerMock.instances.length = 0;
    sut = new TsDiagnosticsWorker();
  });

  afterEach(async () => {
    for (const instance of WorkerMock.instances) {
      instance.holdTerminate = false;
      instance.finishTerminate();
    }
    await sut.dispose();
    jest.useRealTimers();
  });

  it('spawns one worker bound to the requested compiler and resolves its reply', async () => {
    const run = sut.run(request('/compilers/a/typescript.js'));
    const [instance] = WorkerMock.instances;

    expect(WorkerMock.instances).toHaveLength(1);
    expect(instance.workerData.tsModulePath).toBe('/compilers/a/typescript.js');
    expect(instance.posted[0]['normRoot']).toBe('/ws');

    instance.emit('message', {
      id: idOf(instance),
      ok: true,
      collected: [
        {
          file: '/ws/src/a.ts',
          line: 3,
          severity: 'error',
          code: 2322,
          message: 'nope',
        },
      ],
      errors: [{ config: '/ws/tsconfig.bad.json', message: 'Malformed' }],
      programCount: 2,
    });

    await expect(run).resolves.toEqual({
      collected: [
        {
          file: '/ws/src/a.ts',
          line: 3,
          severity: 'error',
          code: 2322,
          message: 'nope',
        },
      ],
      errors: [{ config: '/ws/tsconfig.bad.json', message: 'Malformed' }],
      programCount: 2,
    });
  });

  it('reuses one worker for repeated runs on the same compiler', async () => {
    const first = sut.run(request('/compilers/a/typescript.js'));
    reply(WorkerMock.instances[0]);
    await first;

    const second = sut.run(request('/compilers/a/typescript.js'));
    reply(WorkerMock.instances[0]);
    await second;

    expect(WorkerMock.instances).toHaveLength(1);
  });

  it('rejects a run that the worker answers with ok:false', async () => {
    const run = sut.run(request('/compilers/a/typescript.js'));
    const [instance] = WorkerMock.instances;

    instance.emit('message', {
      id: idOf(instance),
      ok: false,
      error: 'the compiler threw',
    });

    await expect(run).rejects.toThrow('the compiler threw');
  });

  describe('worker death', () => {
    it("an 'error' event rejects the outstanding run and terminates the thread", async () => {
      const run = sut.run(request('/compilers/a/typescript.js'));
      const [instance] = WorkerMock.instances;

      instance.emit('error', new Error('worker blew up'));

      await expect(run).rejects.toThrow('worker blew up');
      expect(instance.terminateCalls).toBe(1);
    });

    it("a non-zero 'exit' rejects the outstanding run and names the code", async () => {
      const run = sut.run(request('/compilers/a/typescript.js'));
      const [instance] = WorkerMock.instances;

      instance.emit('exit', 3);

      await expect(run).rejects.toThrow(
        'TypeScript diagnostics worker exited with code 3.',
      );
      // The thread is already gone; terminating a corpse is not the fix.
      expect(instance.terminateCalls).toBe(0);
    });

    it('a dead worker is replaced on the next run rather than reused', async () => {
      const first = sut.run(request('/compilers/a/typescript.js'));
      WorkerMock.instances[0].emit('exit', 1);
      await expect(first).rejects.toThrow('exited with code 1');

      const second = sut.run(request('/compilers/a/typescript.js'));
      expect(WorkerMock.instances).toHaveLength(2);

      reply(WorkerMock.instances[1]);
      await expect(second).resolves.toEqual({
        collected: [],
        errors: [],
        programCount: 1,
      });
    });
  });

  describe('run timeout', () => {
    it('rejects after RUN_TIMEOUT_MS and terminates the wedged thread', async () => {
      jest.useFakeTimers();
      const run = sut.run(request('/compilers/a/typescript.js'));
      const settled = expect(run).rejects.toThrow(
        'TypeScript diagnostics run exceeded 300000ms and the worker was terminated.',
      );

      jest.advanceTimersByTime(300_000);

      await settled;
      expect(WorkerMock.instances[0].terminateCalls).toBe(1);
    });

    it('a sibling queued on the same thread is told why it died, not that it timed out', async () => {
      jest.useFakeTimers();
      const wedged = sut.run(request('/compilers/a/typescript.js', '/wsA'));
      const sibling = sut.run(request('/compilers/a/typescript.js', '/wsB'));
      const settled = Promise.all([
        expect(wedged).rejects.toThrow('exceeded 300000ms'),
        expect(sibling).rejects.toThrow(
          'terminated because another run on it timed out',
        ),
      ]);

      jest.advanceTimersByTime(300_000);

      await settled;
    });

    it('a timed-out run does not poison the compiler: the next run gets a fresh worker', async () => {
      jest.useFakeTimers();
      const timedOut = sut.run(request('/compilers/a/typescript.js'));
      const settled = expect(timedOut).rejects.toThrow('exceeded 300000ms');
      jest.advanceTimersByTime(300_000);
      await settled;

      const next = sut.run(request('/compilers/a/typescript.js'));
      expect(WorkerMock.instances).toHaveLength(2);
      reply(WorkerMock.instances[1]);
      await expect(next).resolves.toMatchObject({ programCount: 1 });
    });
  });

  describe('two compilers (TASK_2026_325 finding 4)', () => {
    it('gives each compiler its own worker instead of replacing the running one', async () => {
      const runA = sut.run(request('/compilers/a/typescript.js', '/wsA'));
      const runB = sut.run(request('/compilers/b/typescript.js', '/wsB'));

      expect(WorkerMock.instances).toHaveLength(2);
      const [workerA, workerB] = WorkerMock.instances;
      expect(workerA.workerData.tsModulePath).toBe(
        '/compilers/a/typescript.js',
      );
      expect(workerB.workerData.tsModulePath).toBe(
        '/compilers/b/typescript.js',
      );
      // The whole point: A's in-flight compile survives B's arrival.
      expect(workerA.terminateCalls).toBe(0);

      reply(workerB, 7);
      reply(workerA, 5);

      await expect(runA).resolves.toMatchObject({ programCount: 5 });
      await expect(runB).resolves.toMatchObject({ programCount: 7 });
    });

    it('a failing compiler only takes down its own worker', async () => {
      const runA = sut.run(request('/compilers/a/typescript.js', '/wsA'));
      const runB = sut.run(request('/compilers/b/typescript.js', '/wsB'));
      const [workerA, workerB] = WorkerMock.instances;

      workerB.emit('error', new Error('B is broken'));

      await expect(runB).rejects.toThrow('B is broken');
      expect(workerA.terminateCalls).toBe(0);

      reply(workerA, 4);
      await expect(runA).resolves.toMatchObject({ programCount: 4 });
    });
  });

  describe('dispose', () => {
    it('rejects an in-flight run and resolves only once the thread is gone', async () => {
      const run = sut.run(request('/compilers/a/typescript.js'));
      const [instance] = WorkerMock.instances;
      instance.holdTerminate = true;

      let disposeResolved = false;
      const disposal = sut.dispose().then(() => {
        disposeResolved = true;
      });

      await expect(run).rejects.toThrow(
        'TypeScript diagnostics worker was disposed.',
      );
      await flush();
      // `Worker.terminate()` is asynchronous. Resolving before it settles is
      // what makes Jest report a worker that "failed to exit gracefully".
      expect(disposeResolved).toBe(false);

      instance.finishTerminate();
      await disposal;
      expect(disposeResolved).toBe(true);
    });

    it('waits for a termination that a worker error started earlier', async () => {
      const run = sut.run(request('/compilers/a/typescript.js'));
      const [instance] = WorkerMock.instances;
      instance.holdTerminate = true;

      instance.emit('error', new Error('died mid-compile'));
      await expect(run).rejects.toThrow('died mid-compile');

      let disposeResolved = false;
      const disposal = sut.dispose().then(() => {
        disposeResolved = true;
      });
      await flush();
      expect(disposeResolved).toBe(false);

      instance.finishTerminate();
      await disposal;
      expect(disposeResolved).toBe(true);
    });

    it('terminates every live worker, not just the most recent', async () => {
      const runA = sut.run(request('/compilers/a/typescript.js', '/wsA'));
      const runB = sut.run(request('/compilers/b/typescript.js', '/wsB'));
      const [workerA, workerB] = WorkerMock.instances;
      const settled = Promise.all([
        expect(runA).rejects.toThrow('disposed'),
        expect(runB).rejects.toThrow('disposed'),
      ]);

      await sut.dispose();
      await settled;

      expect(workerA.terminateCalls).toBe(1);
      expect(workerB.terminateCalls).toBe(1);
    });

    it('is idempotent with nothing running', async () => {
      await expect(sut.dispose()).resolves.toBeUndefined();
      await expect(sut.dispose()).resolves.toBeUndefined();
      expect(WorkerMock.instances).toHaveLength(0);
    });
  });

  /**
   * The worker program is carried in a `String.raw` template, so a backtick or
   * a `$`-brace in it silently stops being program text and starts being
   * interpolation. Nothing else in the toolchain checks this: the body is not
   * type-checked, not linted, and a broken template still compiles.
   */
  it('the worker source stays a valid String.raw payload', () => {
    expect(TS_DIAGNOSTICS_WORKER_SOURCE).not.toContain('`');
    expect(TS_DIAGNOSTICS_WORKER_SOURCE).not.toContain('${');
    expect(TS_DIAGNOSTICS_WORKER_SOURCE).toContain('parentPort.on(');
  });

  it('refs the worker for a run and unrefs it once idle, so it never holds the host open', async () => {
    const run = sut.run(request('/compilers/a/typescript.js'));
    const [instance] = WorkerMock.instances;

    // One unref at construction, one ref for the outstanding run.
    expect(instance.refCalls).toBe(1);
    expect(instance.unrefCalls).toBe(1);

    reply(instance);
    await run;

    expect(instance.unrefCalls).toBe(2);
  });
});
