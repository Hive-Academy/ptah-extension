/**
 * HangProfiler — an always-on, coarse CPU profile that is kept only when the
 * main loop hangs. Opt-in: `PTAH_HANG_PROFILE=1`.
 *
 * ## Why
 *
 * The hang log says THAT main froze and, with breadcrumbs, what was in flight.
 * It cannot say which frame burned the time — a freeze inside a timer, an
 * indexer batch or a native call has no breadcrumb. `CpuProfileCapture` starts
 * a profile AFTER lag is noticed, which is after the evidence is gone. This
 * keeps the V8 sampler running (it samples on its own thread, so it keeps
 * sampling through the block) and keeps the window only when the watchdog
 * reports a recovered hang.
 *
 * ## Bounds
 *
 * - Sampling interval {@link HANG_PROFILE_SAMPLING_INTERVAL_US} (10 ms): a
 *   30 s window holds ~3 000 samples.
 * - The profile is stopped and restarted every {@link HANG_PROFILE_ROTATE_MS},
 *   so V8 never holds more than one window plus the hang itself. A rotation
 *   tick that fires late (main was blocked) is skipped, so the rotation that
 *   was due during a hang cannot discard that hang's window. A rotation that
 *   falls due in the few milliseconds between the block ending and the
 *   worker's recovery message can still win the race; the line then ranks
 *   the fresh window and says so (`profileWindowed: false`).
 * - At most {@link MAX_HANG_PROFILES} files are kept in `<logs>/hang-profiles`;
 *   the oldest are deleted.
 *
 * ## Cost when on
 *
 * A connected inspector session is a live debugger attachment, which can cost
 * some optimisation; that is why this is opt-in and off by default.
 */
import { Session } from 'node:inspector';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Logger } from '../logging/logger';
import {
  CpuProfileSchema,
  summarizeSelfTime,
  type SelfTimeEntry,
} from './hang-profile-summary';
import type { HangRecoveryDetails } from './main-loop-watchdog-protocol';

/** Set to `1` to arm the hang profiler. */
export const HANG_PROFILE_ENV = 'PTAH_HANG_PROFILE';
export const HANG_PROFILE_THRESHOLD_ENV = 'PTAH_HANG_PROFILE_THRESHOLD_MS';
export const HANG_PROFILE_MIN_INTERVAL_MS = 30_000;
export const MAX_THRESHOLD_PROFILES = 20;
export const MAX_THRESHOLD_PROFILE_BYTES = 8 * 1024 * 1024;

/** Invalid values leave the existing watchdog-only behavior in place. */
export function readHangProfileThreshold(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env[HANG_PROFILE_THRESHOLD_ENV];
  if (raw === undefined || !/^[+-]?\d+$/.test(raw.trim())) return undefined;
  const value = Number(raw);
  return Math.max(250, Math.min(5_000, value));
}

/** Directory under the logs path that receives hang profiles. */
export const HANG_PROFILE_DIR_NAME = 'hang-profiles';

/** 10 ms. Coarse on purpose: a hang is seconds long. */
export const HANG_PROFILE_SAMPLING_INTERVAL_US = 10_000;

/** 30 s profile window. */
export const HANG_PROFILE_ROTATE_MS = 30_000;

/** A rotation tick later than this means main was blocked; skip it. */
export const HANG_PROFILE_LATE_TICK_MS = 1_000;

/** Profiles kept on disk. */
export const MAX_HANG_PROFILES = 10;

/** True when `PTAH_HANG_PROFILE=1`. */
export function isHangProfileEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[HANG_PROFILE_ENV]?.trim() === '1';
}

/**
 * The inspector surface this uses. A port, so specs drive a fake session and
 * never attach a real debugger to the Jest worker.
 */
export interface InspectorSessionPort {
  post(method: string, params?: object): Promise<unknown>;
  disconnect(): void;
}

/** Opens a connected session. */
export type InspectorSessionFactory = () => InspectorSessionPort;

/** Default factory: a real in-process `node:inspector` session. */
export function createInspectorSession(): InspectorSessionPort {
  const session = new Session();
  session.connect();
  return {
    post: (method, params) =>
      new Promise<unknown>((resolve, reject) => {
        session.post(method, params ?? {}, (error, result) => {
          if (error) reject(error);
          else resolve(result);
        });
      }),
    disconnect: () => session.disconnect(),
  };
}

export interface HangProfilerOptions {
  readonly logger: Pick<Logger, 'debug' | 'info' | 'warn'>;
  /** Host logs directory; profiles go to `<logsPath>/hang-profiles`. */
  readonly logsPath: string;
  readonly createSession?: InspectorSessionFactory;
  /** Epoch-ms clock. Test seam. */
  readonly now?: () => number;
  readonly rotateMs?: number;
  readonly thresholdMs?: number;
}

/** Fields merged into the recovery line. */
export interface HangProfileFields {
  readonly hangProfile: string;
  readonly topSelfTime: SelfTimeEntry[];
  readonly profiledMs: number;
  /** False when no sample fell in the hang window (whole window ranked). */
  readonly profileWindowed: boolean;
}

export class HangProfiler {
  private session: InspectorSessionPort | undefined;
  private rotateTimer: ReturnType<typeof setInterval> | undefined;
  private lastTickAt = 0;
  /**
   * True while V8 is sampling (a `Profiler.start` succeeded and no stop has
   * run since). A failed restart leaves it false, so the next rotation retries
   * the start instead of failing forever at `stop` ("not started").
   */
  private sampling = false;
  /** Serialises start/stop so a rotation and a capture never interleave. */
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;
  private lastCaptureAt = -Infinity;
  private captureCount = 0;
  private readonly now: () => number;
  private readonly rotateMs: number;
  private readonly createSession: InspectorSessionFactory;
  readonly profileDir: string;

  constructor(private readonly options: HangProfilerOptions) {
    this.now = options.now ?? Date.now;
    this.rotateMs = options.rotateMs ?? HANG_PROFILE_ROTATE_MS;
    this.createSession = options.createSession ?? createInspectorSession;
    this.profileDir = path.join(options.logsPath, HANG_PROFILE_DIR_NAME);
  }

  /** Connect, configure and start the first window. Resolves once sampling. */
  start(): Promise<void> {
    return this.enqueue(() => this.doStart());
  }

  private async doStart(): Promise<void> {
    if (this.session !== undefined || this.disposed) return;
    const session = this.createSession();
    try {
      await session.post('Profiler.enable');
      // Must precede `Profiler.start`; V8 ignores it while a profile runs.
      await session.post('Profiler.setSamplingInterval', {
        interval: HANG_PROFILE_SAMPLING_INTERVAL_US,
      });
      await session.post('Profiler.start');
    } catch (error: unknown) {
      // Leave no half-armed debugger attachment behind; the caller logs.
      session.disconnect();
      throw error;
    }
    this.session = session;
    this.sampling = true;
    this.lastTickAt = this.now();
    const timer = setInterval(() => this.onRotateTick(), this.rotateMs);
    timer.unref();
    this.rotateTimer = timer;
    this.options.logger.info('[hang-profile] armed', {
      profileDir: this.profileDir,
      samplingIntervalUs: HANG_PROFILE_SAMPLING_INTERVAL_US,
      rotateMs: this.rotateMs,
    });
  }

  /**
   * Stop the window holding the hang, write it, restart sampling, and return
   * the fields for the recovery line. Rejects when the profile cannot be
   * taken or written; the watchdog then writes the line without them.
   */
  captureHang(details: HangRecoveryDetails): Promise<HangProfileFields> {
    if (this.options.thresholdMs !== undefined) {
      const now = this.now();
      if (this.captureCount >= MAX_THRESHOLD_PROFILES ||
          now - this.lastCaptureAt < HANG_PROFILE_MIN_INTERVAL_MS) {
        return Promise.reject(new Error('hang profile rate limit reached'));
      }
      this.lastCaptureAt = now;
      this.captureCount++;
    }
    return this.enqueue(() => this.capture(details));
  }

  /**
   * Run `job` after every queued start/rotation/capture. The chain survives a
   * rejection; the caller still receives it.
   */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Stop sampling and disconnect. Idempotent. */
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.rotateTimer !== undefined) {
      clearInterval(this.rotateTimer);
      this.rotateTimer = undefined;
    }
    await this.chain;
    // A start already running when dispose began may have armed its timer.
    if (this.rotateTimer !== undefined) {
      clearInterval(this.rotateTimer);
      this.rotateTimer = undefined;
    }
    const session = this.session;
    this.session = undefined;
    if (session === undefined) return;
    try {
      if (this.sampling) await session.post('Profiler.stop');
    } catch (error: unknown) {
      this.options.logger.debug('[hang-profile] stop on dispose failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    this.sampling = false;
    session.disconnect();
  }

  /** Test seam and timer body: rotate unless the tick itself was late. */
  onRotateTick(): void {
    const now = this.now();
    const lateBy = now - this.lastTickAt - this.rotateMs;
    this.lastTickAt = now;
    // A late tick means main was just blocked; the recovery capture will
    // want this window, so leave it running.
    if (lateBy > HANG_PROFILE_LATE_TICK_MS) return;
    void this.enqueue(() => this.rotate());
  }

  private async rotate(): Promise<void> {
    const session = this.session;
    if (session === undefined || this.disposed) return;
    try {
      if (this.sampling) {
        await session.post('Profiler.stop');
        this.sampling = false;
      }
      await this.restartSampling(session);
    } catch (error: unknown) {
      this.options.logger.warn('[hang-profile] rotation failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async restartSampling(session: InspectorSessionPort): Promise<void> {
    await session.post('Profiler.start');
    this.sampling = true;
  }

  private async capture(
    details: HangRecoveryDetails,
  ): Promise<HangProfileFields> {
    const session = this.session;
    if (session === undefined || this.disposed) {
      throw new Error('hang profiler not running');
    }
    if (!this.sampling) {
      // A previous restart failed: there is no window to keep. Try to sample
      // again for the next hang, and answer this one without a profile.
      await this.restartSampling(session);
      throw new Error('hang profiler was not sampling');
    }
    const stoppedAt = this.now();
    const raw = await session.post('Profiler.stop');
    this.sampling = false;
    // Restart before the slow part (parse, write), so the next hang is
    // covered even while this one is being saved. A failed restart must not
    // cost this hang its profile; the next rotation retries it.
    try {
      await this.restartSampling(session);
    } catch (error: unknown) {
      this.options.logger.warn('[hang-profile] restart after capture failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    this.lastTickAt = this.now();

    const profileValue = extractProfile(raw);
    const profile = CpuProfileSchema.parse(profileValue);
    // Map the epoch-ms hang window onto the profile's microsecond clock,
    // anchored at the stop: `endTime` is the moment `stoppedAt` was read.
    const startUs =
      profile.endTime - (stoppedAt - details.hangStartedAt) * 1_000;
    const summary = summarizeSelfTime(profile, {
      startUs,
      endUs: startUs + details.blockedForMs * 1_000,
    });

    await mkdir(this.profileDir, { recursive: true });
    const file = path.join(
      this.profileDir,
      `${new Date(stoppedAt).toISOString().replace(/[:.]/g, '-')}.cpuprofile`,
    );
    const serialized = JSON.stringify(profileValue);
    if (this.options.thresholdMs !== undefined &&
        Buffer.byteLength(serialized, 'utf8') > MAX_THRESHOLD_PROFILE_BYTES) {
      throw new Error('hang profile exceeds size limit');
    }
    await writeFile(file, serialized, 'utf8');
    await this.prune();

    this.options.logger.warn('[hang-profile] captured', {
      path: file,
      blockedForMs: details.blockedForMs,
      top: summary.entries[0]?.fn,
    });
    return {
      hangProfile: file,
      topSelfTime: summary.entries,
      profiledMs: summary.sampledMs,
      profileWindowed: summary.windowed,
    };
  }

  /** Keep the newest {@link MAX_HANG_PROFILES}; names sort chronologically. */
  private async prune(): Promise<void> {
    const names = (await readdir(this.profileDir))
      .filter((name) => name.endsWith('.cpuprofile'))
      .sort();
    const excess = names.slice(
      0,
      Math.max(0, names.length - MAX_HANG_PROFILES),
    );
    for (const name of excess) {
      try {
        await unlink(path.join(this.profileDir, name));
      } catch (error: unknown) {
        this.options.logger.debug('[hang-profile] prune failed', {
          name,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/** `Profiler.stop` resolves `{ profile }`; take the profile out. */
function extractProfile(result: unknown): unknown {
  if (typeof result === 'object' && result !== null && 'profile' in result) {
    return result.profile;
  }
  throw new Error('Profiler.stop returned no profile');
}
