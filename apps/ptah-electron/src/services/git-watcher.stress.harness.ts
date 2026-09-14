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
 * spawning the real git binary through a counting `IProcessSpawner`, a real
 * `GitWatcherService`, and the real workspace feed — `ElectronWorkspaceWatcher`
 * supervising the built `workspace-watch-host.mjs` over `@parcel/watcher`
 * (TASK_2026_437 C10). The host runs as a `child_process.fork` child rather
 * than the app's `utilityProcess`, which needs Electron; the host entry
 * supports both transports and everything past the transport is identical.
 * The bundle is the one `build-workspace-watch-host` writes, which the
 * `ptah-electron:test` target builds first.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, fork, spawn, type ChildProcess } from 'child_process';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import { GitInfoService, type Logger } from '@ptah-extension/vscode-core';
import type {
  IProcessSpawner,
  ProcessErrorListener,
  ProcessExitListener,
  ProcessSpawnRequest,
  SpawnedProcessHandle,
  WorkspaceChangeBatch,
  WorkspaceWatchHostProcess,
} from '@ptah-extension/platform-core';
import { ElectronWorkspaceWatcher } from '@ptah-extension/platform-electron';

import { GitWatcherService } from './git-watcher.service';

const CHECKOUTS = 10;
const FILES_PER_DIR = 10;

/** How long the armed watcher must be idle before the measured window opens. */
const QUIET_BASELINE_MS = 3_000;

/** `dist/apps/ptah-electron/workspace-watch-host.mjs`, from this file's location. */
const WORKSPACE_WATCH_HOST_BUNDLE = path.resolve(
  __dirname,
  '../../../../dist/apps/ptah-electron/workspace-watch-host.mjs',
);

let gitExecutable: string | undefined;

/**
 * The git binary as an absolute path, found once by walking the absolute
 * entries of PATH in-process. Spawning the bare name `git` lets the OS search
 * PATH at exec time, including relative or writable entries (Sonar
 * typescript:S4036); this spawns nothing to find it and fails loudly when git
 * is missing, exactly as the bare call would have.
 * Production code solves the same problem in `gitCommand()`
 * (`libs/backend/vscode-core/src/utils/exec-git.ts`).
 */
function resolveGitExecutable(): string {
  if (gitExecutable !== undefined) return gitExecutable;
  // `.exe` only: execFileSync cannot run a `.cmd`/`.bat` shim without a shell.
  const name = process.platform === 'win32' ? 'git.exe' : 'git';
  for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, name);
    if (fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) {
      gitExecutable = candidate;
      return candidate;
    }
  }
  throw new Error(
    `git-watcher stress rig: no ${name} on an absolute PATH entry`,
  );
}

/** Runs git synchronously in `cwd` through the resolved absolute binary. */
function runGit(args: readonly string[], cwd: string): void {
  execFileSync(resolveGitExecutable(), args, { cwd });
}

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

/** The built watch host as a forked Node child behind the adapter's process port. */
class ForkedWatchHostProcess implements WorkspaceWatchHostProcess {
  private readonly child: ChildProcess;

  constructor(bundlePath: string) {
    this.child = fork(bundlePath, [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    // An IPC write racing a kill surfaces as 'error'; the exit follows it.
    this.child.on('error', () => undefined);
  }

  postMessage(message: unknown): void {
    if (this.child.connected) this.child.send(message as object);
  }

  on(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'exit', listener: (code: number | null) => void): void;
  on(
    event: 'message' | 'exit',
    listener: ((message: unknown) => void) | ((code: number | null) => void),
  ): void {
    if (event === 'message') {
      this.child.on('message', listener as (message: unknown) => void);
    } else {
      this.child.on('exit', (code) =>
        (listener as (code: number | null) => void)(code),
      );
    }
  }

  kill(): void {
    this.child.kill();
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
  debounceTimer: unknown;
  gitOpsDebounceTimer: unknown;
  contentChangeTimer: unknown;
  initialFetchTimer: unknown;
  nestedRootsRefreshTimer: unknown;
  onWorkspaceBatch(generation: number, batch: WorkspaceChangeBatch): void;
}

export class GitWatcherStressRig {
  readonly workspaceRoot: string;
  readonly warnLines: string[] = [];
  readonly pushes: PushRecord[] = [];
  private readonly spawner = new CountingProcessSpawner();
  private readonly workspaceWatcher: ElectronWorkspaceWatcher;
  private readonly svc: GitWatcherService;
  /** Every batch the port delivered since the baseline: arrival time and shape. */
  readonly batchLog: Array<{
    readonly at: number;
    readonly overflow: boolean;
    readonly truncated: boolean;
    readonly paths: number;
  }> = [];
  /** Batches the port delivered to the watcher since the baseline, by shape. */
  batches = 0;
  overflowBatches = 0;
  truncatedBatches = 0;
  /** Paths carried by normal batches, and events the host reported as dropped. */
  changedPaths = 0;
  droppedEvents = 0;
  /** `update` changes whose path is a directory when the batch arrives (NTFS echo probe). */
  directoryUpdates = 0;
  /** The first few changes normal batches carried, for the log line. */
  readonly sampleChanges: string[] = [];

  constructor() {
    if (!fs.existsSync(WORKSPACE_WATCH_HOST_BUNDLE)) {
      throw new Error(
        `git-watcher stress rig: ${WORKSPACE_WATCH_HOST_BUNDLE} is missing; run \`npx nx run ptah-electron:build-workspace-watch-host\``,
      );
    }
    this.workspaceRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-437-st-')),
    );
    runGit(['init', '-q'], this.workspaceRoot);
    // Deterministic identity so git never blocks on a prompt.
    runGit(['config', 'user.email', 'stress@ptah.test'], this.workspaceRoot);
    runGit(['config', 'user.name', 'ptah-stress'], this.workspaceRoot);

    const noop = (): void => undefined;
    const logger = {
      info: noop,
      debug: noop,
      error: noop,
      warn: (message: string) => {
        this.warnLines.push(message);
      },
    } as unknown as Logger;
    this.workspaceWatcher = new ElectronWorkspaceWatcher({
      host: {
        fork: () => new ForkedWatchHostProcess(WORKSPACE_WATCH_HOST_BUNDLE),
      },
      onDiagnostic: ({ level, message }) => {
        if (level !== 'info') this.warnLines.push(message);
      },
    });
    this.svc = new GitWatcherService(
      new GitInfoService(logger, this.spawner),
      logger,
      this.workspaceWatcher,
    );

    // Count what the port actually delivered, so a run's log explains its own
    // outcome (a storm arrives as one overflow batch, not thousands of paths).
    const internals = this.internals();
    const deliver = internals.onWorkspaceBatch.bind(this.svc);
    internals.onWorkspaceBatch = (generation, batch) => {
      this.batches++;
      this.batchLog.push({
        at: Date.now(),
        overflow: batch.overflow,
        truncated: batch.truncated,
        paths: batch.changes.length,
      });
      if (batch.overflow) this.overflowBatches++;
      if (batch.truncated) this.truncatedBatches++;
      this.changedPaths += batch.changes.length;
      this.droppedEvents += batch.droppedCount;
      for (const change of batch.changes) {
        if (this.sampleChanges.length < 5) {
          this.sampleChanges.push(
            `${change.kind}:${path.relative(this.workspaceRoot, change.path)}@${Date.now()}`,
          );
        }
        if (
          change.kind === 'update' &&
          fs.statSync(change.path, { throwIfNoEntry: false })?.isDirectory()
        ) {
          this.directoryUpdates++;
        }
      }
      deliver(generation, batch);
    };
  }

  /**
   * Arms the watcher, waits for the initial status push, then waits until the
   * watcher has held no queued work, no live git child, and received no batch,
   * spawn or push for {@link QUIET_BASELINE_MS}. Only then are the counters
   * reset.
   *
   * Arming right after writing thousands of files can deliver a trail of
   * events from the OS; without this gate that trail could land inside the
   * measured window.
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
    let batchesSeen = this.batches;
    while (Date.now() - quietSince < QUIET_BASELINE_MS) {
      if (Date.now() > deadline) {
        throw new Error(`watcher did not go idle within ${timeoutMs} ms`);
      }
      await sleep(100);
      if (
        !this.watcherIdle() ||
        this.spawner.liveChildren > 0 ||
        this.spawner.calls.length !== spawnsSeen ||
        this.pushes.length !== pushesSeen ||
        this.batches !== batchesSeen
      ) {
        spawnsSeen = this.spawner.calls.length;
        pushesSeen = this.pushes.length;
        batchesSeen = this.batches;
        quietSince = Date.now();
      }
    }

    this.pushes.length = 0;
    this.spawner.calls = [];
    this.warnLines.length = 0;
    this.batches = 0;
    this.batchLog.length = 0;
    this.overflowBatches = 0;
    this.truncatedBatches = 0;
    this.changedPaths = 0;
    this.droppedEvents = 0;
    this.directoryUpdates = 0;
    this.sampleChanges.length = 0;
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

  /** One log line with every mechanism count, for printing before assertions. */
  describe(label: string, window: DeleteWindow): string {
    const { delay } = window;
    return (
      `[${label}] delete=${window.deleteEndedAt - window.deleteStartedAt}ms ` +
      `batches=${this.batches} overflow=${this.overflowBatches} truncated=${this.truncatedBatches} ` +
      `paths=${this.changedPaths} dropped=${this.droppedEvents} dirUpdates=${this.directoryUpdates} ` +
      `sample=[${this.sampleChanges.join(', ')}] ` +
      `refreshCycles=${this.refreshCycles().length} statusSpawns=${this.statusSpawns().length} spawns=${this.spawnCount()} ` +
      `statusPushes=${this.statusPushes().length} contentPushes=${this.contentPushes().length} ` +
      `loop p50=${delay.p50Ms.toFixed(2)}ms p99=${delay.p99Ms.toFixed(2)}ms max=${delay.maxMs.toFixed(2)}ms`
    );
  }

  dispose(): void {
    this.svc.stop();
    this.workspaceWatcher.dispose();
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
      state.debounceTimer === null &&
      state.gitOpsDebounceTimer === null &&
      state.contentChangeTimer === null &&
      state.initialFetchTimer === null &&
      state.nestedRootsRefreshTimer === null
    );
  }
}
