/**
 * CpuProfileCapture — turns "Ptah hung" into a flame graph (TASK_2026_323).
 *
 * ## Why an in-process inspector session
 *
 * `EventLoopMonitor` proves the loop is blocked; it cannot say by what. The
 * usual answer is to attach a debugger — but the hang under investigation has
 * no known reproduction trigger, so by the time anyone thinks to attach, the
 * evidence is gone. `node:inspector`'s `Session` lets the process profile
 * ITSELF, with no port open, no `--inspect` flag, and no restart. The V8 CPU
 * profiler samples on its own thread, so it keeps sampling through the stall.
 *
 * The output is a plain `.cpuprofile` JSON file. Chrome DevTools and VS Code
 * both open it directly, and the blocking frame is the widest bar.
 *
 * ## Single-flight, on purpose
 *
 * Two overlapping `Profiler.start` calls on one session is a protocol error,
 * and the situation that triggers a capture (a stall) is exactly the situation
 * that produces a burst of duplicate triggers — several lag windows in a row,
 * plus possibly a user hitting the IPC channel or the VS Code command. So a
 * second `captureFor` while one is running returns the SAME promise rather
 * than starting or refusing anything. Every caller gets the same valid path.
 */

import { inject, injectable } from 'tsyringe';
import { Session, type Profiler } from 'node:inspector';
import { mkdir, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IPlatformInfo } from '@ptah-extension/platform-core';
import { TOKENS } from '../di/tokens';
import type { Logger } from '../logging/logger';
import type { EventLoopLagSample } from './event-loop-monitor';
import { readMsEnv } from './env-thresholds';

/** Set to a millisecond lag threshold to enable unattended capture. */
export const CPU_PROFILE_ON_LAG_MS_ENV = 'PTAH_PROFILE_ON_LAG_MS';

/** Overrides the directory profiles are written to. */
export const CPU_PROFILE_DIR_ENV = 'PTAH_PROFILE_DIR';

/**
 * 10 s. Long enough to span a stall and capture the frames around it, short
 * enough that the resulting file stays in the low tens of MB and DevTools can
 * still open it.
 */
export const DEFAULT_CPU_PROFILE_DURATION_MS = 10_000;

/**
 * 5 minutes between unattended captures. Without a floor, a machine that is
 * persistently lagging would profile continuously — each capture costing CPU on
 * an already-struggling process and filling the log directory with near
 * identical files. One profile per five minutes is plenty: if the stall is
 * recurring, the first capture already contains it.
 */
export const AUTO_CAPTURE_COOLDOWN_MS = 5 * 60_000;

/**
 * Captures V8 CPU profiles on demand and, optionally, on sustained lag.
 *
 * Registered as a singleton under `TOKENS.CPU_PROFILE_CAPTURE`. Hosts call
 * {@link configure} once with their real log directory; everything else works
 * without configuration.
 */
@injectable()
export class CpuProfileCapture {
  private inFlight: Promise<string> | undefined;
  private configuredLogsPath: string | undefined;
  private lastAutoCaptureAt = Number.NEGATIVE_INFINITY;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO, { isOptional: true })
    private readonly platformInfo: IPlatformInfo | undefined,
  ) {}

  /**
   * Tell the capture where to write.
   *
   * There is no logs-directory port on `IPlatformInfo`, and each host resolves
   * its own differently (Electron `app.getPath('logs')`, VS Code
   * `context.logUri.fsPath`, CLI `~/.ptah/logs`). Rather than add a port and
   * force all three adapters to change for one diagnostic, the host that
   * already knows the answer hands it over here.
   */
  configure(logsPath: string): void {
    this.configuredLogsPath = logsPath;
  }

  /** True while a capture is running. */
  get capturing(): boolean {
    return this.inFlight !== undefined;
  }

  /**
   * Profile the process for `durationMs` and write the result.
   *
   * @returns Absolute path of the written `.cpuprofile` file.
   */
  captureFor(
    durationMs: number = DEFAULT_CPU_PROFILE_DURATION_MS,
  ): Promise<string> {
    const existing = this.inFlight;
    if (existing !== undefined) return existing;

    const run = this.runCapture(durationMs).finally(() => {
      this.inFlight = undefined;
    });
    this.inFlight = run;
    return run;
  }

  /**
   * Auto-capture hook — subscribe this to `EventLoopMonitor.onLag`.
   *
   * Does nothing unless `PTAH_PROFILE_ON_LAG_MS` is set, so the default build
   * carries the capability at zero cost. The env var is read per call rather
   * than cached at boot so it can be set on a long-running desktop session
   * without a restart.
   */
  handleLag(sample: EventLoopLagSample): void {
    const thresholdMs = readMsEnv(CPU_PROFILE_ON_LAG_MS_ENV);
    if (thresholdMs === undefined || sample.maxMs < thresholdMs) return;

    const now = Date.now();
    if (now - this.lastAutoCaptureAt < AUTO_CAPTURE_COOLDOWN_MS) return;
    this.lastAutoCaptureAt = now;

    this.logger.warn('[cpu-profile] lag over auto-capture threshold', {
      maxMs: sample.maxMs,
      thresholdMs,
      durationMs: DEFAULT_CPU_PROFILE_DURATION_MS,
    });
    void this.captureFor(DEFAULT_CPU_PROFILE_DURATION_MS).catch(
      (error: unknown) => {
        this.logger.warn('[cpu-profile] auto-capture failed', {
          reason: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }

  /**
   * Run one capture end to end.
   *
   * The session is connected per capture rather than held open for the process
   * lifetime: an idle connected inspector session is a live V8 debugger
   * attachment, which suppresses some optimisations. Diagnostics that are off
   * must cost nothing.
   */
  private async runCapture(durationMs: number): Promise<string> {
    const session = new Session();
    session.connect();
    try {
      await enableProfiler(session);
      await startProfiler(session);
      await unrefDelay(durationMs);
      const profile = await stopProfiler(session);

      const file = path.join(
        await this.resolveProfileDir(),
        `ptah-${timestampSlug()}.cpuprofile`,
      );
      await writeFile(file, JSON.stringify(profile), 'utf8');

      // Deliberately `warn`, not `info`: a profile only ever exists because
      // something went wrong, and it is useless if the operator cannot find
      // the path in a log they are already filtering to warnings.
      this.logger.warn('[cpu-profile] captured', { path: file, durationMs });
      return file;
    } finally {
      try {
        session.disconnect();
      } catch (error: unknown) {
        this.logger.debug('[cpu-profile] session disconnect failed', {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Pick a directory and make sure it exists.
   *
   * Order: what the host configured, then the env override, then a `logs`
   * subdirectory of the platform's global storage, then the OS temp directory.
   * The last fallback is what guarantees `captureFor` never fails purely for
   * want of configuration — a profile in `%TEMP%` still answers the question.
   */
  private async resolveProfileDir(): Promise<string> {
    const fromEnv = process.env[CPU_PROFILE_DIR_ENV];
    const dir =
      this.configuredLogsPath ??
      (fromEnv !== undefined && fromEnv.trim() !== '' ? fromEnv : undefined) ??
      (this.platformInfo !== undefined
        ? path.join(this.platformInfo.globalStoragePath, 'logs')
        : undefined) ??
      os.tmpdir();
    await mkdir(dir, { recursive: true });
    return dir;
  }
}

/** `2026-08-26T14-03-11-482Z` — filename-safe and sorts chronologically. */
function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Sleep without pinning the process open.
 *
 * If the app is quitting mid-profile, the quit wins: the timer is unref'd, the
 * promise simply never settles, and the `finally` in {@link
 * CpuProfileCapture.runCapture} is skipped along with the rest of the process.
 * Losing a diagnostic is always preferable to blocking a shutdown.
 */
function unrefDelay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

function enableProfiler(session: Session): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    session.post('Profiler.enable', (error) => {
      if (error) reject(asError(error));
      else resolve();
    });
  });
}

function startProfiler(session: Session): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    session.post('Profiler.start', (error) => {
      if (error) reject(asError(error));
      else resolve();
    });
  });
}

function stopProfiler(session: Session): Promise<Profiler.Profile> {
  return new Promise<Profiler.Profile>((resolve, reject) => {
    session.post('Profiler.stop', (error, result) => {
      if (error) reject(asError(error));
      else if (result === undefined)
        reject(new Error('Profiler.stop returned no profile'));
      else resolve(result.profile);
    });
  });
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
