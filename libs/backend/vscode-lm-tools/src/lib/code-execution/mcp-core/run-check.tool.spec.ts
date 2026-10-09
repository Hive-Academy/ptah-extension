// `./wait-tools-args.schema` takes its wait ceiling from
// `@ptah-extension/cli-agent-runtime`, whose barrel reaches tsyringe
// decorators on import.
import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  NX_ENTRY_CANDIDATES,
  RUN_CHECK_TOOL_NAME,
  buildRunCheckTool,
  formatRunCheckSummary,
  killRunningChecks,
  runCheck,
  runningCheckPids,
  type CheckProcess,
  type RunCheckDependencies,
  type SpawnCheckProcess,
} from './run-check.tool';
import { runCheckJobs } from './run-check-jobs';
import {
  RunCheckArgsSchema,
  WAIT_SUMMARY_MAX_CHARS,
} from './wait-tools-args.schema';

/** A child process whose output and exit the test drives. */
class FakeProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid: number | undefined;
  /** `null`: a launch that failed before the OS assigned a pid. */
  constructor(pid: number | null = 4242) {
    super();
    this.pid = pid ?? undefined;
  }
  finish(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit('close', code, signal));
  }
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ptah-run-check-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

it('dispose aborts an HTTP job still launching before it has a pid', async () => {
  let signal: AbortSignal | undefined;
  let resolve!: (value: import('./run-check.tool').RunCheckOutcome) => void;
  const done = new Promise<import('./run-check.tool').RunCheckOutcome>(
    (next) => {
      resolve = next;
    },
  );
  const started = runCheckJobs.start(
    args({ project: 'app', targets: ['lint'] }),
    root,
    'dispose-launch',
    async (next) => {
      signal = next;
      return done;
    },
  );
  if (!('job' in started)) throw new Error('expected a job');
  await Promise.resolve();
  await killRunningChecks();
  expect(signal?.aborted).toBe(true);
  resolve({
    isError: false,
    text: 'cancelled before spawn',
    structured: {
      cwd: root,
      project: 'app',
      targets: ['lint'],
      verdict: 'cancelled',
      exitCode: null,
    },
  });
  await started.job.done;
});

function installNx(script: string, candidate = 0): string {
  const entry = join(root, ...NX_ENTRY_CANDIDATES[candidate]);
  mkdirSync(join(entry, '..'), { recursive: true });
  writeFileSync(entry, script);
  return entry;
}

/** Resolve once the tool has launched its process and armed its listeners. */
async function untilSpawned(spawnProcess: jest.Mock): Promise<void> {
  // The tool checks for Nx and opens its log (real disk I/O) before it
  // launches; poll on setImmediate, which the timeout test leaves unfaked.
  const deadline = Date.now() + 5_000;
  while (spawnProcess.mock.calls.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setImmediate(r));
  }
  expect(spawnProcess).toHaveBeenCalled();
  await new Promise((r) => setImmediate(r));
}

function args(input: Record<string, unknown>) {
  return RunCheckArgsSchema.parse(input);
}

function fakeDeps(
  child: FakeProcess,
  overrides: Partial<RunCheckDependencies> = {},
): RunCheckDependencies & { spawnProcess: jest.Mock } {
  const spawnProcess = jest.fn(() => child as unknown as CheckProcess);
  return {
    workspaceRoot: root,
    spawnProcess: spawnProcess as unknown as SpawnCheckProcess,
    killTree: jest.fn(async () => undefined),
    ...overrides,
  } as RunCheckDependencies & { spawnProcess: jest.Mock };
}

describe('buildRunCheckTool', () => {
  it('advertises the name, the targets and the 900 s ceiling', () => {
    const tool = buildRunCheckTool();
    expect(tool.name).toBe(RUN_CHECK_TOOL_NAME);
    expect(tool.inputSchema.required).toEqual(['project', 'targets']);
    // Matches the `.strict()` RunCheckArgsSchema: unknown keys are rejected.
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.inputSchema.properties['timeoutSec']).toMatchObject({
      maximum: 900,
    });
    expect(tool.inputSchema.properties['targets']).toMatchObject({
      items: { enum: ['test', 'lint', 'typecheck', 'build'] },
    });
  });

  it('limits worktrees to open workspace folders and makes no openWorldHint claim', () => {
    const tool = buildRunCheckTool();
    expect(tool.description).toContain(
      'worktrees inside an open workspace folder',
    );
    expect(tool.description).not.toContain('(worktrees too)');
    expect(tool.annotations).toEqual({ destructiveHint: false });
  });
});

describe('runCheck', () => {
  it('returns an error naming every path tried when Nx is missing, and spawns nothing', async () => {
    const child = new FakeProcess();
    const d = fakeDeps(child);
    const outcome = await runCheck(
      args({ project: 'app', targets: ['test'] }),
      d,
    );

    expect(outcome.isError).toBe(true);
    for (const parts of NX_ENTRY_CANDIDATES) {
      expect(outcome.text).toContain(join(root, ...parts));
    }
    expect(outcome.text).toContain(
      'a worktree needs its own install or a node_modules link',
    );
    expect(d.spawnProcess).not.toHaveBeenCalled();
    expect(outcome.structured).toMatchObject({
      cwd: root,
      verdict: 'not_run',
      exitCode: null,
    });
  });

  it('runs node with an argument array in the workspace root, never a shell string', async () => {
    const entry = installNx('', 1);
    const child = new FakeProcess();
    const d = fakeDeps(child);
    const pending = runCheck(
      args({ project: '@scope/lib', targets: ['lint', 'typecheck'] }),
      d,
    );
    await untilSpawned(d.spawnProcess);
    child.finish(0);
    const outcome = await pending;

    expect(d.spawnProcess).toHaveBeenCalledWith(
      'node',
      [
        entry,
        'run-many',
        '-t',
        'lint,typecheck',
        '-p',
        '@scope/lib',
        '--outputStyle=static',
      ],
      expect.objectContaining({ cwd: root }),
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain('PASSED (exit 0)');
    expect(outcome.text).toContain(`Ran in: ${root}`);
    expect(outcome.text).toContain('- lint: passed');
    expect(outcome.logPath).toMatch(/checks[\\/].+-_scope_lib\.log$/);
    expect(outcome.structured).toEqual({
      cwd: root,
      project: '@scope/lib',
      targets: ['lint', 'typecheck'],
      verdict: 'passed',
      exitCode: 0,
      logPath: outcome.logPath,
    });
  });

  it('reports per-target results and the last task lines of a failing run, and writes the full log', async () => {
    installNx('');
    const child = new FakeProcess();
    const d = fakeDeps(child);
    const pending = runCheck(
      args({ project: 'app', targets: ['lint', 'test', 'build'] }),
      d,
    );
    await untilSpawned(d.spawnProcess);
    child.stdout.write(
      '\u001b[1m NX   Running targets lint, test for project app:\u001b[22m\n',
    );
    child.stdout.write('> nx run app:lint\nall good\n');
    child.stdout.write('> nx run app:test\nFAIL src/a.spec.ts\n  expected 1 ');
    child.stdout.write('to be 2\n');
    child.stderr.write('Error: assertion failed\n');
    child.stdout.write(
      ' NX   Ran targets lint, test for project app (3s)\n\n' +
        '   ✖  1/2 failed\n\nFailed tasks:\n\n- app:test\n\nNx Cloud noise\n',
    );
    child.finish(1);
    const outcome = await pending;

    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain('FAILED (exit 1)');
    expect(outcome.text).toContain('- lint: passed');
    expect(outcome.text).toContain('- test: failed');
    expect(outcome.text).toContain('- build: not run');
    expect(outcome.text).toContain('Last output lines:');
    expect(outcome.text).toContain('expected 1 to be 2');
    expect(outcome.text).toContain('Error: assertion failed');
    expect(outcome.text).not.toContain('Nx Cloud noise');
    expect(outcome.text).not.toContain('\u001b');

    const log = readFileSync(outcome.logPath as string, 'utf8');
    expect(log).toContain('Nx Cloud noise');
    expect(log).toContain('[ptah_run_check] exit 1');
  });

  it('kills the process tree on timeout and says so', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      installNx('');
      const child = new FakeProcess(777);
      const killTree = jest.fn(async () => {
        child.finish(null, 'SIGTERM');
      });
      const d = fakeDeps(child, { killTree });
      const pending = runCheck(
        args({ project: 'app', targets: ['test'], timeoutSec: 5 }),
        d,
      );
      await untilSpawned(d.spawnProcess);
      child.stdout.write('> nx run app:test\nstill going\n');
      await jest.advanceTimersByTimeAsync(5_000);
      jest.useRealTimers();
      const outcome = await pending;

      expect(killTree).toHaveBeenCalledWith(777);
      expect(outcome.text).toContain(
        'TIMED OUT after 5s; the process tree was killed',
      );
      expect(outcome.text).toContain('- test: incomplete');
      expect(outcome.text).toContain('still going');
    } finally {
      jest.useRealTimers();
    }
  });

  it('kills only the tree of the cancelled run on abort and reports it as cancelled', async () => {
    installNx('');
    const child = new FakeProcess(5150);
    const other = new FakeProcess(6160);
    const killTree = jest.fn(async (pid: number) => {
      if (pid === 5150) child.finish(null, 'SIGTERM');
    });
    const controller = new AbortController();
    const d = fakeDeps(child, { killTree, signal: controller.signal });
    const otherDeps = fakeDeps(other, { killTree });
    const pending = runCheck(args({ project: 'app', targets: ['test'] }), d);
    const otherPending = runCheck(
      args({ project: 'app', targets: ['lint'] }),
      otherDeps,
    );
    await untilSpawned(d.spawnProcess);
    await untilSpawned(otherDeps.spawnProcess);
    expect(runningCheckPids()).toEqual(expect.arrayContaining([5150, 6160]));
    child.stdout.write('> nx run app:test\nhalfway\n');

    controller.abort();
    const outcome = await pending;

    expect(killTree).toHaveBeenCalledTimes(1);
    expect(killTree).toHaveBeenCalledWith(5150);
    expect(outcome.isError).toBe(false);
    expect(outcome.structured.verdict).toBe('cancelled');
    expect(outcome.text).toContain('CANCELLED; the process tree was killed');
    expect(outcome.text).toContain('- test: incomplete');
    expect(runningCheckPids()).not.toContain(5150);
    expect(runningCheckPids()).toContain(6160);

    other.finish(0);
    expect((await otherPending).structured.verdict).toBe('passed');
    expect(runningCheckPids()).not.toContain(6160);
  });

  it('spawns nothing when the signal is already aborted', async () => {
    installNx('');
    const child = new FakeProcess();
    const controller = new AbortController();
    controller.abort();
    const d = fakeDeps(child, { signal: controller.signal });
    const outcome = await runCheck(
      args({ project: 'app', targets: ['test'] }),
      d,
    );

    expect(d.spawnProcess).not.toHaveBeenCalled();
    expect(d.killTree).not.toHaveBeenCalled();
    expect(outcome.structured.verdict).toBe('cancelled');
    expect(outcome.text).toContain('CANCELLED before Nx started');
    expect(outcome.text).toContain('- test: not run');
  });

  it('killRunningChecks kills every live check tree and each reply says cancelled', async () => {
    installNx('');
    const first = new FakeProcess(7001);
    const second = new FakeProcess(7002);
    const killTree = jest.fn(async (pid: number) => {
      (pid === 7001 ? first : second).finish(null, 'SIGTERM');
    });
    const firstDeps = fakeDeps(first, { killTree });
    const secondDeps = fakeDeps(second, { killTree });
    const pendingFirst = runCheck(
      args({ project: 'app', targets: ['test'] }),
      firstDeps,
    );
    const pendingSecond = runCheck(
      args({ project: 'app', targets: ['lint'] }),
      secondDeps,
    );
    await untilSpawned(firstDeps.spawnProcess);
    await untilSpawned(secondDeps.spawnProcess);

    await killRunningChecks();
    const outcomes = await Promise.all([pendingFirst, pendingSecond]);

    expect(killTree).toHaveBeenCalledWith(7001);
    expect(killTree).toHaveBeenCalledWith(7002);
    expect(killTree).toHaveBeenCalledTimes(2);
    expect(outcomes.map((o) => o.structured.verdict)).toEqual([
      'cancelled',
      'cancelled',
    ]);
    expect(runningCheckPids()).toEqual([]);
    // Nothing left: a second dispose is a no-op.
    await killRunningChecks();
    expect(killTree).toHaveBeenCalledTimes(2);
  });

  it('keeps the timeout reason when a cancel arrives during the timeout kill', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      installNx('');
      const child = new FakeProcess(8080);
      const killTree = jest.fn(async () => {
        child.finish(null, 'SIGTERM');
      });
      const controller = new AbortController();
      const d = fakeDeps(child, { killTree, signal: controller.signal });
      const pending = runCheck(
        args({ project: 'app', targets: ['test'], timeoutSec: 2 }),
        d,
      );
      await untilSpawned(d.spawnProcess);
      await jest.advanceTimersByTimeAsync(2_000);
      controller.abort();
      jest.useRealTimers();
      const outcome = await pending;

      expect(killTree).toHaveBeenCalledTimes(1);
      expect(outcome.structured.verdict).toBe('timed_out');
    } finally {
      jest.useRealTimers();
    }
  });

  it('says a failed kill failed, keeps the pid listed, and dispose retries it', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      installNx('');
      const child = new FakeProcess(9090);
      const killTree = jest
        .fn<Promise<void>, [number]>()
        .mockRejectedValueOnce(new Error('Access is denied.'))
        .mockResolvedValueOnce(undefined);
      const controller = new AbortController();
      const d = fakeDeps(child, { killTree, signal: controller.signal });
      const pending = runCheck(args({ project: 'app', targets: ['test'] }), d);
      await untilSpawned(d.spawnProcess);

      controller.abort();
      // The process never closes: the run settles on the backstop.
      await jest.advanceTimersByTimeAsync(10_000);
      jest.useRealTimers();
      const outcome = await pending;

      expect(outcome.structured.verdict).toBe('cancelled');
      expect(outcome.text).toContain(
        'CANCELLED; kill failed (pid 9090 may still be running)',
      );
      expect(outcome.text).not.toContain('the process tree was killed');
      expect(readFileSync(outcome.logPath as string, 'utf8')).toContain(
        'tree kill of pid 9090 failed: Access is denied.',
      );
      expect(runningCheckPids()).toContain(9090);

      // Dispose retries the kill; this time it works and the pid leaves.
      await killRunningChecks();
      expect(killTree).toHaveBeenCalledTimes(2);
      expect(killTree).toHaveBeenLastCalledWith(9090);
      expect(runningCheckPids()).not.toContain(9090);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps a pid whose retry kill fails, and unlists it once the process closes', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      installNx('');
      const child = new FakeProcess(9191);
      const killTree = jest.fn(async (): Promise<void> => {
        throw new Error('EPERM');
      });
      const d = fakeDeps(child, { killTree });
      const pending = runCheck(
        args({ project: 'app', targets: ['test'], timeoutSec: 1 }),
        d,
      );
      await untilSpawned(d.spawnProcess);
      await jest.advanceTimersByTimeAsync(1_000 + 10_000);
      jest.useRealTimers();
      const outcome = await pending;

      expect(outcome.structured.verdict).toBe('timed_out');
      expect(outcome.text).toContain(
        'TIMED OUT after 1s; kill failed (pid 9191 may still be running)',
      );
      await expect(killRunningChecks()).resolves.toBeUndefined();
      expect(killTree).toHaveBeenCalledTimes(2);
      expect(runningCheckPids()).toContain(9191);

      child.finish(null, 'SIGKILL');
      await new Promise((r) => setImmediate(r));
      expect(runningCheckPids()).not.toContain(9191);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('a failed kill whose root process exits (TASK_2026_614 M2)', () => {
    const realPlatform = process.platform;
    const setPlatform = (platform: NodeJS.Platform): void => {
      Object.defineProperty(process, 'platform', {
        value: platform,
        configurable: true,
      });
    };
    afterEach(() => setPlatform(realPlatform));

    /** Time a run out with a kill that always fails; the process never closes. */
    async function timedOutWithFailedKill(
      child: FakeProcess,
      beforeSettle?: () => void,
    ): Promise<jest.Mock<Promise<void>, [number]>> {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      try {
        installNx('');
        const killTree = jest
          .fn<Promise<void>, [number]>()
          .mockRejectedValue(new Error('The process "1" not found.'));
        const d = fakeDeps(child, { killTree });
        const pending = runCheck(
          args({ project: 'app', targets: ['test'], timeoutSec: 1 }),
          d,
        );
        await untilSpawned(d.spawnProcess);
        await jest.advanceTimersByTimeAsync(1_000);
        beforeSettle?.();
        await jest.advanceTimersByTimeAsync(10_000);
        jest.useRealTimers();
        const outcome = await pending;
        expect(outcome.structured.verdict).toBe('timed_out');
        expect(killTree).toHaveBeenCalledTimes(1);
        return killTree;
      } finally {
        jest.useRealTimers();
      }
    }

    it('win32: drops the listed retry once the root exits, so dispose never kills a reused pid', async () => {
      setPlatform('win32');
      const child = new FakeProcess(9292);
      const killTree = await timedOutWithFailedKill(child);
      expect(runningCheckPids()).toContain(9292);

      child.emit('exit', 1, null);
      expect(runningCheckPids()).not.toContain(9292);

      await killRunningChecks();
      expect(killTree).toHaveBeenCalledTimes(1);
    });

    it('win32: lists no retry when the root exited before the run settled', async () => {
      setPlatform('win32');
      const child = new FakeProcess(9393);
      const killTree = await timedOutWithFailedKill(child, () =>
        child.emit('exit', 1, null),
      );
      expect(runningCheckPids()).not.toContain(9393);

      await killRunningChecks();
      expect(killTree).toHaveBeenCalledTimes(1);
    });

    it('POSIX: keeps the retry after the root exits — the group kill still reaches the tree', async () => {
      setPlatform('linux');
      const child = new FakeProcess(9494);
      const killTree = await timedOutWithFailedKill(child);

      child.emit('exit', null, 'SIGTERM');
      expect(runningCheckPids()).toContain(9494);

      await killRunningChecks();
      expect(killTree).toHaveBeenCalledTimes(2);
      expect(killTree).toHaveBeenLastCalledWith(9494);

      child.finish(null, 'SIGKILL');
      await new Promise((r) => setImmediate(r));
      expect(runningCheckPids()).not.toContain(9494);
    });
  });

  it('reports a launch failure as an error result', async () => {
    installNx('');
    const child = new FakeProcess(null);
    const d = fakeDeps(child, { nodeExecutable: 'no-such-node' });
    const pending = runCheck(args({ project: 'app', targets: ['test'] }), d);
    await untilSpawned(d.spawnProcess);
    child.emit('error', new Error('spawn no-such-node ENOENT'));
    const outcome = await pending;

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('could not start "no-such-node"');
    expect(outcome.text).toContain('ENOENT');
  });

  it('still runs and says why when the log cannot be written', async () => {
    installNx('');
    const blocker = join(root, 'not-a-dir');
    writeFileSync(blocker, 'file');
    const child = new FakeProcess();
    const d = fakeDeps(child, { logDirectory: join(blocker, 'checks') });
    const pending = runCheck(args({ project: 'app', targets: ['lint'] }), d);
    await untilSpawned(d.spawnProcess);
    child.finish(0);
    const outcome = await pending;

    expect(outcome.isError).toBe(false);
    expect(outcome.logPath).toBeUndefined();
    expect(outcome.text).toContain('Full log: not written (');
  });

  it('runs a real node process end to end and kills it on timeout', async () => {
    installNx(
      "process.stdout.write('> nx run app:test\\nargs=' + JSON.stringify(process.argv.slice(2)) + '\\n');" +
        'setInterval(() => {}, 1000);',
    );
    const outcome = await runCheck(
      args({ project: 'app', targets: ['test'], timeoutSec: 1 }),
      { workspaceRoot: root, nodeExecutable: process.execPath },
    );

    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain('TIMED OUT after 1s');
    const log = readFileSync(outcome.logPath as string, 'utf8');
    expect(log).toContain(
      'args=["run-many","-t","test","-p","app","--outputStyle=static"]',
    );
  }, 30_000);
});

describe('formatRunCheckSummary', () => {
  it(`keeps the reply within ${WAIT_SUMMARY_MAX_CHARS} chars and the newest lines`, () => {
    const lines = Array.from(
      { length: 400 },
      (_, i) => `line-${i} ${'z'.repeat(280)}`,
    );
    const text = formatRunCheckSummary({
      cwd: root,
      project: 'p'.repeat(120),
      targets: ['test', 'lint', 'typecheck', 'build'],
      timeoutSec: 900,
      code: 1,
      timedOut: false,
      durationMs: 123_456,
      results: new Map([['test', 'failed']]),
      lastLines: lines,
      logPath: join(root, 'x'.repeat(500)),
    });
    expect(text.length).toBeLessThanOrEqual(WAIT_SUMMARY_MAX_CHARS);
    expect(text).toContain('line-399');
    expect(text).toContain('- lint: unknown');
    expect(text).toContain('Full log:');
  });

  it('omits output lines on a passing run', () => {
    const text = formatRunCheckSummary({
      cwd: '/work/tree',
      project: 'app',
      targets: ['lint'],
      timeoutSec: 60,
      code: 0,
      timedOut: false,
      durationMs: 1_000,
      results: new Map([['lint', 'passed']]),
      lastLines: ['noise'],
      logPath: '/tmp/x.log',
    });
    expect(text).not.toContain('noise');
    expect(text).toContain('PASSED (exit 0), 1.0s.');
    expect(text).toContain('Ran in: /work/tree');
  });
});
