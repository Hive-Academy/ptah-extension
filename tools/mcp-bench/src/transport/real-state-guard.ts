/**
 * Proves a bench run left the user's real Ptah state alone.
 *
 * The bench hosts run isolated (temp HOME/USERPROFILE, explicit userData and
 * database paths). This guard is the after-the-fact check on top of that
 * isolation, in one of two modes chosen before the run:
 *
 * - `hash`: nothing else is writing the real database. The real
 *   `~/.ptah/state/ptah.sqlite`, its `-wal` and its `-shm` are stat-ed and
 *   SHA-256 hashed (read-only) before the spawn and after the host is gone;
 *   any change fails the run with {@link RealStateChangedError}. A file absent
 *   both times is unchanged.
 * - `process-watch`: another process (typically the user's running desktop
 *   Ptah) is writing the real database, so a hash comparison would blame the
 *   bench for that writer's work. Instead the open file handles of the bench
 *   host's process tree are sampled during the run and once more before it is
 *   stopped; any bench process holding a path under the real `~/.ptah` fails
 *   the run with {@link BenchHeldRealStateError}. A bench process that opens
 *   and closes a real file between two samples is not seen — the isolation
 *   layers, not this guard, are what keep it from opening one at all.
 *
 * A concurrent writer is detected by the open-handle probe (another process
 * holds the real database) or by a short pre-sample (the real `-wal` changes
 * while the guard watches). Under `CI=true` the mode is always `hash`, and a
 * concurrent writer there is an environment error
 * ({@link ConcurrentWriterError}): CI has no business running a desktop Ptah.
 * Where open handles cannot be listed (any platform but win32 and linux),
 * detection is the pre-sample alone, and a detected writer is also an
 * {@link ConcurrentWriterError}, because process-watch cannot run there.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { platformHandleProbe, type HandleProbe } from './open-handle-probe';

/** One guarded file, as seen at one moment. */
export interface GuardedFileState {
  readonly path: string;
  readonly exists: boolean;
  readonly size: number | null;
  readonly mtimeMs: number | null;
  readonly sha256: string | null;
}

export interface RealStateSnapshot {
  readonly takenAt: string;
  readonly files: readonly GuardedFileState[];
}

export type GuardMode = 'hash' | 'process-watch';

/** Thrown when the user's real database changed across a `hash`-mode run. */
export class RealStateChangedError extends Error {
  constructor(
    readonly before: RealStateSnapshot,
    readonly after: RealStateSnapshot,
    readonly changed: readonly string[],
  ) {
    super(
      `The real Ptah database changed during the bench run (${changed.join(', ')}). ` +
        'Isolation is not proven: if a desktop Ptah or VS Code host was running, close it and re-run.',
    );
    this.name = 'RealStateChangedError';
  }
}

/** One bench process seen holding a real path. */
export interface HeldRealPath {
  readonly pid: number;
  readonly name: string;
  readonly path: string;
}

/** Thrown when a bench process held a path under the real `~/.ptah`. */
export class BenchHeldRealStateError extends Error {
  constructor(readonly held: readonly HeldRealPath[]) {
    super(
      'A bench process held a path under the real ~/.ptah: ' +
        held.map((h) => `${h.name || 'pid'} ${h.pid} → ${h.path}`).join('; ') +
        '. Isolation is broken; the run is void.',
    );
    this.name = 'BenchHeldRealStateError';
  }
}

/** The environment cannot give a run a valid guard. Not a code failure. */
export class ConcurrentWriterError extends Error {
  constructor(
    message: string,
    readonly evidence: readonly string[],
  ) {
    super(`${message} Evidence: ${evidence.join('; ')}.`);
    this.name = 'ConcurrentWriterError';
  }
}

/** The files the `hash` guard watches under a home directory. */
export function guardedStatePaths(home: string): string[] {
  const db = join(home, '.ptah', 'state', 'ptah.sqlite');
  return [db, `${db}-wal`, `${db}-shm`];
}

/** Stat and hash each guarded file. Read-only; a missing file is a state too. */
export async function snapshotRealState(
  home: string = homedir(),
): Promise<RealStateSnapshot> {
  const files = await Promise.all(
    guardedStatePaths(home).map(async (path): Promise<GuardedFileState> => {
      try {
        const info = await stat(path);
        return {
          path,
          exists: true,
          size: info.size,
          mtimeMs: info.mtimeMs,
          sha256: await hashFile(path),
        };
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return { path, exists: false, size: null, mtimeMs: null, sha256: null };
      }
    }),
  );
  return { takenAt: new Date().toISOString(), files };
}

/** The guarded paths whose state differs between two snapshots. */
export function changedPaths(
  before: RealStateSnapshot,
  after: RealStateSnapshot,
): string[] {
  return before.files.flatMap((was, index) => {
    const now = after.files[index];
    return now === undefined ||
      now.path !== was.path ||
      now.exists !== was.exists ||
      now.size !== was.size ||
      now.mtimeMs !== was.mtimeMs ||
      now.sha256 !== was.sha256
      ? [was.path]
      : [];
  });
}

/** Throws {@link RealStateChangedError} when any guarded file differs. */
export function assertRealStateUnchanged(
  before: RealStateSnapshot,
  after: RealStateSnapshot,
): void {
  const changed = changedPaths(before, after);
  if (changed.length > 0)
    throw new RealStateChangedError(before, after, changed);
}

function hashFile(path: string): Promise<string> {
  return new Promise((done, reject) => {
    const hash = createHash('sha256');
    createReadStream(path, { flags: 'r' })
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => done(hash.digest('hex')));
  });
}

export interface RealStateGuardOptions {
  /** Home whose `.ptah` is guarded. Default `os.homedir()`. */
  readonly realHome?: string;
  /** Force `hash` and treat a concurrent writer as an environment error. Default `CI === 'true'`. */
  readonly ci?: boolean;
  /** How long the pre-sample watches the real `-wal`. Default 2 s. */
  readonly preSampleMs?: number;
  /** Gap between process-watch samples during the run. Default 10 s. */
  readonly sampleIntervalMs?: number;
  /** Open-handle probe. Default: this platform's, or none. */
  readonly probe?: HandleProbe | null;
}

/** What the guard concluded; `launchBenchHost` and the Electron host return it. */
export type GuardReport =
  | {
      readonly mode: 'hash';
      readonly before: RealStateSnapshot;
      readonly after: RealStateSnapshot;
    }
  | {
      readonly mode: 'process-watch';
      /** Why a concurrent writer was assumed. */
      readonly writerEvidence: readonly string[];
      /** Completed handle samples of the bench tree (periodic plus final). */
      readonly samples: number;
      /** Most processes one sample found in the bench tree. */
      readonly maxTreeProcesses: number;
      /** Most open file paths one sample found in the bench tree. */
      readonly maxOpenPaths: number;
      /** Most handles one sample could not name (see `open-handle-probe.ts`). */
      readonly unprobed: number;
    };

const DEFAULT_PRE_SAMPLE_MS = 2_000;
const DEFAULT_SAMPLE_INTERVAL_MS = 10_000;

/**
 * Decide the guard mode, then hand back a guard to arm on the bench host.
 * Call before the host is spawned.
 */
export async function armRealStateGuard(
  options: RealStateGuardOptions = {},
): Promise<RealStateGuard> {
  const realHome = options.realHome ?? homedir();
  const ci = options.ci ?? process.env['CI'] === 'true';
  const probe =
    options.probe === undefined ? platformHandleProbe() : options.probe;
  const preSampleMs = options.preSampleMs ?? DEFAULT_PRE_SAMPLE_MS;

  const evidence: string[] = [];
  if (probe !== null) {
    const result = await probe.holders(guardedStatePaths(realHome));
    const names = new Map(result.processes.map((p) => [p.pid, p.name]));
    for (const [path, pids] of result.holders) {
      for (const pid of pids) {
        if (pid === process.pid) continue;
        evidence.push(`${names.get(pid) || 'pid'} ${pid} holds ${path}`);
      }
    }
  }
  let before = await snapshotRealState(realHome);
  if (evidence.length === 0 && preSampleMs > 0) {
    await new Promise((done) => setTimeout(done, preSampleMs));
    const after = await snapshotRealState(realHome);
    for (const path of changedPaths(before, after)) {
      evidence.push(`${path} changed during a ${preSampleMs} ms pre-sample`);
    }
    before = after;
  }

  if (evidence.length === 0)
    return new RealStateGuard('hash', realHome, null, [], before, 0);
  if (ci) {
    throw new ConcurrentWriterError(
      'Environment error: something else is writing the real Ptah database in CI ' +
        '(CI=true forces the hash guard, which cannot pass with a concurrent writer). ' +
        'Run the bench on a runner with no Ptah app or host running.',
      evidence,
    );
  }
  if (probe === null) {
    throw new ConcurrentWriterError(
      `Environment error: a concurrent writer of the real Ptah database was detected, ` +
        `and open file handles cannot be listed on ${process.platform}, so process-watch cannot run. ` +
        'Close the desktop Ptah (or any VS Code host) and re-run.',
      evidence,
    );
  }
  return new RealStateGuard(
    'process-watch',
    realHome,
    probe,
    evidence,
    before,
    options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS,
  );
}

export class RealStateGuard {
  private rootPid: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private sampling: Promise<void> | null = null;
  private samples = 0;
  private maxTreeProcesses = 0;
  private maxOpenPaths = 0;
  private unprobed = 0;
  private readonly held: HeldRealPath[] = [];
  private sampleError: unknown = null;
  private stopped = false;

  constructor(
    readonly mode: GuardMode,
    private readonly realHome: string,
    private readonly probe: HandleProbe | null,
    readonly writerEvidence: readonly string[],
    private readonly before: RealStateSnapshot,
    private readonly sampleIntervalMs: number,
  ) {}

  /** Start watching the host's process tree. A no-op in `hash` mode. */
  watch(rootPid: number): void {
    if (this.mode !== 'process-watch' || this.stopped) return;
    this.rootPid = rootPid;
    this.schedule();
  }

  /**
   * The final process-watch sample, taken while the host is still alive.
   * Call right before the host is stopped. A no-op in `hash` mode.
   */
  async sampleBeforeStop(): Promise<void> {
    this.stopped = true;
    this.clearTimer();
    if (this.mode !== 'process-watch' || this.rootPid === null) return;
    await this.sampling;
    await this.sample();
  }

  /**
   * Stop sampling and give the verdict. Call after the host is gone.
   * Throws {@link BenchHeldRealStateError} (process-watch) or
   * {@link RealStateChangedError} (hash).
   */
  async finish(): Promise<GuardReport> {
    this.stopped = true;
    this.clearTimer();
    await this.sampling;
    if (this.mode === 'hash') {
      const after = await snapshotRealState(this.realHome);
      assertRealStateUnchanged(this.before, after);
      return { mode: 'hash', before: this.before, after };
    }
    if (this.held.length > 0) throw new BenchHeldRealStateError(this.held);
    if (this.sampleError !== null) throw this.sampleError;
    return {
      mode: 'process-watch',
      writerEvidence: this.writerEvidence,
      samples: this.samples,
      maxTreeProcesses: this.maxTreeProcesses,
      maxOpenPaths: this.maxOpenPaths,
      unprobed: this.unprobed,
    };
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sampling = this.sample().then(() => {
        this.sampling = null;
        if (!this.stopped && this.held.length === 0) this.schedule();
      });
    }, this.sampleIntervalMs);
    this.timer.unref();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Never rejects: a violation or a probe failure is kept for `finish()`. */
  private async sample(): Promise<void> {
    if (this.probe === null || this.rootPid === null) return;
    try {
      const realDirs = await realPtahDirs(this.realHome);
      const result = await this.probe.treeOpenPaths(this.rootPid);
      const names = new Map(result.tree.map((p) => [p.pid, p.name]));
      for (const { pid, path } of result.open) {
        if (!realDirs.some((dir) => isUnder(path, dir))) continue;
        if (this.held.some((h) => h.pid === pid && h.path === path)) continue;
        this.held.push({ pid, name: names.get(pid) ?? '', path });
      }
      this.samples += 1;
      this.maxTreeProcesses = Math.max(
        this.maxTreeProcesses,
        result.tree.length,
      );
      this.maxOpenPaths = Math.max(this.maxOpenPaths, result.open.length);
      this.unprobed = Math.max(this.unprobed, result.unprobed);
    } catch (error: unknown) {
      // A sample that could not run proves nothing: fail closed at finish().
      this.sampleError ??= new Error(
        `process-watch sample failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** The real `~/.ptah` as given and as resolved (a junction or symlink names it twice). */
async function realPtahDirs(realHome: string): Promise<string[]> {
  const given = resolve(realHome, '.ptah');
  const resolved = await realpath(given).catch(() => given);
  return resolved === given ? [given] : [given, resolved];
}

/** `path` is `dir` or inside it; case-insensitive on win32. */
export function isUnder(path: string, dir: string): boolean {
  const fold = (value: string): string =>
    process.platform === 'win32'
      ? resolve(value).toLowerCase()
      : resolve(value);
  const target = fold(path);
  const root = fold(dir);
  return (
    target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)
  );
}
