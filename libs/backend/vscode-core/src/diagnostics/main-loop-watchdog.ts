/**
 * MainLoopWatchdog — a hang record that does not depend on the hung loop
 * (TASK_2026_437, component 6, INV-8).
 *
 * ## Why this exists
 *
 * `EventLoopMonitor` measures lag accurately, but it REPORTS through a sampling
 * timer and the logger, and both run on the main loop. A block that lasts
 * longer than a few seconds is reported only after it ends; a block that ends
 * in a force-quit, an OS "not responding" kill or a crash is never reported at
 * all. That is exactly the incident this task investigates: the log simply
 * stopped.
 *
 * The watchdog moves the DECISION off the main thread. Main posts a heartbeat
 * every second; an eval'd `worker_threads` worker (source in
 * `main-loop-watchdog-source.ts`) notices when the heartbeats stop and appends
 * one synchronous line to `<logsPath>/ptah-hang.log` while the main loop is
 * still frozen, then one more line when it recovers.
 *
 * ## Breadcrumbs
 *
 * `setBreadcrumb(key, value)` attaches small context (the last lag sample)
 * to every heartbeat. The worker writes the breadcrumbs it last received, so a
 * hang line names what main was last known to be doing. Bounded in key count
 * and value length so a heartbeat stays one cheap `postMessage`.
 *
 * The RPC methods and MCP tools in flight and the last slow SQL label come
 * from `HangBreadcrumbs`, which pushes each change here; the watchdog then
 * posts a heartbeat at once rather than waiting up to a second, because the
 * operation that blocks main never lets the next interval tick run.
 *
 * ## Recovery enrichment
 *
 * With `onRecovered` set (the opt-in hang profiler), the worker hands the
 * recovery record back to main instead of appending it; main merges the
 * enricher's fields and appends through {@link appendHangLogLine}, bounded by
 * {@link RECOVERY_ENRICH_TIMEOUT_MS}.
 *
 * ## Worker death
 *
 * A worker that errors or exits on its own would silently turn hang detection
 * off. Each such death logs one warning and respawns the worker, up to
 * {@link MAX_WORKER_RESTARTS} times per {@link WORKER_RESTART_WINDOW_MS}. Past
 * that budget the watchdog logs ONE degraded line and stays down, so a worker
 * that dies on start cannot become a respawn loop.
 *
 * ## Why it never holds the process open
 *
 * Both the heartbeat interval and the worker are `unref()`-ed — the same rule
 * as `EventLoopMonitor` (see commit 5dc525f02 for the defect class).
 */

import { inject, injectable } from 'tsyringe';
import { Worker } from 'node:worker_threads';
import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { TOKENS } from '../di/tokens';
import type { Logger } from '../logging/logger';
import { MAIN_LOOP_WATCHDOG_WORKER_SOURCE } from './main-loop-watchdog-source';
import { hangBreadcrumbs, type HangBreadcrumbs } from './hang-breadcrumbs';
import {
  WatchdogRecoveredMessageSchema,
  type HangRecoveryEnricher,
  type WatchdogRecoveredMessage,
} from './main-loop-watchdog-protocol';

/** File name of the hang log inside the host's log directory. */
export const HANG_LOG_FILE_NAME = 'ptah-hang.log';

/**
 * 1 MiB. A hang line is ~300 bytes, so this holds thousands of incidents; past
 * it the file rotates to `ptah-hang.log.1`, bounding the pair at ~2 MiB.
 */
export const HANG_LOG_MAX_BYTES = 1_048_576;

/** 1 s. One `postMessage` per second is the whole steady-state cost. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000;

/**
 * 5 s. Well past `EventLoopMonitor`'s 250 ms warning band and past anything a
 * GC pause produces, so a line in the hang log always means a visible freeze.
 */
export const DEFAULT_HANG_THRESHOLD_MS = 5_000;

/** How often the worker compares "now" against the last heartbeat. */
export const DEFAULT_HANG_CHECK_INTERVAL_MS = 250;

/** Upper bound on distinct breadcrumb keys carried per heartbeat. */
export const MAX_BREADCRUMB_KEYS = 16;

/** Upper bound on one breadcrumb value, in characters. */
export const MAX_BREADCRUMB_VALUE_LENGTH = 200;

/** Worker respawns allowed inside one {@link WORKER_RESTART_WINDOW_MS}. */
export const MAX_WORKER_RESTARTS = 3;

/** Sliding window for the restart budget. */
export const WORKER_RESTART_WINDOW_MS = 10 * 60 * 1_000;

export interface MainLoopWatchdogOptions {
  /** Directory that receives `ptah-hang.log`. Created on first write. */
  logsPath: string;
  heartbeatIntervalMs?: number;
  hangThresholdMs?: number;
  checkIntervalMs?: number;
  /** Rotation cap for the hang log. Defaults to {@link HANG_LOG_MAX_BYTES}. */
  hangLogMaxBytes?: number;
  /**
   * In-flight RPC/MCP operations and the last slow SQL label, pushed into the
   * breadcrumbs on every change. Defaults to the process-wide
   * {@link hangBreadcrumbs}; specs pass their own.
   */
  breadcrumbSource?: HangBreadcrumbs;
  /**
   * When set, main writes the recovery line instead of the worker, merged with
   * what this returns (the opt-in hang profile). Absent, the worker writes it.
   */
  onRecovered?: HangRecoveryEnricher;
}

/**
 * 20 s. Upper bound on how long a recovery enricher may take before the line
 * is written without its extras — a stuck profiler must not lose the record.
 */
export const RECOVERY_ENRICH_TIMEOUT_MS = 20_000;

/** Message shape posted to the worker. Mirrors the source's protocol. */
interface HeartbeatMessage {
  type: 'heartbeat';
  breadcrumbs: Record<string, string>;
}

interface WorkerConfig {
  hangLogPath: string;
  hangLogMaxBytes: number;
  hangThresholdMs: number;
  checkIntervalMs: number;
  deferRecovery: boolean;
}

/**
 * Append one line to a hang log, rotating it to `<file>.1` first when it is
 * already at or past `maxBytes`. Synchronous on purpose: callers record events
 * that may be followed by an immediate process exit.
 *
 * The watchdog worker cannot import this; it runs `HANG_LOG_APPEND_SOURCE`, a
 * twin held equal by `main-loop-watchdog.spec.ts`. Change both together.
 *
 * @returns `true` when the line landed. Never throws.
 */
export function appendHangLogLine(
  hangLogPath: string,
  line: string,
  maxBytes: number = HANG_LOG_MAX_BYTES,
): boolean {
  try {
    fs.mkdirSync(dirname(hangLogPath), { recursive: true });
    const stat = fs.statSync(hangLogPath, { throwIfNoEntry: false });
    if (stat !== undefined && stat.size >= maxBytes) {
      rotateHangLog(hangLogPath);
    }
    fs.appendFileSync(hangLogPath, line, 'utf8');
    return true;
  } catch {
    // degradation-audit: optional-capability — the hang log is a diagnostic
    // extra; an unwritable log directory must never turn a record into a
    // throw. The boolean lets the caller fall back to its own logger line.
    return false;
  }
}

/**
 * Rename the full log aside, replacing any previous `.1`.
 *
 * @returns `false` when the rename failed — another writer rotated first, or a
 *   reader holds the file open on Windows. The caller appends regardless:
 *   an oversized file beats a lost record.
 */
function rotateHangLog(hangLogPath: string): boolean {
  try {
    fs.renameSync(hangLogPath, `${hangLogPath}.1`);
    return true;
  } catch {
    // degradation-audit: optional-capability — a lost rotation race only
    // delays the rotation to the next append; the record itself still lands.
    return false;
  }
}

/**
 * Registered as a singleton under `TOKENS.MAIN_LOOP_WATCHDOG` and NOT started
 * at registration. `armDiagnostics` starts it when the host supplies a
 * `logsPath`, and its handle disposes it.
 */
@injectable()
export class MainLoopWatchdog {
  private worker: Worker | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private config: WorkerConfig | undefined;
  private readonly breadcrumbs = new Map<string, string>();
  private restartTimes: number[] = [];
  private degraded = false;
  private detachBreadcrumbs: (() => void) | undefined;
  private onRecovered: HangRecoveryEnricher | undefined;
  /** Pending coalesced post for `end` changes; see scheduleCoalescedBeat. */
  private coalescedFlush: ReturnType<typeof setImmediate> | undefined;
  private coalescedDirty = false;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /** True while a worker is live (between `start()` and `dispose()`/degrade). */
  get running(): boolean {
    return this.worker !== undefined;
  }

  /** True once the restart budget is spent and the watchdog stopped for good. */
  get isDegraded(): boolean {
    return this.degraded;
  }

  /** Absolute path of the hang log, once started. */
  get hangLogPath(): string | undefined {
    return this.config?.hangLogPath;
  }

  /**
   * Record a piece of context for the next hang line. Keys past
   * {@link MAX_BREADCRUMB_KEYS} are dropped; an existing key is always
   * updatable. Values are truncated to {@link MAX_BREADCRUMB_VALUE_LENGTH}.
   * Safe to call before `start()` — the breadcrumbs ride the first heartbeat.
   */
  setBreadcrumb(key: string, value: string | number): void {
    if (
      !this.breadcrumbs.has(key) &&
      this.breadcrumbs.size >= MAX_BREADCRUMB_KEYS
    ) {
      return;
    }
    const text = String(value);
    this.breadcrumbs.set(
      key,
      text.length > MAX_BREADCRUMB_VALUE_LENGTH
        ? text.slice(0, MAX_BREADCRUMB_VALUE_LENGTH)
        : text,
    );
  }

  /**
   * Start the worker and the heartbeat. Idempotent — a second call while
   * running is a no-op, so two arming sites cannot produce two workers
   * writing duplicate lines.
   */
  start(options: MainLoopWatchdogOptions): void {
    if (this.worker !== undefined) return;

    const heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    const config: WorkerConfig = {
      hangLogPath: join(options.logsPath, HANG_LOG_FILE_NAME),
      hangLogMaxBytes: options.hangLogMaxBytes ?? HANG_LOG_MAX_BYTES,
      hangThresholdMs: options.hangThresholdMs ?? DEFAULT_HANG_THRESHOLD_MS,
      checkIntervalMs:
        options.checkIntervalMs ?? DEFAULT_HANG_CHECK_INTERVAL_MS,
      deferRecovery: options.onRecovered !== undefined,
    };
    this.config = config;
    this.onRecovered = options.onRecovered;
    this.degraded = false;
    this.restartTimes = [];
    this.spawnWorker(config);

    // Push, not sample: an operation that begins and then blocks main in the
    // same tick must already be in the worker's hands. See hang-breadcrumbs.ts.
    // So a `begin` (or a slow-SQL note) posts at once. Only an `end` may wait:
    // it cannot name a culprit, and a burst of RPC completions in one
    // macrotask then costs one post instead of one each.
    const source = options.breadcrumbSource ?? hangBreadcrumbs;
    this.detachBreadcrumbs = source.attach((crumbs, change) => {
      for (const [key, value] of Object.entries(crumbs)) {
        this.setBreadcrumb(key, value);
      }
      if (change === 'end') this.scheduleCoalescedBeat();
      else this.beat();
    });

    const heartbeat = setInterval(() => {
      this.beat();
    }, heartbeatIntervalMs);
    // Diagnostics never keep a process alive. See the class doc.
    heartbeat.unref();
    this.heartbeat = heartbeat;
    this.beat();

    this.logger.info('[watchdog] armed', {
      hangLogPath: config.hangLogPath,
      hangThresholdMs: config.hangThresholdMs,
      heartbeatIntervalMs,
    });
  }

  /**
   * Stop the heartbeat and terminate the worker. Safe when not running and
   * safe to call twice. The returned promise never rejects; callers in a
   * synchronous LIFO chain may `void` it.
   */
  async dispose(): Promise<void> {
    this.stopHeartbeat();
    this.detachBreadcrumbs?.();
    this.detachBreadcrumbs = undefined;
    const worker = this.worker;
    // Cleared BEFORE terminate, so the resulting `exit` is recognised as ours
    // and does not trigger a restart.
    this.worker = undefined;
    if (worker === undefined) return;
    try {
      await worker.terminate();
    } catch (error: unknown) {
      this.logger.debug('[watchdog] terminate failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private spawnWorker(config: WorkerConfig): void {
    const worker = new Worker(MAIN_LOOP_WATCHDOG_WORKER_SOURCE, {
      eval: true,
      workerData: config,
    });
    worker.unref();

    // `error` is always followed by `exit`; the reason is carried over so a
    // death produces exactly one warning line.
    let failure: string | undefined;
    worker.on('error', (error: Error) => {
      failure = error.message;
    });
    worker.on('exit', (code: number) => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      this.handleUnexpectedExit(config, code, failure);
    });
    if (config.deferRecovery) {
      worker.on('message', (raw: unknown) => {
        this.handleWorkerMessage(config, raw);
      });
    }
    this.worker = worker;
  }

  /**
   * The worker's only outbound message: a hang ended and main is to write
   * the recovery line. Parsed first — the worker is untyped source text.
   */
  private handleWorkerMessage(config: WorkerConfig, raw: unknown): void {
    const parsed = WatchdogRecoveredMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn('[watchdog] ignored malformed worker message', {
        issues: parsed.error.issues.length,
      });
      return;
    }
    void this.writeRecovery(config, parsed.data);
  }

  /**
   * Enrich and append the recovery line. Never rejects: the record lands with
   * or without the enricher's fields, and a failure is logged.
   */
  private async writeRecovery(
    config: WorkerConfig,
    message: WatchdogRecoveredMessage,
  ): Promise<void> {
    let extra: Record<string, unknown> = {};
    const enrich = this.onRecovered;
    if (enrich !== undefined) {
      try {
        extra = await withTimeout(
          enrich({
            hangStartedAt: message.hangStartedAt,
            blockedForMs: message.record.blockedForMs,
          }),
          RECOVERY_ENRICH_TIMEOUT_MS,
        );
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn('[watchdog] hang recovery enrichment failed', {
          reason,
        });
        extra = { hangProfileError: reason };
      }
    }
    const line = `${JSON.stringify({ ...message.record, ...extra })}\n`;
    if (!appendHangLogLine(config.hangLogPath, line, config.hangLogMaxBytes)) {
      this.logger.warn('[watchdog] recovery line could not be written', {
        hangLogPath: config.hangLogPath,
        blockedForMs: message.record.blockedForMs,
      });
    }
  }

  private handleUnexpectedExit(
    config: WorkerConfig,
    code: number,
    reason: string | undefined,
  ): void {
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter(
      (at) => now - at < WORKER_RESTART_WINDOW_MS,
    );

    if (this.restartTimes.length >= MAX_WORKER_RESTARTS) {
      this.stopHeartbeat();
      this.degraded = true;
      this.logger.error(
        '[watchdog] degraded — restart budget spent, hang records stopped',
        {
          code,
          reason,
          restarts: this.restartTimes.length,
          windowMs: WORKER_RESTART_WINDOW_MS,
        },
      );
      return;
    }

    this.restartTimes.push(now);
    this.logger.warn('[watchdog] worker died — restarting', {
      code,
      reason,
      restart: this.restartTimes.length,
      budget: MAX_WORKER_RESTARTS,
    });
    try {
      this.spawnWorker(config);
      this.beat();
    } catch (error: unknown) {
      this.stopHeartbeat();
      this.degraded = true;
      this.logger.error('[watchdog] degraded — worker respawn failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * At most one deferred post per macrotask for `end` changes. Any immediate
   * `beat()` before the flush already carried the latest breadcrumbs, so the
   * flush then posts nothing.
   */
  private scheduleCoalescedBeat(): void {
    this.coalescedDirty = true;
    if (this.coalescedFlush !== undefined) return;
    this.coalescedFlush = setImmediate(() => {
      this.coalescedFlush = undefined;
      if (this.coalescedDirty) this.beat();
    });
  }

  private beat(): void {
    this.coalescedDirty = false;
    const worker = this.worker;
    if (worker === undefined) return;
    const message: HeartbeatMessage = {
      type: 'heartbeat',
      breadcrumbs: Object.fromEntries(this.breadcrumbs),
    };
    worker.postMessage(message);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== undefined) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
    if (this.coalescedFlush !== undefined) {
      clearImmediate(this.coalescedFlush);
      this.coalescedFlush = undefined;
    }
  }
}

/** Reject after `ms` with an unref'd timer, so quitting is never held open. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);
    timer.unref();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
