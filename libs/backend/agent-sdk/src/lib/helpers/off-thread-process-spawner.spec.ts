import 'reflect-metadata';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

import crossSpawn from 'cross-spawn';

import type { Logger } from '@ptah-extension/vscode-core';
import type { SpawnedProcessHandle } from '@ptah-extension/platform-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import type { Writable } from 'node:stream';
import type { DegradationReporter } from '@ptah-extension/vscode-core';
import {
  OffThreadProcessSpawner,
  type OffThreadSpawnHooks,
  type PtahSpawnedProcess,
} from './off-thread-process-spawner';
import {
  LIVE_WORKER_HARD_CAP,
  LIVE_WORKER_SOFT_CAP,
  POOL_IDLE_TTL_MS,
  POOL_MAX_IDLE,
} from './spawn-worker-pool';
import type { SpawnOptions } from '../types/sdk-types/claude-sdk.types';

/**
 * These specs drive REAL child processes through the worker, because the worker
 * body is an eval'd string that neither the compiler nor the linter sees
 * (`off-thread-process-spawner-source.ts` explains that trade). A typo in the
 * protocol can only be caught here.
 *
 * **Nothing in this file asserts an absolute wall-clock duration.** An earlier
 * revision did, and it flaked in two of four consecutive runs on the reference
 * machine: this repo's normal operating mode is several agents editing and
 * testing in one working tree, so a fixed millisecond budget measures host
 * contention rather than the code. What this file asserts instead is the
 * MECHANISM (`transport === 'worker'`) and a RELATIVE bound — the worker path
 * measured against the inline path it replaces, on the same box, in the same
 * minute, taking the best of several samples so one stalled sample cannot fail
 * the build. The literal 50 ms / 100 ms acceptance numbers live in
 * `off-thread-process-spawner.perf.spec.ts`, which is advisory and opt-in.
 */

jest.setTimeout(60_000);

const ECHO_SCRIPT = 'process.stdin.pipe(process.stdout)';
const IDLE_SCRIPT = 'setInterval(function () {}, 1000)';

/**
 * How many (inline, worker) pairs the relative comparison takes.
 *
 * The estimator is the MINIMUM of each set, i.e. "how fast can this path be on
 * this box right now". A minimum is what makes the assertion survive a GC pause
 * or a sibling agent's test run landing inside one sample.
 */
const SPAWN_SAMPLES = 3;

/**
 * The worker path may cost at most this share of the inline path.
 *
 * Measured on the reference Windows machine: inline `node.exe` ~700 ms against
 * a worker-path return of 3-34 ms, so the real ratio is two orders of
 * magnitude. A quarter is the loosest bound that still fails the moment the
 * spawn moves back onto the calling thread.
 */
const WORKER_SHARE_OF_INLINE = 0.25;

/**
 * Absolute floor for the relative budget.
 *
 * On a host where spawning is genuinely cheap (a warm Linux CI box measures
 * single-digit milliseconds inline) the ratio would compare noise to noise, so
 * the budget never drops below this. It is also the only bound in effect on
 * such a host — and on such a host there is no pathology to catch.
 */
const CHEAP_HOST_BUDGET_MS = 100;

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

function spawnOptions(
  args: string[],
  overrides: Partial<SpawnOptions> = {},
): SpawnOptions {
  return {
    command: process.execPath,
    args,
    cwd: process.cwd(),
    env: { ...process.env },
    signal: new AbortController().signal,
    ...overrides,
  };
}

function readAll(target: PtahSpawnedProcess): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let text = '';
    target.stdout.setEncoding('utf8');
    target.stdout.on('data', (chunk: string) => {
      text += chunk;
    });
    target.stdout.on('end', () => resolve(text));
    target.stdout.on('error', reject);
  });
}

function waitForExit(
  target: PtahSpawnedProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    target.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function waitForError(target: PtahSpawnedProcess): Promise<Error> {
  return new Promise((resolve) => {
    target.once('error', resolve);
  });
}

/**
 * A write to a handle whose worker is gone must fail the way a destroyed Node
 * stream does — `false` and an errored callback — never a silent success.
 */
async function expectWriteRejected(target: {
  readonly stdin: unknown;
}): Promise<void> {
  const stdin = target.stdin as Writable | null;
  expect(stdin).not.toBeNull();

  // Nothing may escape as an unhandled error: no uncaught exception, and an
  // 'error' on the destroyed stdin is absorbed by the handle's own listener.
  const uncaught: unknown[] = [];
  const onUncaught = (error: unknown): void => {
    uncaught.push(error);
  };
  process.on('uncaughtException', onUncaught);
  try {
    let accepted: boolean | undefined;
    const callbackError = await new Promise<Error | null | undefined>(
      (resolve) => {
        accepted = stdin?.write('late', (error) => resolve(error));
      },
    );
    expect(accepted).toBe(false);
    expect((callbackError as Error & { code?: string }).code).toBe(
      'ERR_STREAM_DESTROYED',
    );
    expect(() =>
      stdin?.emit('error', new Error('late pipe error')),
    ).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(uncaught).toEqual([]);
  } finally {
    process.off('uncaughtException', onUncaught);
  }
}

describe('OffThreadProcessSpawner', () => {
  let logger: MockLogger;
  let reporter: { report: jest.Mock };
  let spawner: OffThreadProcessSpawner;

  beforeEach(() => {
    logger = createMockLogger();
    reporter = { report: jest.fn() };
    spawner = new OffThreadProcessSpawner(
      asLogger(logger),
      reporter as unknown as DegradationReporter,
    );
  });

  afterEach(async () => {
    // Resolving proves no worker thread is left behind — the condition Jest
    // otherwise reports as "a worker process has failed to exit gracefully".
    await spawner.dispose();
    delete process.env['PTAH_SDK_INLINE_SPAWN'];
  });

  /** Spawn an echo child, drain it, and return how long `spawn()` itself took. */
  async function measureSpawnReturnMs(
    expected: 'worker' | 'inline',
  ): Promise<number> {
    const startedAt = Date.now();
    const child = spawner.spawn(spawnOptions(['-e', ECHO_SCRIPT]));
    const elapsed = Date.now() - startedAt;

    expect(child.transport).toBe(expected);

    const output = readAll(child);
    child.stdin.end();
    await waitForExit(child);
    await output;

    return elapsed;
  }

  /** Run one throwaway child so the first `new Worker` cost is already paid. */
  async function warmUpWorkerRuntime(): Promise<void> {
    await measureSpawnReturnMs('worker');
  }

  describe('the launch does not happen on this thread', () => {
    it('creates the child on a worker, not on the calling thread', async () => {
      // The mechanism assertion, and the one that cannot flake: `spawn` runs
      // `uv_spawn` inline on the calling thread, so WHICH THREAD called it IS
      // the fix. Everything else here is a measurement of the same fact.
      const child = spawner.spawn(spawnOptions(['-e', ECHO_SCRIPT]));
      expect(child.transport).toBe('worker');

      // The handle is usable the instant it is returned, and says nothing that
      // would make the SDK treat the child as dead: it gates every stdin write
      // on `exitCode !== null`.
      expect(child.exitCode).toBeNull();
      expect(child.killed).toBe(false);

      const output = readAll(child);
      child.stdin.end();
      await waitForExit(child);
      await output;
    });

    it('returns far faster than the inline spawn it replaces', async () => {
      // Relative, not absolute: both paths are measured on this box within the
      // same few seconds, so a loaded machine inflates BOTH and the ratio
      // survives. See the file header for why an absolute budget was dropped.
      await warmUpWorkerRuntime();

      const inlineSamples: number[] = [];
      const workerSamples: number[] = [];

      for (let round = 0; round < SPAWN_SAMPLES; round++) {
        process.env['PTAH_SDK_INLINE_SPAWN'] = '1';
        inlineSamples.push(await measureSpawnReturnMs('inline'));
        delete process.env['PTAH_SDK_INLINE_SPAWN'];
        workerSamples.push(await measureSpawnReturnMs('worker'));
      }

      const inlineBest = Math.min(...inlineSamples);
      const workerBest = Math.min(...workerSamples);

      // On a host where spawning is cheap the ratio compares noise to noise, so
      // the budget floors out and only the absolute bound applies.
      const budget = Math.max(
        CHEAP_HOST_BUDGET_MS,
        inlineBest * WORKER_SHARE_OF_INLINE,
      );

      expect(workerBest).toBeLessThan(budget);
    }, 120_000);
  });

  describe('stdio contract', () => {
    it('round-trips stdin to stdout and exits 0 with exactly one exit event', async () => {
      const child = spawner.spawn(spawnOptions(['-e', ECHO_SCRIPT]));
      const output = readAll(child);

      const exits: Array<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }> = [];
      child.on('exit', (code, signal) => {
        exits.push({ code, signal });
      });

      child.stdin.write('ping\n');
      child.stdin.end();

      await waitForExit(child);
      await expect(output).resolves.toBe('ping\n');
      expect(exits).toEqual([{ code: 0, signal: null }]);
      expect(child.exitCode).toBe(0);
    });

    it('forwards stderr to the onStderr hook', async () => {
      // The SDK only pipes and forwards stderr inside its own
      // `spawnLocalProcess`; supplying a custom spawner skips that entirely, so
      // this hook is the whole of `options.stderr` from here on.
      const chunks: string[] = [];
      const hooks: OffThreadSpawnHooks = {
        onStderr: (data) => {
          chunks.push(data);
        },
      };
      const child = spawner.spawn(
        spawnOptions(['-e', "process.stderr.write('boom')"]),
        hooks,
      );
      const output = readAll(child);

      await waitForExit(child);
      await output;

      expect(chunks.join('')).toContain('boom');
    });
  });

  describe('termination', () => {
    it('kill("SIGTERM") sets killed and emits exit', async () => {
      const child = spawner.spawn(spawnOptions(['-e', IDLE_SCRIPT]));
      const output = readAll(child);
      const exited = waitForExit(child);

      expect(child.kill('SIGTERM')).toBe(true);
      expect(child.killed).toBe(true);

      const { code, signal } = await exited;
      // Windows reports a non-zero code and no signal; POSIX reports the
      // signal and a null code. Either way it is not a clean exit.
      expect(code === 0 && signal === null).toBe(false);
      await output;
    });

    it('aborting the forwarded signal kills the child', async () => {
      const controller = new AbortController();
      const child = spawner.spawn(
        spawnOptions(['-e', IDLE_SCRIPT], { signal: controller.signal }),
      );
      const output = readAll(child);
      const exited = waitForExit(child);

      controller.abort();

      const { code, signal } = await exited;
      expect(code === 0 && signal === null).toBe(false);
      expect(child.killed).toBe(true);
      await output;
    });
  });

  describe('spawn failure', () => {
    it('emits an error carrying code ENOENT for a missing executable', async () => {
      // The SDK's spawn-failure classifier reads `error.code` to decide whether
      // to report "Claude Code executable not found" rather than a generic
      // transport fault, and the code has to survive the structured clone.
      const child = spawner.spawn(
        spawnOptions([], { command: 'ptah-no-such-executable-2026-341' }),
      );

      const error = await waitForError(child);
      expect((error as Error & { code?: string }).code).toBe('ENOENT');
    });
  });

  describe('spawnProcess - the IProcessSpawner port', () => {
    /**
     * Every `spawn` message the host posted to a worker, in order.
     *
     * `jest.spyOn` keeps the real implementation, so the child still runs; this
     * only reads what crossed the port. It is how the three Windows-specific
     * fields are asserted at all: `detached`, `windowsHide` and
     * `windowsVerbatimArguments` have no effect a spec can read back off a
     * child process.
     */
    let postSpy: jest.SpyInstance;

    function spawnMessages(): Array<Record<string, unknown>> {
      return postSpy.mock.calls
        .map((call) => call[0] as Record<string, unknown>)
        .filter((message) => message?.['type'] === 'spawn');
    }

    beforeEach(() => {
      postSpy = jest.spyOn(Worker.prototype, 'postMessage');
    });

    afterEach(() => {
      postSpy.mockRestore();
    });

    function readAllFrom(
      stream: NodeJS.ReadableStream | null,
    ): Promise<string> {
      if (!stream) return Promise.resolve('');
      return new Promise<string>((resolve, reject) => {
        let text = '';
        stream.setEncoding('utf8');
        stream.on('data', (chunk: string) => {
          text += chunk;
        });
        stream.on('end', () => resolve(text));
        stream.on('error', reject);
      });
    }

    function waitForClose(
      target: SpawnedProcessHandle,
    ): Promise<number | null> {
      return new Promise((resolve) => {
        target.once('close', (code) => resolve(code));
      });
    }

    it('resolves whenSpawned with the CHILD process pid', async () => {
      // A tree kill needs the real pid, and off-thread it is not known when the
      // handle is returned. Comparing against what the child printed proves the
      // pid crossing the port is the CHILD's, not the worker's or the host's.
      const child = spawner.spawnProcess({
        command: process.execPath,
        args: ['-e', 'process.stdout.write(String(process.pid))'],
        env: process.env,
      });

      const output = readAllFrom(child.stdout);
      await waitForClose(child);

      const pid = await child.whenSpawned;
      expect(pid).toBe(Number(await output));
      expect(child.pid).toBe(pid);
    });

    it('delivers stderr as a readable stream, separate from stdout', async () => {
      const child = spawner.spawnProcess({
        command: process.execPath,
        args: [
          '-e',
          "process.stderr.write('to-stderr'); process.stdout.write('to-stdout')",
        ],
        env: process.env,
      });

      const [out, err] = await Promise.all([
        readAllFrom(child.stdout),
        readAllFrom(child.stderr),
        waitForClose(child),
      ]);

      expect(out).toBe('to-stdout');
      expect(err).toBe('to-stderr');
      expect(spawnMessages()[0]?.['stderrMode']).toBe('stream');
    });

    it('emits close only after stdout has drained', async () => {
      // The rival-CLI adapters parse their last JSONL line inside `close`, so
      // an exit that outran the pipe would silently drop the result line.
      const child = spawner.spawnProcess({
        command: process.execPath,
        args: ['-e', "process.stdout.write('x'.repeat(100000))"],
        env: process.env,
      });

      let drained = false;
      const output = readAllFrom(child.stdout).then((text) => {
        drained = true;
        return text;
      });
      const closed = waitForClose(child).then(() => drained);

      await expect(closed).resolves.toBe(true);
      await expect(output).resolves.toHaveLength(100000);
    });

    it('forwards detached to the worker and hides the console by default', async () => {
      const child = spawner.spawnProcess({
        command: process.execPath,
        args: ['-e', ''],
        env: process.env,
        detached: true,
      });

      await waitForClose(child);

      const message = spawnMessages()[0];
      expect(message?.['detached']).toBe(true);
      expect(message?.['windowsHide']).toBe(true);
    });

    it('gives the child its own console when needsConsole is set', async () => {
      // ConPTY's AttachConsole() fails without a console, which is what breaks
      // shell execution inside the rival CLIs on Windows.
      const child = spawner.spawnProcess({
        command: process.execPath,
        args: ['-e', ''],
        env: process.env,
        needsConsole: true,
      });

      await waitForClose(child);

      expect(spawnMessages()[0]?.['windowsHide']).toBe(false);
    });

    describe('Windows .cmd wrappers', () => {
      // An npm-installed CLI on Windows is a `.cmd` wrapper that a bare
      // `child_process.spawn` refuses with EINVAL. `cross-spawn`'s parser runs
      // on the HOST and only the resolved command reaches the worker, which
      // still spawns with plain `node:child_process`.
      const itWin = process.platform === 'win32' ? it : it.skip;
      let wrapperDir = '';
      let wrapper = '';

      beforeAll(() => {
        if (process.platform !== 'win32') return;
        wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-spawn-'));
        wrapper = path.join(wrapperDir, 'ptah-probe.cmd');
        fs.writeFileSync(
          wrapper,
          '@echo off\r\necho cmd-wrapper-ok %*\r\n',
          'utf8',
        );
      });

      afterAll(() => {
        if (wrapperDir) {
          fs.rmSync(wrapperDir, { recursive: true, force: true });
        }
      });

      itWin(
        'runs a .cmd wrapper and matches inline cross-spawn byte for byte',
        async () => {
          // The no-regression assertion: whatever `cross-spawn` produces on
          // this box for this wrapper, the off-thread path produces too —
          // argument quoting included, which is where a hand-rolled `.cmd`
          // rewrite would differ.
          const child = spawner.spawnProcess({
            command: wrapper,
            args: ['first', 'second'],
            env: process.env,
          });

          const output = readAllFrom(child.stdout);
          await waitForClose(child);

          const inline = crossSpawn(wrapper, ['first', 'second'], {
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          const inlineOutput = await readAllFrom(inline.stdout);

          const text = await output;
          expect(text).toContain('cmd-wrapper-ok');
          expect(text).toBe(inlineOutput);
        },
      );

      itWin(
        'sends cmd.exe and windowsVerbatimArguments to the worker',
        async () => {
          const child = spawner.spawnProcess({
            command: wrapper,
            args: ['first'],
            env: process.env,
          });

          await waitForClose(child);

          const message = spawnMessages()[0];
          expect(String(message?.['command']).toLowerCase()).toContain(
            'cmd.exe',
          );
          expect(message?.['windowsVerbatimArguments']).toBe(true);
          // The wrapper is no longer the command; it lives inside /c's argument.
          expect(JSON.stringify(message?.['args'])).toContain('ptah-probe.cmd');
        },
      );
    });
  });

  describe('worker reuse (TASK_2026_437 C12)', () => {
    /**
     * Which Worker instance received each `spawn` message, in order.
     *
     * `mock.contexts` records `this` for every call, so the identity of the
     * thread a child ran on is read straight off the port — no test-only
     * accessor on the spawner.
     */
    let postSpy: jest.SpyInstance;

    function spawnWorkers(): Worker[] {
      const workers: Worker[] = [];
      postSpy.mock.calls.forEach((call, index) => {
        const message = call[0] as Record<string, unknown> | undefined;
        if (message?.['type'] === 'spawn') {
          workers.push(postSpy.mock.contexts[index] as Worker);
        }
      });
      return workers;
    }

    beforeEach(() => {
      postSpy = jest.spyOn(Worker.prototype, 'postMessage');
    });

    afterEach(() => {
      postSpy.mockRestore();
    });

    function run(
      command: string,
      args: string[],
    ): { handle: SpawnedProcessHandle; done: Promise<string> } {
      const handle = spawner.spawnProcess({ command, args, env: process.env });
      const done = new Promise<string>((resolve, reject) => {
        let text = '';
        handle.stdout?.setEncoding('utf8');
        handle.stdout?.on('data', (chunk: string) => {
          text += chunk;
        });
        handle.once('error', reject);
        handle.once('close', () => resolve(text));
      });
      return { handle, done };
    }

    it('50 sequential git-like spawns create at most 4 workers (AC-8)', async () => {
      for (let i = 0; i < 50; i++) {
        const { done } = run('git', ['--version']);
        await expect(done).resolves.toContain('git version');
      }

      const workers = spawnWorkers();
      expect(workers).toHaveLength(50);
      expect(new Set(workers).size).toBeLessThanOrEqual(POOL_MAX_IDLE);
    }, 120_000);

    it('keeps two consecutive children on one worker apart', async () => {
      // The first child floods stdout and stderr; the second prints one byte.
      // Anything the first posted late must not reach the second's streams.
      const first = run(process.execPath, [
        '-e',
        "process.stdout.write('a'.repeat(100000)); process.stderr.write('first-err')",
      ]);
      await expect(first.done).resolves.toHaveLength(100000);

      const second = spawner.spawnProcess({
        command: process.execPath,
        args: ['-e', "process.stdout.write('b')"],
        env: process.env,
      });
      let stderrText = '';
      second.stderr?.setEncoding('utf8');
      second.stderr?.on('data', (chunk: string) => {
        stderrText += chunk;
      });
      let stdoutText = '';
      second.stdout?.setEncoding('utf8');
      second.stdout?.on('data', (chunk: string) => {
        stdoutText += chunk;
      });
      await new Promise((resolve) => second.once('close', resolve));

      const workers = spawnWorkers();
      expect(workers[1]).toBe(workers[0]);
      expect(stdoutText).toBe('b');
      expect(stderrText).toBe('');
      expect(second.exitCode).toBe(0);
    });

    it('never lends a killed child’s worker to the next child', async () => {
      const terminateSpy = jest.spyOn(Worker.prototype, 'terminate');
      try {
        const idle = spawner.spawn(spawnOptions(['-e', IDLE_SCRIPT]));
        const drained = readAll(idle);
        const exited = waitForExit(idle);
        idle.kill('SIGTERM');
        await exited;
        await drained;

        const { done } = run(process.execPath, [
          '-e',
          "process.stdout.write('next')",
        ]);
        await expect(done).resolves.toBe('next');

        const [killedOn, nextOn] = spawnWorkers();
        expect(nextOn).not.toBe(killedOn);
        expect(terminateSpy.mock.contexts).toContain(killedOn);
      } finally {
        terminateSpy.mockRestore();
      }
    });

    it('fails the in-flight child cleanly when its worker dies, then replaces the worker', async () => {
      const handle = spawner.spawnProcess({
        command: process.execPath,
        args: ['-e', IDLE_SCRIPT],
        env: process.env,
      });
      const events: string[] = [];
      handle.on('exit', () => events.push('exit'));
      handle.on('close', () => events.push('close'));
      // A close handler written exactly the way the rival-CLI adapters write
      // theirs (pi-cli, antigravity-cli, opencode-cli): Node's idiom for "a
      // signal death with no exit code is a failure".
      let adapterExitCode: number | undefined;
      (handle as unknown as NodeJS.EventEmitter).once(
        'close',
        (code: number | null, signal: NodeJS.Signals | null) => {
          adapterExitCode = code ?? (signal ? 1 : 0);
        },
      );
      const failed = new Promise<Error>((resolve) => {
        handle.once('error', (error: Error) => {
          events.push('error');
          resolve(error);
        });
      });
      const closed = new Promise((resolve) => handle.once('close', resolve));
      const pid = await handle.whenSpawned;
      expect(pid).not.toBeNull();

      // Kill the THREAD, not the child — the crash the pool must survive.
      const [crashed] = spawnWorkers();
      await crashed.terminate();

      const error = await failed;
      expect((error as Error & { code?: string }).code).toBe('EWORKER');
      await closed;

      // The SDK's ProcessTransport records `exitError` from 'error' but only
      // resolves `waitForExit` / `onExit` from 'exit', so both must fire, in
      // ChildProcess order.
      expect(events).toEqual(['error', 'exit', 'close']);
      // Reported as Node reports a signal death. The SDK's write gate is
      // `killed || exitCode !== null`, which `killed` alone satisfies.
      expect(handle.exitCode).toBeNull();
      expect((handle as unknown as { signalCode: string }).signalCode).toBe(
        'SIGTERM',
      );
      expect((handle as unknown as { killed: boolean }).killed).toBe(true);
      expect(adapterExitCode).toBe(1);
      await expectWriteRejected(handle);

      const { done } = run(process.execPath, [
        '-e',
        "process.stdout.write('after-crash')",
      ]);
      await expect(done).resolves.toBe('after-crash');
      expect(spawnWorkers()[1]).not.toBe(crashed);

      // The orphan was signalled from the host; make sure it is really gone.
      if (pid !== null) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch (error: unknown) {
          // ESRCH: already reaped by the host's direct SIGTERM.
          void error;
        }
      }
    });

    it('parks at most 4 idle workers, unref’d, and terminates the rest', async () => {
      const unrefSpy = jest.spyOn(Worker.prototype, 'unref');
      const terminateSpy = jest.spyOn(Worker.prototype, 'terminate');
      try {
        const runs = Array.from({ length: POOL_MAX_IDLE + 2 }, () =>
          run(process.execPath, ['-e', "process.stdout.write('x')"]),
        );
        await Promise.all(runs.map((entry) => entry.done));

        const workers = new Set(spawnWorkers());
        expect(workers.size).toBe(POOL_MAX_IDLE + 2);
        // Idle threads must never keep the host process alive.
        expect(new Set(unrefSpy.mock.contexts).size).toBe(POOL_MAX_IDLE);
        expect(new Set(terminateSpy.mock.contexts).size).toBe(2);
      } finally {
        unrefSpy.mockRestore();
        terminateSpy.mockRestore();
      }
    });

    it('terminates an idle worker once it has waited the idle TTL', async () => {
      const terminateSpy = jest.spyOn(Worker.prototype, 'terminate');
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      });
      try {
        const { done } = run(process.execPath, [
          '-e',
          "process.stdout.write('x')",
        ]);
        await done;
        const [parked] = spawnWorkers();
        expect(terminateSpy.mock.contexts).not.toContain(parked);

        jest.advanceTimersByTime(POOL_IDLE_TTL_MS);

        expect(terminateSpy.mock.contexts).toContain(parked);
      } finally {
        jest.useRealTimers();
        terminateSpy.mockRestore();
      }
    });

    it('still spawns above the soft cap, and warns and reports once', async () => {
      const runs = Array.from({ length: LIVE_WORKER_SOFT_CAP + 2 }, () =>
        run('git', ['--version']),
      );
      await Promise.all(runs.map((entry) => entry.done));

      expect(new Set(spawnWorkers()).size).toBe(LIVE_WORKER_SOFT_CAP + 2);
      const capWarnings = logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes('above the soft cap'),
      );
      expect(capWarnings).toHaveLength(1);
      expect(capWarnings[0]?.[1]).toEqual(
        expect.objectContaining({ softCap: LIVE_WORKER_SOFT_CAP }),
      );
      expect(reporter.report).toHaveBeenCalledTimes(1);
      expect(reporter.report).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'agent',
          code: 'agent.spawn-worker.soft-cap',
          severity: 'degraded',
        }),
      );
    }, 120_000);

    it('spawns inline past the hard cap instead of creating another thread', async () => {
      const children = Array.from({ length: LIVE_WORKER_HARD_CAP + 1 }, () =>
        spawner.spawn(spawnOptions(['--version'], { command: 'git' })),
      );
      const settled = children.map(
        (child) =>
          new Promise<void>((resolve) => {
            child.stdout.resume();
            child.once('exit', () => resolve());
            child.once('error', () => resolve());
          }),
      );

      const transports = children.map((child) => child.transport);
      expect(transports.filter((t) => t === 'worker')).toHaveLength(
        LIVE_WORKER_HARD_CAP,
      );
      expect(transports[LIVE_WORKER_HARD_CAP]).toBe('inline');
      expect(new Set(spawnWorkers()).size).toBe(LIVE_WORKER_HARD_CAP);
      expect(reporter.report).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'agent',
          code: 'agent.spawn-worker.hard-cap-inline',
          severity: 'critical',
        }),
      );

      await Promise.all(settled);
    }, 180_000);

    it('drops a parked worker that dies and lends a healthy one next', async () => {
      const first = run(process.execPath, ['-e', "process.stdout.write('1')"]);
      await expect(first.done).resolves.toBe('1');
      const [parked] = spawnWorkers();

      // The idle thread dies while nobody holds it.
      await parked.terminate();

      const second = run(process.execPath, ['-e', "process.stdout.write('2')"]);
      await expect(second.done).resolves.toBe('2');
      const third = run(process.execPath, ['-e', "process.stdout.write('3')"]);
      await expect(third.done).resolves.toBe('3');

      const [, secondOn, thirdOn] = spawnWorkers();
      expect(secondOn).not.toBe(parked);
      // The replacement is healthy enough to be pooled and reused in turn.
      expect(thirdOn).toBe(secondOn);
    });

    it('ends a force-terminated child with exit, a non-null exitCode and a dead stdin', async () => {
      const child = spawner.spawn(spawnOptions(['-e', IDLE_SCRIPT]));
      const events: string[] = [];
      child.on('exit', () => events.push('exit'));
      (child as unknown as SpawnedProcessHandle).on('close', () =>
        events.push('close'),
      );
      child.stdout.resume();
      await (child as unknown as SpawnedProcessHandle).whenSpawned;

      await spawner.dispose();

      expect(events).toEqual(['exit', 'close']);
      expect(child.killed).toBe(true);
      expect(child.exitCode).toBeNull();
      expect((child as unknown as { signalCode: string }).signalCode).toBe(
        'SIGKILL',
      );
      await expectWriteRejected(child);
    });
  });

  describe('PTAH_SDK_INLINE_SPAWN escape hatch', () => {
    it('spawns inline, warns once, and still round-trips stdio', async () => {
      process.env['PTAH_SDK_INLINE_SPAWN'] = '1';

      const child = spawner.spawn(spawnOptions(['-e', ECHO_SCRIPT]));
      expect(child.transport).toBe('inline');

      const output = readAll(child);
      child.stdin.write('ping\n');
      child.stdin.end();

      await waitForExit(child);
      await expect(output).resolves.toBe('ping\n');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Falling back to inline spawn'),
        expect.objectContaining({ reason: 'PTAH_SDK_INLINE_SPAWN=1' }),
      );
    });
  });
});
