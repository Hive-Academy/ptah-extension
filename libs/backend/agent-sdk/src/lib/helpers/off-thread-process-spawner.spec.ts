import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import {
  OffThreadProcessSpawner,
  type OffThreadSpawnHooks,
  type PtahSpawnedProcess,
} from './off-thread-process-spawner';
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

describe('OffThreadProcessSpawner', () => {
  let logger: MockLogger;
  let spawner: OffThreadProcessSpawner;

  beforeEach(() => {
    logger = createMockLogger();
    spawner = new OffThreadProcessSpawner(asLogger(logger));
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
