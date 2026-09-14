/**
 * Shared rig for the `GitWatcherService` incident stress specs
 * (`git-watcher.stress.spec.ts` — mechanism, always run; and
 * `git-watcher.stress.perf.spec.ts` — absolute event-loop budgets, opt-in).
 *
 * Test support only: nothing in the app imports it, so the bundle never
 * contains it. It uses no Jest globals, so it type-checks under the app
 * tsconfig as well as the spec one.
 *
 * Everything is real: a real temp git repository, a real `GitInfoService`
 * spawning the real git binary through a counting `IProcessSpawner`, and a
 * real `GitWatcherService` arming a real recursive `fs.watch`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn } from 'child_process';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import { GitInfoService, type Logger } from '@ptah-extension/vscode-core';
import type {
  IProcessSpawner,
  ProcessErrorListener,
  ProcessExitListener,
  ProcessSpawnRequest,
  SpawnedProcessHandle,
} from '@ptah-extension/platform-core';

import { GitWatcherService } from './git-watcher.service';

const CHECKOUTS = 10;
const FILES_PER_DIR = 10;

/** How long the armed watcher must be idle before the measured window opens. */
const QUIET_BASELINE_MS = 3_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until `predicate()` is true or `timeoutMs` elapses; returns the last read. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 50,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

/**
 * Real `IProcessSpawner`: every call spawns the requested binary via
 * `child_process.spawn` while recording the request and its start time, so a
 * spec can assert spawn counts without mocking `GitInfoService`.
 */
class CountingProcessSpawner implements IProcessSpawner {
  calls: Array<{ readonly args: readonly string[]; readonly at: number }> = [];
  /** Children spawned and not yet exited — the baseline gate waits for 0. */
  liveChildren = 0;

  spawnProcess(request: ProcessSpawnRequest): SpawnedProcessHandle {
    this.calls.push({ args: request.args, at: Date.now() });
    this.liveChildren++;

    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(request.env)) {
      if (value !== undefined) env[key] = value;
    }

    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env,
      windowsHide: true,
    });
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      this.liveChildren--;
    };
    child.once('exit', settle);
    child.once('error', settle);

    const whenSpawned = new Promise<number | null>((resolve) => {
      child.once('spawn', () => resolve(child.pid ?? null));
      child.once('error', () => resolve(null));
    });

    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      whenSpawned,
      get pid() {
        return child.pid;
      },
      get killed() {
        return child.killed;
      },
      get exitCode() {
        return child.exitCode;
      },
      kill: (signal?: NodeJS.Signals) => child.kill(signal),
      on: (
        event: string,
        listener: ProcessExitListener | ProcessErrorListener,
      ) => {
        child.on(event as 'exit', listener as ProcessExitListener);
      },
      once: (
        event: string,
        listener: ProcessExitListener | ProcessErrorListener,
      ) => {
        child.once(event as 'exit', listener as ProcessExitListener);
      },
      off: (
        event: string,
        listener: ProcessExitListener | ProcessErrorListener,
      ) => {
        child.off(event as 'exit', listener as ProcessExitListener);
      },
    };
  }

  statusSpawns(): ReadonlyArray<{ readonly at: number }> {
    return this.calls.filter((call) => call.args[0] === 'status');
  }

  /**
   * One per `GitInfoService` status pipeline: each starts with the
   * `rev-parse --is-inside-work-tree` probe. Counting `status` alone
   * undercounts on a loaded machine, where the probe can fail and the
   * pipeline ends before `status` is spawned.
   */
  refreshCycles(): ReadonlyArray<{ readonly at: number }> {
    return this.calls.filter(
      (call) =>
        call.args[0] === 'rev-parse' &&
        call.args[1] === '--is-inside-work-tree',
    );
  }
}

/**
 * Builds `totalFiles` real files across ten synthetic checkouts under `root`,
 * ~`FILES_PER_DIR` per directory (the acceptance table's "75,000 files in
 * ~7,500 directories" ratio at any size).
 *
 * `withGitPointers` gives each checkout a `.git` FILE — the shape of the ten
 * agent worktrees deleted on 2026-09-14. Without pointers the tree is plain
 * source: a directory holding a `.git` entry is a nested repository, which the
 * watcher excludes wherever it lives, so a tree of worktrees under a
 * non-excluded path would never reach the storm breaker.
 */
export function buildCheckoutTree(
  root: string,
  totalFiles: number,
  withGitPointers: boolean,
): void {
  fs.mkdirSync(root, { recursive: true });
  const perCheckout = Math.floor(totalFiles / CHECKOUTS);
  for (let c = 0; c < CHECKOUTS; c++) {
    const checkoutDir = path.join(root, `checkout-${c}`);
    fs.mkdirSync(checkoutDir, { recursive: true });
    if (withGitPointers) {
      // A worktree's `.git` is a pointer FILE; the watcher never reads it.
      fs.writeFileSync(
        path.join(checkoutDir, '.git'),
        `gitdir: ${root.replace(/\\/g, '/')}/.git/worktrees/checkout-${c}\n`,
      );
    }
    let written = 0;
    for (let dirIndex = 0; written < perCheckout; dirIndex++) {
      const dir = path.join(checkoutDir, `d${dirIndex}`);
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < FILES_PER_DIR && written < perCheckout; i++) {
        fs.writeFileSync(path.join(dir, `f${i}.txt`), 'x');
        written++;
      }
    }
  }
}

export interface EventLoopDelay {
  readonly p50Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

export interface DeleteWindow {
  readonly deleteStartedAt: number;
  readonly deleteEndedAt: number;
  readonly delay: EventLoopDelay;
}

interface PushRecord {
  readonly type: string;
  readonly payload: unknown;
  readonly at: number;
}

/** The private `GitWatcherService` state the rig reads. Test support only. */
interface WatcherInternals {
  stormBreaker: { isStorming: boolean };
  debounceTimer: unknown;
  gitOpsDebounceTimer: unknown;
  contentChangeTimer: unknown;
  stormTimer: unknown;
  initialFetchTimer: unknown;
  unattributedChangeTimer: unknown;
  ownRefreshesInFlight: number;
  ownRefreshEchoUntil: number;
  onWorkspaceEvent(root: string, eventType: string, f: string | null): void;
}

export class GitWatcherStressRig {
  readonly workspaceRoot: string;
  readonly warnLines: string[] = [];
  readonly pushes: PushRecord[] = [];
  private readonly spawner = new CountingProcessSpawner();
  private readonly svc: GitWatcherService;
  /** `fs.watch` events that reached the watcher, by kind, since the baseline. */
  namedEvents = 0;
  unnamedEvents = 0;

  constructor() {
    this.workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-437-st-'));
    execFileSync('git', ['init', '-q'], { cwd: this.workspaceRoot });
    // Deterministic identity so git never blocks on a prompt.
    execFileSync('git', ['config', 'user.email', 'stress@ptah.test'], {
      cwd: this.workspaceRoot,
    });
    execFileSync('git', ['config', 'user.name', 'ptah-stress'], {
      cwd: this.workspaceRoot,
    });

    const noop = (): void => undefined;
    const logger = {
      info: noop,
      debug: noop,
      error: noop,
      warn: (message: string) => {
        this.warnLines.push(message);
      },
    } as unknown as Logger;
    this.svc = new GitWatcherService(
      new GitInfoService(logger, this.spawner),
      logger,
    );

    // Count what `fs.watch` actually delivered, so a run's log explains its
    // own outcome (a burst that overflowed the OS buffer arrives as a handful
    // of unnamed events instead of thousands of named ones).
    const internals = this.internals();
    const deliver = internals.onWorkspaceEvent.bind(this.svc);
    internals.onWorkspaceEvent = (root, eventType, filename) => {
      if (filename === null) this.unnamedEvents++;
      else this.namedEvents++;
      deliver(root, eventType, filename);
    };
  }

  /**
   * Arms the watcher, waits for the initial status push, then waits until the
   * watcher has held no queued work, no live git child, and made no new spawn
   * or push for {@link QUIET_BASELINE_MS}. Only then are the counters reset.
   *
   * Arming right after writing thousands of files delivers a trail of change
   * events; without this gate that trail could enter a storm whose "entered"
   * line fell before the reset while its exit and refresh fell inside the
   * measured window (the first 75,000-file run: 1 entered, 2 exited).
   *
   * A pending unattributed-change safety refresh from the arm phase is WAITED
   * OUT, not flushed: flushing would need a private call that production never
   * makes. The watcher is not idle until that timer has fired (its refresh
   * then counts as a spawn and push, restarting the quiet window), so
   * `timeoutMs` must exceed `UNATTRIBUTED_QUIET_MS` (30 s) plus a refresh.
   */
  async armAndSettleBaseline(timeoutMs: number): Promise<void> {
    this.svc.start(this.workspaceRoot, (type, payload) => {
      this.pushes.push({ type, payload, at: Date.now() });
    });
    if (!(await waitFor(() => this.statusPushes().length > 0, timeoutMs))) {
      throw new Error('the initial git:status-update never arrived');
    }

    const deadline = Date.now() + timeoutMs;
    let quietSince = Date.now();
    let spawnsSeen = this.spawner.calls.length;
    let pushesSeen = this.pushes.length;
    while (Date.now() - quietSince < QUIET_BASELINE_MS) {
      if (Date.now() > deadline) {
        throw new Error(`watcher did not go idle within ${timeoutMs} ms`);
      }
      await sleep(100);
      if (
        !this.watcherIdle() ||
        this.spawner.liveChildren > 0 ||
        this.spawner.calls.length !== spawnsSeen ||
        this.pushes.length !== pushesSeen
      ) {
        spawnsSeen = this.spawner.calls.length;
        pushesSeen = this.pushes.length;
        quietSince = Date.now();
      }
    }

    this.pushes.length = 0;
    this.spawner.calls = [];
    this.warnLines.length = 0;
    this.namedEvents = 0;
    this.unnamedEvents = 0;
  }

  /** Deletes `tree` recursively, then waits `settleMs`, measuring loop delay throughout. */
  async deleteAndSettle(tree: string, settleMs: number): Promise<DeleteWindow> {
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    const deleteStartedAt = Date.now();
    await fs.promises.rm(tree, { recursive: true, force: true });
    const deleteEndedAt = Date.now();
    await sleep(settleMs);
    histogram.disable();
    return {
      deleteStartedAt,
      deleteEndedAt,
      delay: {
        p50Ms: histogram.percentile(50) / 1e6,
        p99Ms: histogram.percentile(99) / 1e6,
        maxMs: histogram.max / 1e6,
      },
    };
  }

  statusSpawns(): ReadonlyArray<{ readonly at: number }> {
    return this.spawner.statusSpawns();
  }

  refreshCycles(): ReadonlyArray<{ readonly at: number }> {
    return this.spawner.refreshCycles();
  }

  spawnCount(): number {
    return this.spawner.calls.length;
  }

  statusPushes(): PushRecord[] {
    return this.pushes.filter((push) => push.type === 'git:status-update');
  }

  contentPushes(): PushRecord[] {
    return this.pushes.filter((push) => push.type === 'file:content-changed');
  }

  stormLines(kind: 'entered' | 'exited'): number {
    return this.warnLines.filter((line) => line.includes(`event storm ${kind}`))
      .length;
  }

  /** One log line with every mechanism count, for printing before assertions. */
  describe(label: string, window: DeleteWindow): string {
    const { delay } = window;
    return (
      `[${label}] delete=${window.deleteEndedAt - window.deleteStartedAt}ms ` +
      `events named=${this.namedEvents} unnamed=${this.unnamedEvents} ` +
      `storm entered=${this.stormLines('entered')} exited=${this.stormLines('exited')} ` +
      `refreshCycles=${this.refreshCycles().length} statusSpawns=${this.statusSpawns().length} spawns=${this.spawnCount()} ` +
      `statusPushes=${this.statusPushes().length} contentPushes=${this.contentPushes().length} ` +
      `loop p50=${delay.p50Ms.toFixed(2)}ms p99=${delay.p99Ms.toFixed(2)}ms max=${delay.maxMs.toFixed(2)}ms`
    );
  }

  dispose(): void {
    this.svc.stop();
    try {
      fs.rmSync(this.workspaceRoot, { recursive: true, force: true });
    } catch {
      // degradation-audit: optional-capability - temp-directory cleanup after a
      // stress run; a leftover directory under os.tmpdir() affects no result.
    }
  }

  private internals(): WatcherInternals {
    return this.svc as unknown as WatcherInternals;
  }

  private watcherIdle(): boolean {
    const state = this.internals();
    return (
      !state.stormBreaker.isStorming &&
      state.debounceTimer === null &&
      state.gitOpsDebounceTimer === null &&
      state.contentChangeTimer === null &&
      state.stormTimer === null &&
      state.initialFetchTimer === null &&
      // A pending 30 s safety refresh would land inside the measured window.
      state.unattributedChangeTimer === null &&
      // An own-refresh echo window would change how delete events are handled.
      state.ownRefreshesInFlight === 0 &&
      Date.now() >= state.ownRefreshEchoUntil
    );
  }
}
