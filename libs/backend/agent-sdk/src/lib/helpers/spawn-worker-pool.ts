/**
 * `SpawnWorkerPool` — the thread side of `OffThreadProcessSpawner`.
 *
 * `OffThreadProcessSpawner` moved every `child_process.spawn` off the calling
 * thread (TASK_2026_341), but did it with one eval'd `Worker` per spawn. A
 * `Worker` is a whole V8 isolate, and in Electron every git child goes through
 * that spawner, so a status storm minted and destroyed one isolate per git call
 * (TASK_2026_437 C12). This file owns the fix: workers are lent to ONE child at
 * a time and taken back afterwards.
 *
 * **Bounds.**
 * - At most {@link POOL_MAX_IDLE} idle workers, each kept for
 *   {@link POOL_IDLE_TTL_MS} and `unref()`'d so it never holds the host open.
 * - Above {@link LIVE_WORKER_SOFT_CAP} busy workers a launch still gets a new
 *   thread — a foreground query must never queue behind background git — and
 *   the breach is warned and reported at most once a minute.
 * - At {@link LIVE_WORKER_HARD_CAP} live workers the pool refuses to lend
 *   ({@link SpawnWorkerPool.admit} returns `false`) and the spawner runs that
 *   child inline instead, so a runaway spawn loop cannot create unbounded
 *   threads. Blocking one launch beats an out-of-memory host.
 *
 * **Reuse is the borrower's verdict, vetoed by the pool.** The borrower passes
 * `reusable` to `release`; a worker the pool saw error or exit is terminated
 * whatever the borrower says.
 *
 * **Lease ids keep consecutive children apart.** Every message in both
 * directions carries the id of the lease that produced it; this file stamps
 * outgoing messages and drops incoming ones whose id is not the current lease.
 * See `off-thread-process-spawner-source.ts` for the worker half.
 */

import { Worker } from 'node:worker_threads';
import type { DegradationReporter, Logger } from '@ptah-extension/vscode-core';
import { OFF_THREAD_SPAWNER_WORKER_SOURCE } from './off-thread-process-spawner-source';

const SERVICE_TAG = '[SpawnWorkerPool]';

/** Idle workers kept for the next spawn. Anything beyond this is terminated. */
export const POOL_MAX_IDLE = 4;

/** How long an idle worker waits for a next child before it is terminated. */
export const POOL_IDLE_TTL_MS = 30_000;

/**
 * Busy workers beyond which a launch is still served, but reported.
 *
 * Not a hard cap on purpose: a launch that waited for a free worker would put a
 * user-visible query behind a background git storm, which is the coupling the
 * spawner exists to remove.
 */
export const LIVE_WORKER_SOFT_CAP = 24;

/**
 * Live workers at which the pool stops lending and the spawner spawns inline.
 *
 * Far above any legitimate load (the git gate allows 4 concurrent children), so
 * reaching it means a runaway loop — where an unbounded thread count is the
 * worse failure than one blocking `CreateProcessW` per launch.
 */
export const LIVE_WORKER_HARD_CAP = 64;

/** At most one warning and one degradation report per cap, per this window. */
const CAP_REPORT_INTERVAL_MS = 60_000;

/** Stable degradation codes. Never interpolated — see `rpc-degradation.types.ts`. */
const DEGRADE_SOFT_CAP = 'agent.spawn-worker.soft-cap';
const DEGRADE_HARD_CAP = 'agent.spawn-worker.hard-cap-inline';

/** Which stderr shape the caller asked for. See the worker source's header. */
export type StderrMode = 'stream' | 'callback' | 'ignore';

/** Worker -> host messages. Mirrors the protocol in the worker source. */
export type WorkerErrorMessage = {
  type: 'error';
  message: string;
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
};

/** Every worker message carries the id of the lease that produced it. */
export type WorkerMessage = { readonly id: number } & (
  | { type: 'spawned'; pid: number | null }
  | { type: 'stdout'; chunk: Uint8Array }
  | { type: 'stderr'; text: string }
  | { type: 'stderr-chunk'; chunk: Uint8Array }
  | { type: 'stdout-end' }
  | { type: 'stderr-end' }
  | { type: 'exit'; code: number | null; signal: NodeJS.Signals | null }
  | WorkerErrorMessage
);

/** Host -> worker messages, before the pool stamps the lease id on them. */
export type HostMessage =
  | {
      type: 'spawn';
      command: string;
      args: string[];
      cwd?: string;
      env: Record<string, string>;
      stderrMode: StderrMode;
      detached: boolean;
      windowsHide: boolean;
      windowsVerbatimArguments: boolean;
    }
  | { type: 'stdin'; chunk: Uint8Array }
  | { type: 'stdin-end' }
  | { type: 'kill'; signal: NodeJS.Signals }
  | { type: 'pause' }
  | { type: 'resume' };

/** An `Error` carrying the `code` the SDK's spawn-failure classifier reads. */
export interface SpawnFailure extends Error {
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
}

/** A failure of the worker THREAD, as opposed to the child it runs. */
export function workerError(message: string): Error {
  const error: SpawnFailure = new Error(message);
  error.code = 'EWORKER';
  return error;
}

/** Where a leased worker delivers what it hears, for the one child it serves. */
export interface SpawnWorkerSink {
  onMessage(message: WorkerMessage): void;
  /** The thread errored or exited while leased. Nothing more will arrive. */
  onWorkerLost(error: Error): void;
}

/** One worker, lent to one child. Stamps its id on everything it posts. */
export interface SpawnWorkerLease {
  /** Throws when the thread can no longer be reached. */
  post(message: HostMessage, transfer?: ArrayBuffer[]): void;
  /**
   * Give the worker back. `reusable` is the borrower's verdict that the child
   * exited cleanly and drained; the pool still refuses a worker it saw fail.
   */
  release(reusable: boolean): void;
}

/**
 * Lease ids are process-unique, not per pool, so a message can never match a
 * lease of another spawner instance either.
 */
let nextLeaseId = 1;

/**
 * One `worker_threads` Worker running the spawner source, reusable across
 * sequential children.
 *
 * Its listeners are attached once, for the thread's lifetime, and route to
 * whichever sink currently holds the lease — filtered by lease id, so output a
 * previous child posted late is dropped rather than delivered to the next one.
 */
class PooledSpawnWorker {
  private readonly worker: Worker;
  private sink: SpawnWorkerSink | null = null;
  private leaseId = 0;
  private lostFlag = false;
  private idleTimer: NodeJS.Timeout | null = null;

  /** Throws when the host cannot create a worker; the spawner falls back inline. */
  constructor(private readonly onLost: (target: PooledSpawnWorker) => void) {
    this.worker = new Worker(OFF_THREAD_SPAWNER_WORKER_SOURCE, { eval: true });
    this.worker.on('message', (raw: unknown) => {
      const message = raw as WorkerMessage;
      const sink = this.sink;
      if (sink && message.id === this.leaseId) sink.onMessage(message);
    });
    this.worker.on('error', (error: Error) => {
      this.lose(workerError(`Spawn worker failed: ${error.message}`));
    });
    this.worker.on('exit', () => {
      this.lose(workerError('Spawn worker exited before the child finished.'));
    });
  }

  get lost(): boolean {
    return this.lostFlag;
  }

  attach(sink: SpawnWorkerSink): void {
    this.clearIdleTimer();
    this.leaseId = nextLeaseId++;
    this.sink = sink;
    this.worker.ref();
  }

  /** Stop routing to the current sink. Late messages for its lease are dropped. */
  detach(): void {
    this.sink = null;
    this.leaseId = 0;
  }

  post(message: HostMessage, transfer?: ArrayBuffer[]): void {
    this.worker.postMessage({ ...message, id: this.leaseId }, transfer);
  }

  /** Idle in the pool: must not keep the host alive, and expires on its own. */
  park(onExpire: () => void): void {
    this.worker.unref();
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      onExpire();
    }, POOL_IDLE_TTL_MS);
    this.idleTimer.unref?.();
  }

  terminate(): Promise<void> {
    // Marked lost first so the 'exit' this causes is not reported as a failure.
    this.lostFlag = true;
    this.clearIdleTimer();
    this.detach();
    return this.worker.terminate().then(
      () => undefined,
      () => undefined,
    );
  }

  private lose(error: Error): void {
    if (this.lostFlag) return;
    this.lostFlag = true;
    this.clearIdleTimer();
    const sink = this.sink;
    this.detach();
    this.onLost(this);
    sink?.onWorkerLost(error);
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

/** Rate-limit state for one cap's warning + degradation report. */
interface CapBreach {
  /** Every breach since the pool was created. */
  count: number;
  /** Breaches since the last report, including the one being reported. */
  sinceLastReport: number;
  lastReportedAt: number | null;
}

function newBreach(): CapBreach {
  return { count: 0, sinceLastReport: 0, lastReportedAt: null };
}

/**
 * Lends spawn workers one child at a time and keeps a few idle ones warm.
 *
 * Owns every thread it created until that thread's `terminate()` settles, so
 * `dispose()` is a real join point.
 */
export class SpawnWorkerPool {
  private readonly idle: PooledSpawnWorker[] = [];
  private readonly busy = new Set<PooledSpawnWorker>();
  private readonly terminations = new Set<Promise<void>>();
  private readonly softCap = newBreach();
  private readonly hardCap = newBreach();

  constructor(
    private readonly logger: Logger,
    private readonly degradation: DegradationReporter | null,
  ) {}

  /**
   * Whether the next `acquire` may run. `false` means the pool is at
   * {@link LIVE_WORKER_HARD_CAP} with nothing idle; the refusal is reported
   * here, and the caller must spawn without a worker.
   */
  admit(): boolean {
    if (this.idle.length > 0 || this.busy.size < LIVE_WORKER_HARD_CAP) {
      return true;
    }
    this.noteBreach(this.hardCap, (sinceLastReport) => {
      const detail = `busyWorkers=${this.busy.size} hardCap=${LIVE_WORKER_HARD_CAP} inlineSinceLastReport=${sinceLastReport} refusals=${this.hardCap.count}`;
      this.logger.warn(
        `${SERVICE_TAG} Spawn workers at the hard cap — spawning inline, this launch blocks the calling thread`,
        {
          busyWorkers: this.busy.size,
          hardCap: LIVE_WORKER_HARD_CAP,
          inlineSinceLastReport: sinceLastReport,
          refusals: this.hardCap.count,
        },
      );
      this.degradation?.report({
        source: 'agent',
        code: DEGRADE_HARD_CAP,
        severity: 'critical',
        summary:
          'Spawn worker threads hit the hard cap; child processes are being spawned inline on the calling thread.',
        detail,
      });
    });
    return false;
  }

  /** Throws only when a NEW worker cannot be created. */
  acquire(sink: SpawnWorkerSink): SpawnWorkerLease {
    const worker = this.idle.pop() ?? this.create();
    this.busy.add(worker);
    worker.attach(sink);
    let released = false;
    return {
      post: (message, transfer) => worker.post(message, transfer),
      release: (reusable) => {
        if (released) return;
        released = true;
        this.release(worker, reusable);
      },
    };
  }

  async dispose(): Promise<void> {
    for (const worker of this.idle.splice(0)) this.track(worker.terminate());
    await Promise.all([...this.terminations]);
  }

  private create(): PooledSpawnWorker {
    const worker = new PooledSpawnWorker((target) => this.onLost(target));
    // `create` runs before `acquire` adds the worker to `busy`, so the thread
    // being created now is `busy.size + 1`.
    if (this.busy.size >= LIVE_WORKER_SOFT_CAP) this.noteSoftCap();
    return worker;
  }

  private release(worker: PooledSpawnWorker, reusable: boolean): void {
    this.busy.delete(worker);
    worker.detach();
    if (reusable && !worker.lost && this.idle.length < POOL_MAX_IDLE) {
      this.idle.push(worker);
      worker.park(() => this.expire(worker));
      return;
    }
    this.track(worker.terminate());
  }

  private expire(worker: PooledSpawnWorker): void {
    const index = this.idle.indexOf(worker);
    if (index === -1) return;
    this.idle.splice(index, 1);
    this.track(worker.terminate());
  }

  /** A thread that errored or exited on its own: forget it, and make sure it is gone. */
  private onLost(worker: PooledSpawnWorker): void {
    this.busy.delete(worker);
    const index = this.idle.indexOf(worker);
    if (index !== -1) this.idle.splice(index, 1);
    this.track(worker.terminate());
  }

  private track(termination: Promise<void>): void {
    this.terminations.add(termination);
    void termination.then(() => {
      this.terminations.delete(termination);
    });
  }

  private noteSoftCap(): void {
    this.noteBreach(this.softCap, (sinceLastReport) => {
      const busyWorkers = this.busy.size + 1;
      this.logger.warn(
        `${SERVICE_TAG} Spawn workers above the soft cap — spawning anyway`,
        {
          busyWorkers,
          softCap: LIVE_WORKER_SOFT_CAP,
          overCapSinceLastReport: sinceLastReport,
          overCapSpawns: this.softCap.count,
        },
      );
      this.degradation?.report({
        source: 'agent',
        code: DEGRADE_SOFT_CAP,
        severity: 'degraded',
        summary:
          'More spawn worker threads are busy than the soft cap; extra threads are being created.',
        detail: `busyWorkers=${busyWorkers} softCap=${LIVE_WORKER_SOFT_CAP} overCapSinceLastReport=${sinceLastReport} overCapSpawns=${this.softCap.count}`,
      });
    });
  }

  /**
   * Count every breach; warn and report at most once per window.
   *
   * The report is rate-limited like the log line because a storm is exactly
   * when per-spawn reports would flood the renderer broadcast. What the window
   * suppresses is not lost: the breaches accumulated since the previous report
   * are handed to the next one, which carries them in `detail`.
   */
  private noteBreach(
    breach: CapBreach,
    report: (sinceLastReport: number) => void,
  ): void {
    breach.count++;
    breach.sinceLastReport++;
    const now = Date.now();
    if (
      breach.lastReportedAt !== null &&
      now - breach.lastReportedAt < CAP_REPORT_INTERVAL_MS
    ) {
      return;
    }
    breach.lastReportedAt = now;
    const sinceLastReport = breach.sinceLastReport;
    breach.sinceLastReport = 0;
    report(sinceLastReport);
  }
}
