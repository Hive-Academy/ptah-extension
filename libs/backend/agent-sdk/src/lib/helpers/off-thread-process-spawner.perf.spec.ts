import 'reflect-metadata';

import { monitorEventLoopDelay } from 'node:perf_hooks';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import {
  OffThreadProcessSpawner,
  type PtahSpawnedProcess,
} from './off-thread-process-spawner';
import type { SpawnOptions } from '../types/sdk-types/claude-sdk.types';

/**
 * ADVISORY perf spec for `OffThreadProcessSpawner` — opt-in, never a CI gate.
 *
 * TASK_2026_341's acceptance list names two absolute numbers: `spawn()` returns
 * within 50 ms and the host's `monitorEventLoopDelay` max stays under 100 ms
 * through the launch. Both are real and both were measured on the reference
 * Windows machine, where an inline spawn of `node.exe` costs ~700 ms and of
 * `claude.exe` ~1.9 s.
 *
 * They are NOT in the always-run spec, because an absolute wall-clock budget is
 * a measurement of the HOST, and this repo's normal operating mode is several
 * agents building and testing in one working tree. The first revision of this
 * task asserted 250 ms inline and failed in two of four consecutive runs on an
 * otherwise-unchanged tree; Nx's flaky-task detector fired on it. A gate that
 * fails because a sibling agent started a build is worse than no gate: it
 * trains the team to re-run until green, which is exactly how a real regression
 * gets waved through.
 *
 * So the mechanism and the relative bound are enforced always, in
 * `off-thread-process-spawner.spec.ts`, and the absolute numbers live here:
 *
 *   PTAH_PERF_SPECS=1 npx nx run-many -t test -p @ptah-extension/agent-sdk
 *
 * Run it on a QUIET machine when you want the headline figure — after touching
 * the spawner, the worker source, or `SdkQueryRunner`'s launch seam.
 */

const PERF_ENABLED = process.env['PTAH_PERF_SPECS'] === '1';

/** `describe` when explicitly enabled, `describe.skip` otherwise. */
const perfDescribe = PERF_ENABLED ? describe : describe.skip;

jest.setTimeout(120_000);

const ECHO_SCRIPT = 'process.stdin.pipe(process.stdout)';

/** Acceptance criterion 1: `spawn()` must return within this. */
const SPAWN_RETURN_BUDGET_MS = 50;

/** Acceptance criterion 1: the host loop's max delay through the launch. */
const LOOP_DELAY_BUDGET_MS = 100;

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

function spawnOptions(args: string[]): SpawnOptions {
  return {
    command: process.execPath,
    args,
    cwd: process.cwd(),
    env: { ...process.env },
    signal: new AbortController().signal,
  };
}

function drain(target: PtahSpawnedProcess): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    target.stdout.resume();
    target.stdout.on('error', reject);
    target.once('exit', () => resolve());
  });
}

perfDescribe('OffThreadProcessSpawner (perf, PTAH_PERF_SPECS=1)', () => {
  let spawner: OffThreadProcessSpawner;

  beforeEach(() => {
    spawner = new OffThreadProcessSpawner(asLogger(createMockLogger()));
  });

  afterEach(async () => {
    await spawner.dispose();
  });

  it('returns within 50ms and keeps the host loop delay under 100ms', async () => {
    // The FIRST `new Worker` inside a Jest worker process pays a one-time
    // module-registry cost (~1 s measured) that a real host does not; in a plain
    // node process the same construction is 3-34 ms. Warm up, then measure.
    const warmUp = spawner.spawn(spawnOptions(['-e', ECHO_SCRIPT]));
    const warmUpDone = drain(warmUp);
    warmUp.stdin.end();
    await warmUpDone;

    // The window is the LAUNCH only — `spawn()` plus one turn of the loop.
    // Holding it open for the child's whole lifetime measures the machine; an
    // inline spawn puts its entire 700 ms / 1.9 s block inside this window.
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();

    const startedAt = Date.now();
    const child = spawner.spawn(spawnOptions(['-e', ECHO_SCRIPT]));
    const elapsed = Date.now() - startedAt;

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    histogram.disable();

    expect(child.transport).toBe('worker');
    expect(elapsed).toBeLessThan(SPAWN_RETURN_BUDGET_MS);
    expect(histogram.max / 1e6).toBeLessThan(LOOP_DELAY_BUDGET_MS);

    const done = drain(child);
    child.stdin.end();
    await done;
  });
});
