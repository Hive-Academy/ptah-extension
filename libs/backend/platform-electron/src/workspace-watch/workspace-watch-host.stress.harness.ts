/**
 * Test harness: the reusable rig for ST-2 / AC-7 (TASK_2026_437 Batch 15),
 * against the REAL packaged watch host: `ElectronWorkspaceWatcher`
 * (platform-electron) supervising the built
 * `dist/apps/ptah-electron/workspace-watch-host.mjs` over the REAL
 * `@parcel/watcher` engine, forked as a `child_process.fork` child (the
 * entry's own transport auto-detect; the app forks it as a `utilityProcess`
 * instead, and everything past the transport is identical). Not imported by
 * production code.
 *
 * Extracted from `workspace-watch-host.stress.spec.ts` per the Batch 15
 * style review (serious #1): a same-lib `.stress.harness.ts` beside its spec
 * already has a precedent one directory over
 * (`libs/backend/platform-cli/src/workspace-watch/workspace-watch-host.bundle.harness.ts`),
 * so keeping the rig inside the spec file was never actually required by
 * "stay inside Task 15.1's one file" — the harness stays inside
 * `platform-electron`, the same project the spec lives in.
 *
 * ## Cleanup order (Batch 15 logic review, serious #2)
 *
 * Every scenario function below tears itself down in a `finally` block, in
 * this order: monitor child, subscription(s), watcher (which also kills its
 * host process), THEN the temp directory. A live native watch subscription
 * can hold Windows file/directory handles open under the root being removed;
 * disposing the watcher first (which kills the whole host PROCESS) releases
 * those handles before the delete runs. Each teardown step is wrapped in
 * {@link safely} so one failing step cannot skip the rest and leak a forked
 * host or monitor child.
 *
 * ## Duplication (Batch 15 style review, "what would you do differently")
 *
 * `apps/ptah-electron/src/services/git-watcher.stress.harness.ts` and
 * `workspace-watch-host.entry.spec.ts` each carry their own near-identical
 * forked-host wrapper, tree builder and event-loop-delay measurement. Sharing
 * one implementation across an `apps/*` project and this `libs/backend/*`
 * project would need either a `libs/shared`-style cross-cutting test-utility
 * package (this repo has none for platform-electron-specific test rigs) or a
 * deep relative import crossing the app/lib boundary, which
 * `@nx/enforce-module-boundaries` and this repo's own project-alias
 * convention both treat as a violation, not a shortcut. This file stays the
 * CANONICAL copy for `platform-electron`; the duplication with
 * `git-watcher.stress.harness.ts` is recorded as a follow-up (FU-15a), not
 * resolved, matching the FU-8d precedent this same header already cited in
 * the pre-split version of this file.
 */

import { fork, spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import type {
  IDisposable,
  WorkspaceChangeBatch,
  WorkspaceWatcherDegradation,
  WorkspaceWatcherDiagnostic,
  WorkspaceWatchHostProcess,
  WorkspaceWatchOptions,
} from '@ptah-extension/platform-core';
import { WORKSPACE_WATCH_LIMITS } from '@ptah-extension/platform-core';

import {
  ElectronWorkspaceWatcher,
  type ElectronWorkspaceWatcherOptions,
} from './electron-workspace-watcher';

const rssSampler = require('./workspace-watch-host-rss-sampler') as {
  sampleRssKb: (pid: number) => number | undefined;
};

/** `dist/apps/ptah-electron/workspace-watch-host.mjs`, from this file's location. */
export const WORKSPACE_WATCH_HOST_BUNDLE = path.resolve(
  __dirname,
  '../../../../../dist/apps/ptah-electron/workspace-watch-host.mjs',
);

/** Throws with a build hint when the bundle Task 15.1 requires is missing. */
export function ensureHostBundleExists(): void {
  if (!fs.existsSync(WORKSPACE_WATCH_HOST_BUNDLE)) {
    throw new Error(
      `workspace-watch-host stress rig: ${WORKSPACE_WATCH_HOST_BUNDLE} is missing; ` +
        'run `npx nx run ptah-electron:build-workspace-watch-host` first.',
    );
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(
  predicate: () => boolean,
  what: string,
  timeoutMs = 15_000,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
    }
    await sleep(intervalMs);
  }
}

/** A teardown step that must not skip the ones after it if it throws. */
function safely(step: () => void): void {
  try {
    step();
  } catch (error: unknown) {
    // degradation-audit: optional-capability — a failing teardown step must
    // not hide the ones after it; the leak this is guarding against is the
    // whole reason it exists (Batch 15 logic review, serious #2).
    console.error(
      '[workspace-watch-host.stress] a cleanup step failed:',
      error,
    );
  }
}

/**
 * The host's resident set size, read from the OS by PID — the protocol
 * carries no self-reported memory figure. Best-effort: a platform quirk
 * (missing `/proc`, a locale-shifted `Get-Process` column) returns
 * `undefined` rather than failing an otherwise-passing mechanism assertion,
 * matching how this suite treats every other RECORDED-not-ASSERTED number
 * (R-P10). Delegates to the SAME implementation {@link RssPeakMonitor} runs
 * out-of-process (`workspace-watch-host-rss-sampler.js`), so a platform-branch
 * fix only has one place to land (Batch 15 style review, serious #3).
 *
 * SYNCHRONOUS, and only ever called OUTSIDE a measured event-loop-delay
 * window (the `rssBefore`/`rssAfter` single samples). On Windows and macOS it
 * spawns a whole process; `child_process` process creation on Windows
 * (`uv_spawn`) is NOT fully offloaded to the libuv threadpool, so calling this
 * — or anything that spawns — from INSIDE the measured window would inject
 * the spawn's own cost into the metric being measured. See
 * {@link RssPeakMonitor} for how the repeated in-window sampling avoids that.
 */
export function readHostRssKb(pid: number | undefined): number | undefined {
  if (pid === undefined) return undefined;
  try {
    return rssSampler.sampleRssKb(pid);
  } catch {
    // degradation-audit: optional-capability — test-rig measurement only: an
    // RSS sample that cannot be read (host already exited, tool missing) is
    // recorded as "not sampled", never asserted, and never reaches product code.
    return undefined;
  }
}

/**
 * Samples a PID's RSS repeatedly WITHOUT spawning anything in THIS process.
 *
 * The first version of this rig polled RSS from inside the measured window
 * with `execFile`/`execFileSync` called directly here, once per sample. Even
 * the async form still calls into `child_process.spawn`, and `uv_spawn` on
 * Windows does real synchronous work on the calling loop thread (creating
 * the child, its pipes, its process record) before the child ever runs —
 * every sample was itself a small main-loop stall, repeated every 250 ms for
 * the whole delete+settle window. Fixed by moving ALL of the actual sampling
 * into ONE persistent child process, spawned once, kept running for the
 * whole window: the child runs `workspace-watch-host-rss-sampler.js` directly
 * (a real file, linted, sharing `sampleRssKb` with {@link readHostRssKb} — not
 * an inline unchecked string) and reports each reading, or each failure, back
 * over the existing IPC channel. Errors are REPORTED (`errors()`), never
 * silently swallowed (Batch 15 style review, serious #3).
 */
export class RssPeakMonitor {
  private readonly child: ChildProcess;
  private peak: number | undefined;
  private readonly sampleErrors: string[] = [];

  constructor(pid: number, intervalMs: number) {
    const scriptPath = path.join(
      __dirname,
      'workspace-watch-host-rss-sampler.js',
    );
    this.child = spawn(
      process.execPath,
      [scriptPath, String(pid), String(intervalMs)],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
    );
    this.child.on('message', (message: unknown) => {
      const parsed = message as
        | { type: 'sample'; kb: unknown }
        | { type: 'error'; message: unknown }
        | null;
      if (parsed?.type === 'sample' && typeof parsed.kb === 'number') {
        if (this.peak === undefined || parsed.kb > this.peak) {
          this.peak = parsed.kb;
        }
      } else if (parsed?.type === 'error') {
        this.sampleErrors.push(String(parsed.message));
      }
    });
    this.child.on('error', (error: Error) => {
      this.sampleErrors.push(`monitor process error: ${error.message}`);
    });
  }

  /** The highest RSS sample seen, or `undefined` if none arrived yet. */
  peakKb(): number | undefined {
    return this.peak;
  }

  /** Every sampling failure reported by the monitor child, oldest first. */
  errors(): readonly string[] {
    return this.sampleErrors;
  }

  stop(): void {
    if (this.child.connected) this.child.send('stop');
    this.child.kill();
  }
}

/**
 * Deletes `targetPath` recursively in a SEPARATE node process, so the
 * potentially large amount of `fs` work a 75,000-file recursive delete does
 * never runs on the process whose event loop `measureEventLoopDelay` is
 * measuring. The first version of this rig ran `fs.promises.rm` directly in
 * the Jest process being measured — conflating "how long the watch host's
 * own IPC chatter costs the main process" (what ST-2 exists to prove) with
 * "how long this process's own recursive delete costs itself" (a fact about
 * `fs.rm`, not about the product). Moving the delete out is what the REAL
 * incident and production actually look like too: the agent process that
 * deletes ten worktrees is never the Electron main process.
 */
export function deleteInChildProcess(targetPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        'require("fs").rmSync(process.argv[1], { recursive: true, force: true });',
        targetPath,
      ],
      { stdio: 'ignore' },
    );
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`delete child exited with code ${String(code)}`));
    });
  });
}

/**
 * The built watch host as a forked Node child behind the adapter's process
 * port. Named distinctly from `git-watcher.stress.harness.ts`'s own
 * `ForkedWatchHostProcess` (Batch 15 style review, minor #2 — same shape,
 * unrelated file, no reason to invite a reader to assume they are one type).
 */
export class WatchHostChildProcess implements WorkspaceWatchHostProcess {
  private readonly child: ChildProcess;
  private stderrTail = '';
  private readonly subscribedIds = new Set<number>();

  constructor(bundlePath: string) {
    this.child = fork(bundlePath, [], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-4096);
    });
    this.child.on('message', (message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'subscribed' &&
        'id' in message &&
        typeof message.id === 'number'
      ) {
        this.subscribedIds.add(message.id);
      }
    });
    // An IPC write racing a kill surfaces as 'error'; the exit follows it.
    this.child.on('error', () => undefined);
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  /** `null` once the child has exited; otherwise `null` too (still running). */
  get exitCode(): number | null {
    return this.child.exitCode;
  }

  hasSubscriptionCount(count: number): boolean {
    return this.subscribedIds.size >= count;
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

  readStderrTail(): string {
    return this.stderrTail;
  }

  /** Terminates the host through the wrapper (graceful path; AC-7 kills the real pid instead). */
  kill(): void {
    this.child.kill();
  }
}

export function makeTempRoot(): string {
  return fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-437-b15-')),
  );
}

export function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/**
 * Plain files across ~`files / 10` directories, 10 per directory — the
 * acceptance table's "~7,500 directories at 75,000 files" ratio at any size.
 * No `.git` shape: ST-2 exercises the raw watch host, not nested-repo
 * detection (already covered by the contract suite and the entry spec).
 */
export function buildTree(root: string, files: number): string[] {
  const paths: string[] = [];
  const perDir = 10;
  let written = 0;
  for (let dirIndex = 0; written < files; dirIndex++) {
    const dir = path.join(root, `d${dirIndex}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < perDir && written < files; i++) {
      const file = path.join(dir, `f${i}.txt`);
      fs.writeFileSync(file, 'x');
      paths.push(file);
      written++;
    }
  }
  return paths;
}

export interface EventLoopDelay {
  readonly p50Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

/**
 * Runs `work`, measuring THIS PROCESS's own event-loop delay throughout — the
 * stand-in for "the main thread" the way `git-watcher.stress.harness.ts` uses
 * it: this test process is the one thing that must never block while the
 * host does its work in a separate process.
 */
export async function measureEventLoopDelay(
  work: () => Promise<void>,
): Promise<EventLoopDelay> {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  await work();
  histogram.disable();
  return {
    p50Ms: histogram.percentile(50) / 1e6,
    p99Ms: histogram.percentile(99) / 1e6,
    maxMs: histogram.max / 1e6,
  };
}

/** Records every batch delivered to one subscription, with arrival time. */
export class BatchRecorder {
  readonly batches: Array<{ at: number; batch: WorkspaceChangeBatch }> = [];
  readonly diagnostics: WorkspaceWatcherDiagnostic[] = [];
  degradations = 0;

  readonly listener = (batch: WorkspaceChangeBatch): void => {
    this.batches.push({ at: Date.now(), batch });
  };

  readonly onDiagnostic = (diagnostic: WorkspaceWatcherDiagnostic): void => {
    this.diagnostics.push(diagnostic);
  };

  readonly onDegraded = (_degradation: WorkspaceWatcherDegradation): void => {
    this.degradations++;
  };

  overflowBatches(): number {
    return this.batches.filter(({ batch }) => batch.overflow).length;
  }

  changedPaths(): number {
    return this.batches.reduce(
      (sum, { batch }) => sum + batch.changes.length,
      0,
    );
  }

  droppedTotal(): number {
    return this.batches.reduce((sum, { batch }) => sum + batch.droppedCount, 0);
  }

  hasPath(absolutePath: string): boolean {
    return this.batches.some(({ batch }) =>
      batch.changes.some(
        (change) => path.resolve(change.path) === path.resolve(absolutePath),
      ),
    );
  }

  /**
   * ONLY a genuine native-error-diagnosed signal (`workspace-watch-host-core.ts`'s
   * `postError('native-error', ...)`) — never the generic supervisor-level
   * `'[WorkspaceWatcher] host restarted'` line, which fires for fork/post/
   * heartbeat/exit failures too (Batch 15 logic review, moderate — the field
   * used to conflate the two under one `nativeErrorSeen` name).
   */
  nativeErrorDiagnosed(): boolean {
    return this.diagnostics.some((d) => d.message.includes('native-error'));
  }

  /** Any supervisor-level restart, for ANY reason (fork/post/heartbeat/exit/native-error alike). */
  hostRestartedDuringRun(): boolean {
    return this.diagnostics.some((d) =>
      d.message.includes('[WorkspaceWatcher] host restarted'),
    );
  }
}

const DEFAULT_WATCH_OPTIONS: WorkspaceWatchOptions = {
  excludeGlobs: [],
  excludeDirNames: [],
  excludeSegmentRules: [],
  nestedRepoDetection: false,
};

function newHostForkerAndHosts(hosts: WatchHostChildProcess[]): {
  fork: () => WatchHostChildProcess;
} {
  return {
    fork: () => {
      const host = new WatchHostChildProcess(WORKSPACE_WATCH_HOST_BUNDLE);
      hosts.push(host);
      return host;
    },
  };
}

export function makeWatcher(
  hosts: WatchHostChildProcess[],
  recorder: BatchRecorder,
  supervision?: ElectronWorkspaceWatcherOptions['supervision'],
): ElectronWorkspaceWatcher {
  return new ElectronWorkspaceWatcher({
    host: newHostForkerAndHosts(hosts),
    onDiagnostic: recorder.onDiagnostic,
    onDegraded: recorder.onDegraded,
    supervision,
  });
}

export interface MassDeleteStormResult {
  readonly fileCount: number;
  readonly deleteMs: number;
  readonly delay: EventLoopDelay;
  readonly batches: number;
  readonly overflowBatches: number;
  readonly changedPaths: number;
  readonly droppedTotal: number;
  readonly rssBeforeKb: number | undefined;
  /** `null` means "never sampled" (monitor never spawned or never got one reading) — never silently `rssBeforeKb`. */
  readonly rssPeakKb: number | null;
  readonly rssAfterKb: number | undefined;
  readonly hostRestarts: number;
  readonly hostExitedUnexpectedly: boolean;
  readonly nativeErrorDiagnosed: boolean;
  readonly hostRestartedDuringRun: boolean;
  readonly rssMonitorErrors: readonly string[];
}

/**
 * ST-2: builds `fileCount` files under a subdirectory of a fresh temp root,
 * arms the real watch host, deletes that subdirectory (never the root — see
 * the module header), and measures this process's own event-loop delay
 * across the delete + `settleMs` settle window.
 *
 * Tears itself down in a `finally` block, dispose-before-delete, each step
 * isolated (see the module header "Cleanup order").
 */
export async function runMassDeleteStorm(
  fileCount: number,
  settleMs: number,
): Promise<MassDeleteStormResult> {
  const root = makeTempRoot();
  // Delete a SUBTREE, never the watched root itself: the 2026-09-14 incident
  // and ST-1/ST-1b both mass-delete a directory UNDER the watched workspace
  // root (`.claude-worktrees/`, `pkgs/big/`) — the root itself is always
  // still there for the watcher to keep reporting into. An earlier version of
  // this rig deleted `root` itself, which tore down the native watch along
  // with the directory it was watching; recreating the same path afterwards
  // is a fresh inode the engine never re-subscribes to on its own, so
  // "delivery resumes" timed out for a reason this suite does not exist to
  // prove (watching a directory that no longer exists).
  const churn = path.join(root, 'churn');
  buildTree(churn, fileCount);

  const hosts: WatchHostChildProcess[] = [];
  const recorder = new BatchRecorder();
  const watcher = makeWatcher(hosts, recorder);

  let subscription: IDisposable | undefined;
  let monitor: RssPeakMonitor | undefined;
  try {
    subscription = watcher.watch(
      root,
      DEFAULT_WATCH_OPTIONS,
      recorder.listener,
    );

    // Settle before measuring: the host walks + subscribes the whole tree on
    // first watch, and that walk itself must not be counted as the storm.
    await waitFor(
      () => hosts.length > 0 && hosts[0]?.pid !== undefined,
      'the host to fork',
    );
    await sleep(2_000);
    recorder.batches.length = 0;

    const rssBefore = readHostRssKb(hosts[0]?.pid);
    // Spawned and settled BEFORE the measured window opens: its own startup
    // cost (one `uv_spawn`) must not be attributed to the storm either.
    const hostPidForMonitor = hosts[0]?.pid;
    monitor =
      hostPidForMonitor === undefined
        ? undefined
        : new RssPeakMonitor(hostPidForMonitor, 250);
    await sleep(100); // let the monitor take its first sample

    const deleteStartedAt = Date.now();
    const delay = await measureEventLoopDelay(async () => {
      // Out-of-process delete and no in-window spawning from RSS sampling:
      // everything this window can observe now comes from the watch host's
      // own IPC traffic into this process, not from the rig's own work.
      await deleteInChildProcess(churn);
      await sleep(settleMs);
    });
    const deleteEndedAt = Date.now();

    const rssPeak = monitor?.peakKb() ?? null;
    const rssMonitorErrors = monitor?.errors() ?? [];
    const rssAfter = readHostRssKb(hosts.at(-1)?.pid);

    // Delivery resumes: a later single-file write under the STILL-WATCHED
    // root (never deleted) must still be observed after the storm.
    const resumeProbe = path.join(root, 'after-storm.txt');
    writeFile(resumeProbe, 'x');
    await waitFor(
      () => recorder.hasPath(resumeProbe),
      'delivery to resume after the storm',
      20_000,
    );

    return {
      fileCount,
      deleteMs: deleteEndedAt - deleteStartedAt,
      delay,
      batches: recorder.batches.length,
      overflowBatches: recorder.overflowBatches(),
      changedPaths: recorder.changedPaths(),
      droppedTotal: recorder.droppedTotal(),
      rssBeforeKb: rssBefore,
      rssPeakKb: rssPeak,
      rssAfterKb: rssAfter,
      hostRestarts: hosts.length - 1,
      hostExitedUnexpectedly: hosts.some((h) => h.exitCode !== null),
      nativeErrorDiagnosed: recorder.nativeErrorDiagnosed(),
      hostRestartedDuringRun: recorder.hostRestartedDuringRun(),
      rssMonitorErrors,
    };
  } finally {
    safely(() => monitor?.stop());
    safely(() => subscription?.dispose());
    safely(() => watcher.dispose());
    safely(() => fs.rmSync(root, { recursive: true, force: true }));
  }
}

export interface SingleKillResult {
  readonly restartMs: number;
  readonly overflowA: number;
  readonly overflowB: number;
  readonly delay: EventLoopDelay;
  readonly isDegraded: boolean;
}

/**
 * AC-7: two subscriptions on two roots behind ONE host; kills the host's real
 * pid with `SIGKILL`; waits for the supervisor to fork a replacement within
 * `restartTimeoutMs` (the CI mechanism spec passes a generous timeout and
 * asserts nothing numeric on it; the perf spec passes the actual 3,000 ms
 * budget, so a slow restart fails this `waitFor` itself — Batch 15 logic
 * review, moderate: the ms bound now lives only where `PTAH_PERF_SPECS`
 * chooses to assert it).
 */
export async function runSingleKillScenario(
  restartTimeoutMs: number,
): Promise<SingleKillResult> {
  const hosts: WatchHostChildProcess[] = [];
  const recorderA = new BatchRecorder();
  const recorderB = new BatchRecorder();
  const watcher = makeWatcher(hosts, recorderA);

  const rootA = makeTempRoot();
  const rootB = makeTempRoot();
  let subA: IDisposable | undefined;
  let subB: IDisposable | undefined;
  try {
    subA = watcher.watch(rootA, DEFAULT_WATCH_OPTIONS, recorderA.listener);
    subB = watcher.watch(rootB, DEFAULT_WATCH_OPTIONS, recorderB.listener);

    await waitFor(() => hosts.length > 0, 'the first host to fork');
    await waitFor(
      () => hosts[0]?.hasSubscriptionCount(2) === true,
      'both initial host subscription acknowledgements',
    );

    const doomedPid = hosts[0]?.pid;
    if (doomedPid === undefined) {
      throw new Error('host pid unavailable before the kill');
    }

    let restartMs = -1;
    const killedAt = Date.now();
    const delay = await measureEventLoopDelay(async () => {
      // REAL kill of the host pid — not the wrapper's own kill() call — per
      // the task's instruction to kill the actual forked process.
      process.kill(doomedPid, 'SIGKILL');
      await waitFor(
        () => hosts.length > 1,
        'the supervisor to fork a replacement host',
        restartTimeoutMs,
      );
      restartMs = Date.now() - killedAt;
      await waitFor(
        () =>
          recorderA.overflowBatches() >= 1 && recorderB.overflowBatches() >= 1,
        'both subscribers to receive the incident overflow',
      );
      await waitFor(
        () => hosts[1]?.hasSubscriptionCount(2) === true,
        'both replacement host subscription acknowledgements',
      );
    });

    const resumedA = path.join(rootA, 'after-kill.txt');
    writeFile(resumedA, 'x');
    await waitFor(
      () => recorderA.hasPath(resumedA),
      'delivery to resume on the surviving subscription after the restart',
    );

    return {
      restartMs,
      overflowA: recorderA.overflowBatches(),
      overflowB: recorderB.overflowBatches(),
      delay,
      isDegraded: watcher.isDegraded,
    };
  } finally {
    safely(() => subA?.dispose());
    safely(() => subB?.dispose());
    safely(() => watcher.dispose());
    safely(() => fs.rmSync(rootA, { recursive: true, force: true }));
    safely(() => fs.rmSync(rootB, { recursive: true, force: true }));
  }
}

export interface DegradedPathResult {
  readonly restarts: number;
  readonly degradations: number;
  readonly overflowTotal: number;
  /** Overflow batches delivered up to the moment `isDegraded` first became true. */
  readonly overflowAtDegraded: number;
  /** Overflow batches delivered after ~3 rescan cadences of waiting while degraded. */
  readonly overflowAfterCadenceWait: number;
}

const DEGRADED_SCENARIO_SUPERVISION = {
  heartbeatIntervalMs: 200,
  missedHeartbeatsBeforeRestart: 2,
  restartBudget: 2,
  restartWindowMs: 5_000,
  restartDelayMs: 50,
  degradedRescanIntervalMs: 300,
  degradedRecoveryDelayMs: 700,
} as const satisfies NonNullable<
  ElectronWorkspaceWatcherOptions['supervision']
>;

const DEGRADED_RECOVERY_ACK_TIMEOUT_MS =
  DEGRADED_SCENARIO_SUPERVISION.heartbeatIntervalMs *
  DEGRADED_SCENARIO_SUPERVISION.missedHeartbeatsBeforeRestart;
const DEGRADED_RECOVERY_LOAD_MARGIN_MS = 15_000;
const DEGRADED_DELIVERY_TIMEOUT_MS =
  DEGRADED_SCENARIO_SUPERVISION.degradedRecoveryDelayMs +
  DEGRADED_RECOVERY_ACK_TIMEOUT_MS +
  2 * WORKSPACE_WATCH_LIMITS.minBatchIntervalMs +
  DEGRADED_RECOVERY_LOAD_MARGIN_MS;

/** Whole-scenario Jest budget, derived from its supervision windows plus load margin. */
export const DEGRADED_SCENARIO_TEST_TIMEOUT_MS =
  3 *
    (DEGRADED_RECOVERY_ACK_TIMEOUT_MS +
      DEGRADED_SCENARIO_SUPERVISION.restartDelayMs +
      DEGRADED_SCENARIO_SUPERVISION.degradedRescanIntervalMs) +
  DEGRADED_SCENARIO_SUPERVISION.degradedRecoveryDelayMs +
  DEGRADED_RECOVERY_ACK_TIMEOUT_MS +
  DEGRADED_DELIVERY_TIMEOUT_MS +
  DEGRADED_RECOVERY_LOAD_MARGIN_MS;

async function probeUntilDelivered(
  root: string,
  recorder: BatchRecorder,
): Promise<void> {
  const resumed = path.join(root, 'after-recovery.txt');
  const deadline = Date.now() + DEGRADED_DELIVERY_TIMEOUT_MS;
  let attempt = 0;

  while (!recorder.hasPath(resumed)) {
    writeFile(resumed, String(++attempt));
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${DEGRADED_DELIVERY_TIMEOUT_MS} ms waiting for delivery to resume after recovery (${attempt} probes)`,
      );
    }
    await sleep(WORKSPACE_WATCH_LIMITS.minBatchIntervalMs);
  }
}

/**
 * AC-7 degraded path: repeated real kills past a SHORTENED restart budget
 * (a real, documented `WorkspaceWatchSupervisorOptions.supervision`
 * constructor option, not a mock of internals — see the mechanism spec's own
 * `describe` header for which parts are real-time vs shortened).
 */
export async function runDegradedPastBudgetScenario(): Promise<DegradedPathResult> {
  const hosts: WatchHostChildProcess[] = [];
  const recorder = new BatchRecorder();
  const watcher = makeWatcher(
    hosts,
    recorder,
    DEGRADED_SCENARIO_SUPERVISION,
  );

  const root = makeTempRoot();
  let sub: IDisposable | undefined;
  try {
    sub = watcher.watch(root, DEFAULT_WATCH_OPTIONS, recorder.listener);

    await waitFor(() => hosts.length > 0, 'the first host to fork');
    await sleep(500);

    // 3 failures with restartBudget=2 exceeds the budget (failureTimes.length
    // > restartBudget) and enters degraded on the 3rd.
    for (let i = 0; i < 3; i++) {
      const pid = hosts.at(-1)?.pid;
      const hostsBefore = hosts.length;
      if (pid !== undefined) process.kill(pid, 'SIGKILL');
      await waitFor(
        () => hosts.length > hostsBefore || watcher.isDegraded,
        `restart or degradation after kill #${i + 1}`,
      );
      await sleep(150);
    }

    await waitFor(() => watcher.isDegraded, 'the watcher to become degraded');

    // Counts returned, not asserted here: the harness reports facts, the spec
    // asserts them with `expect(...)` like every other check (review follow-up
    // — a hand-rolled `if (...) throw` inside the harness was the odd one out).
    const overflowAtDegraded = recorder.overflowBatches();
    await sleep(
      3 * DEGRADED_SCENARIO_SUPERVISION.degradedRescanIntervalMs,
    );
    const overflowAfterCadenceWait = recorder.overflowBatches();

    // Stop killing; recovery is confirmed only by a fresh `subscribed` ack,
    // which the watcher surfaces as `isDegraded` flipping back to false.
    await waitFor(
      () => !watcher.isDegraded,
      'the watcher to recover',
      DEGRADED_SCENARIO_SUPERVISION.degradedRecoveryDelayMs +
        DEGRADED_RECOVERY_ACK_TIMEOUT_MS +
        DEGRADED_RECOVERY_LOAD_MARGIN_MS,
    );

    // A single filesystem notification is not a reliable readiness probe on a
    // loaded shared runner. Recovery is already native-subscription-ack gated;
    // keep writing at the real coalescer cadence until one change is observed.
    await probeUntilDelivered(root, recorder);

    return {
      restarts: hosts.length - 1,
      degradations: recorder.degradations,
      overflowTotal: recorder.overflowBatches(),
      overflowAtDegraded,
      overflowAfterCadenceWait,
    };
  } finally {
    safely(() => sub?.dispose());
    safely(() => watcher.dispose());
    safely(() => fs.rmSync(root, { recursive: true, force: true }));
  }
}

// Re-exported so the spec files can type their own diagnostics-handling code
// without a second import from `@ptah-extension/platform-core`.
export type { WorkspaceWatcherDegradation, WorkspaceWatcherDiagnostic };
