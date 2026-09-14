/**
 * SqliteBackupService — pre-migration and daily SQLite backups with rotation,
 * taken OUT OF PROCESS (TASK_2026_383 Batch 7).
 *
 * WHAT CHANGED AND WHY. The copy used to run here, on the host's main thread:
 * `db.backup(dest)` against the live handle, then a second connection opened on
 * the finished file for `PRAGMA quick_check`. Both are synchronous C++ work
 * inside the process that also answers renderer IPC, and on a real 1 GB
 * `~/.ptah/state/ptah.sqlite` the pre-migration pair measured ~27 s — all of it
 * on the boot path, all of it blocking every reply. The copy and its validation
 * now happen in the integrity worker (`integrity/integrity-worker.ts`, the
 * `backup` command); this class computes the destination, drives ONE worker
 * round-trip, maps the verdict, and owns rotation. It opens no database.
 *
 * THERE IS NO IN-PROCESS FALLBACK, deliberately. A host with no worker factory
 * does not quietly take the 27 s path — it takes no backup, returns `null`,
 * logs at `warn` and emits a `'critical'` degradation event. Keeping a second
 * implementation alive "just in case" would mean the slow path stays reachable
 * forever and nobody ever learns which one ran.
 *
 * ONLY A VALIDATED COPY IS PUBLISHED AT A FINAL NAME. The worker writes to an
 * exclusively-created random staging file, validates it, removes its sidecars,
 * then atomically publishes with a no-overwrite hard link. Every failure path
 * removes only staging; no failed attempt unlinks a final destination. This is
 * the cross-process guard required when Electron and CLI share one directory.
 * A same-day daily final created by the old direct-write implementation earlier
 * on the upgrade day remains one documented residual: it is trusted once.
 * A second known limitation: a backups directory without hard-link support, or
 * staging and destination on different volumes (`EXDEV`), fails the publish,
 * so every backup reports not-taken with a `'critical'` degradation — permanent
 * and loud, with no copy or rename fallback by design.
 *
 * ONE BACKUP AT A TIME, AND NONE IS EVER DROPPED. Overlapping calls are
 * SERIALIZED, not rejected: the second awaits the first and then runs. Two
 * worker processes reading the same gigabyte source at once is contention
 * nobody asked for, but refusing the second call would be worse — a
 * pre-migration backup skipped because the daily cron happened to be running is
 * exactly the safety net this file exists to hold.
 *
 * That invariant is what makes rotation safe. Rotation is owned directly in
 * this class — no separate helper. The bookkeeping is two lines:
 * `fs.readdirSync` → `.sqlite` suffix filter → sort desc by filename → delete
 * excess files. Compact ISO timestamps sort lexicographically across seconds;
 * the one compatibility quirk is that an old second-granular name sorts newer
 * than a new-format name from that same second. Rotation also sweeps staging
 * files older than two worker budgets; younger staging files may belong to
 * another process and are never swept or counted.
 *
 * `backup()` NEVER THROWS. Its callers are a migration runner, two cron jobs
 * and a reset RPC handler; each treats `null` as non-fatal and continues.
 */
import { inject, injectable } from 'tsyringe';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  TOKENS,
  type BackgroundWorkAdmission,
  type Logger,
  type DegradationReporter,
} from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from './di/tokens';
import { DbWorkerRunner } from './integrity/db-worker-runner';
import type { IIntegrityWorkerProcessFactory } from './integrity/worker-process.port';
import {
  BACKUP_DESTINATION_EXISTS,
  BACKUP_STAGING_EXISTS,
  removeBackupArtifact,
} from './integrity/integrity-worker-protocol';
import type {
  BackupRequest,
  BackupResponse,
} from './integrity/integrity-worker-protocol';

/** Discriminated kind for backup filenames and rotation policy. */
export type BackupKind = 'pre-migration' | 'daily' | 'reset';

/**
 * Kinds whose START waits for the background-work governor (TASK_2026_437
 * C14 d). Only the cron-driven `daily` backup is background work:
 * - `pre-migration` gates a migration on the boot path — deferring it would
 *   hold boot, and skipping it removes the safety net at the one moment it
 *   matters;
 * - `reset` is a user clicking "reset" (`persistence-rpc.handlers.ts`), and
 *   user-initiated work is never governed (Batch 16b).
 */
const GOVERNED_KINDS: ReadonlySet<BackupKind> = new Set<BackupKind>(['daily']);

/** `whenClear` lane name; it only labels the governor's ceiling log line. */
const GOVERNOR_LANE = 'sqlite-daily-backup';

/**
 * How long the worker may spend on one backup before it is killed.
 *
 * TWENTY MINUTES, four times `INTEGRITY_WORKER_BUDGET_MS` (5 min), and the
 * difference is the point rather than an oversight. A `quick_check` reads the
 * source once — measured 20-26 s cold on a 1 GB file. A backup reads the same
 * file, WRITES a second copy of it, checkpoints and locks that copy down, and
 * then runs a full `quick_check` over the copy: strictly more work, on a disk
 * that is now doing both halves. At a pessimistic 10 MB/s (a slow spinning
 * disk, or a network-mounted home directory) a gigabyte copy alone is ~100 s
 * before validation, so the realistic worst case is minutes and this leaves
 * roughly an order of magnitude of headroom.
 *
 * The budget exists so the worker cannot OUTLIVE THE HOST, not to police its
 * speed. A budget set too tight does not report slowness — it returns `null`,
 * and for the pre-migration caller that means the migration proceeds with NO
 * backup, which is the single worst outcome this file can produce. Erring long
 * costs a boot that waits; erring short costs the safety net silently.
 */
export const BACKUP_WORKER_BUDGET_MS = 20 * 60 * 1000;

/**
 * Degradation codes for this file. String literals, never interpolated — the
 * reporter's tally is keyed on them (`rpc-degradation.types.ts`).
 */
const DEGRADE_NO_WORKER = 'database.backup.no-worker-factory';
const DEGRADE_NOT_TAKEN = 'database.backup.not-taken';
const STAGING_SUFFIX = /\.[0-9a-f]{8}\.tmp(?:-wal|-shm)?$/;

/** Collision-resistant compact timestamp safe as a filename on Windows/macOS. */
function compactIso(): string {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
  return `${timestamp}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Keep-count table keyed by kind — the ONE keep policy. Every rotation call
 * site reads it (`rotate(kind, KEEP_BY_KIND[kind])`); none passes a literal.
 *
 * - `pre-migration: 1` — each copy is a full image of the database (1.28 GB on
 *   a real install), and only the newest one is a useful rollback point.
 * - `daily: 7` — one week of daily copies.
 * - `reset: 2` — bounded since TASK_2026_440; it used to be unbounded, so every
 *   user-initiated reset left one more full copy behind forever.
 *
 * No kind maps to 0. `rotate(keep <= 0)` stays a no-op for callers.
 */
const KEEP_BY_KIND: Readonly<Record<BackupKind, number>> = {
  'pre-migration': 1,
  daily: 7,
  reset: 2,
};

/**
 * Narrow a worker reply to a `backup` response.
 *
 * Strict on purpose: the worker answers a `backup` request with a
 * `BackupResponse` and nothing else, so any other shape is a reply we do not
 * understand. `null` means inconclusive — the same as no reply at all — rather
 * than a fabricated verdict about a file we would then hand to rotation.
 */
function asBackupResponse(msg: unknown): BackupResponse | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const candidate = msg as Partial<BackupResponse>;
  if (typeof candidate.id !== 'number') return null;
  if (candidate.type !== 'backup') return null;
  if (candidate.ok !== true) return null;
  if (
    candidate.verdict !== 'ok' &&
    candidate.verdict !== 'corrupt' &&
    candidate.verdict !== 'unavailable'
  ) {
    return null;
  }
  if (
    typeof candidate.bytesWritten !== 'number' ||
    typeof candidate.durationMs !== 'number' ||
    typeof candidate.quickCheck !== 'string' ||
    (candidate.detail !== null && typeof candidate.detail !== 'string')
  ) {
    return null;
  }
  return candidate as BackupResponse;
}

export interface IBackupService {
  /**
   * Take one backup of the configured database through the integrity worker.
   * Returns the destination path on success, `null` on failure. Never throws.
   *
   * The database path is injected, so no handle is passed in: the worker opens
   * the file itself, read-only, and the host's live connection is untouched.
   *
   * Only a copy that passed `PRAGMA quick_check` is atomically published at a
   * final name. Failures remove staging only; a final path is never overwritten
   * or discarded. A daily final already present is returned without dispatch.
   * One upgrade-day exception exists: an old-version partial daily final cannot
   * be distinguished from a published final and is trusted once.
   */
  backup(kind: BackupKind): Promise<string | null>;

  /**
   * Deletes old backup files of the given kind, keeping only the `keep` newest.
   * A `keep` of `0` means unlimited — no files are deleted.
   * Filenames sort newest-first by compact ISO timestamp. Across mixed formats,
   * an old-format file sorts newer than a new-format file from the same second.
   * New code publishes only validated finals. An old-version daily partial on
   * the upgrade day is the documented compatibility exception.
   */
  rotate(kind: BackupKind, keep: number): void;
}

@injectable()
export class SqliteBackupService implements IBackupService {
  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_DB_PATH) private readonly dbPath: string,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(DbWorkerRunner) private readonly runner: DbWorkerRunner,
    /**
     * Optional for the same reason `SqliteIntegrityService`'s is: a host that
     * ships no worker registers none. Unlike the integrity check, whose absence
     * is merely "not checked this launch", the absence of a backup is a lost
     * safety net — so this one is loud rather than an `info` line.
     */
    @inject(PERSISTENCE_TOKENS.INTEGRITY_WORKER_PROCESS_FACTORY, {
      isOptional: true,
    })
    private readonly factory: IIntegrityWorkerProcessFactory | null = null,
    /**
     * Optional because `registerPersistenceSqliteServices` does not register
     * it — the reporter is bound by `vscode-core`'s platform-agnostic
     * registration, which a bare test container will not have run.
     */
    @inject(TOKENS.DEGRADATION_REPORTER, { isOptional: true })
    private readonly degradation: DegradationReporter | null = null,
    /**
     * Optional: a bare container has none, and then every backup starts at
     * once, as before TASK_2026_437 C14. Only a `daily` backup consults it.
     */
    @inject(TOKENS.BACKGROUND_WORK_GOVERNOR, { isOptional: true })
    private readonly governor: BackgroundWorkAdmission | null = null,
  ) {}

  /**
   * The tail of the serialization chain — every `backup()` call links onto it.
   *
   * A promise chain rather than a boolean flag, because the ruling is
   * SERIALIZE, not reject: a flag can only turn the second caller away, and a
   * pre-migration backup that was skipped because the daily cron was running is
   * a safety net silently missing at the one moment it mattered.
   *
   * Reassigned SYNCHRONOUSLY inside `backup()`, before its first `await`, which
   * is what makes two calls in the same tick queue rather than race — the same
   * property `SqliteIntegrityService.dispatching` gets from being set before
   * its first `await`, achieved the way this contract needs.
   */
  private queue: Promise<void> = Promise.resolve();

  /** Returns the directory in which backups of the given kind are stored. */
  private dirFor(kind: BackupKind): string {
    const base = path.dirname(this.dbPath);
    if (kind === 'daily') {
      return path.join(base, 'backups');
    }
    return base;
  }

  /** Returns the filename prefix that identifies backups of the given kind. */
  private prefixFor(kind: BackupKind): string {
    const dbBaseName = path.basename(this.dbPath, path.extname(this.dbPath));
    if (kind === 'daily') {
      return `${dbBaseName}-`;
    }
    return `${dbBaseName}.${kind}-`;
  }

  /** Builds the full destination path for a new backup. */
  private destPath(kind: BackupKind): string {
    const dir = this.dirFor(kind);
    const prefix = this.prefixFor(kind);
    if (kind === 'daily') {
      const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      return path.join(dir, `${prefix}${dateStr}.sqlite`);
    }
    return path.join(dir, `${prefix}${compactIso()}.sqlite`);
  }

  /**
   * Take one backup, after any backup already in flight has finished.
   *
   * The queue is advanced synchronously here so the ordering holds for calls
   * made in the same tick. `takeBackup` never rejects, but the tail is
   * normalised with a rejection handler anyway: a rejected tail would wedge
   * every later backup for the life of the process, and "the safety net stopped
   * silently" is the one failure this file must not have.
   *
   * A `daily` backup first waits for the background-work governor and only then
   * links onto the queue (see `waitForBackgroundClear`); its place in the queue
   * is therefore the moment the wait ended, which is the only order a scheduled
   * backup needs.
   */
  async backup(kind: BackupKind): Promise<string | null> {
    if (
      GOVERNED_KINDS.has(kind) &&
      !(await this.waitForBackgroundClear(kind))
    ) {
      return null;
    }
    const run = this.queue.then(() => this.takeBackup(kind));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Hold a scheduled backup until the background-work governor is clear
   * (TASK_2026_437 C14 d).
   *
   * The wait happens BEFORE the backup joins the serialization queue, so a
   * held daily backup never holds a `pre-migration` or `reset` backup queued
   * behind it. The copy runs in the integrity worker, but starting it still
   * spawns a process and reads the whole database file from disk while the
   * user is mid-turn or the main loop already lags — so the START is deferred.
   *
   * `'clear'` and `'timeout'` (the governor's starvation ceiling) both return
   * true: the backup runs. An `AbortError` means the governor was disposed —
   * the host is shutting down — so the backup is skipped (false) and logged at
   * info; starting a worker during quit is the one thing that must not happen.
   * Any other rejection fails open: the backup runs.
   */
  private async waitForBackgroundClear(kind: BackupKind): Promise<boolean> {
    const governor = this.governor;
    if (governor === null || governor.isClear()) return true;
    try {
      await governor.whenClear({ lane: GOVERNOR_LANE });
      return true;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - a scheduled backup held at shutdown is skipped on purpose; the next scheduled run takes it
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.info(
          '[persistence-sqlite] scheduled backup skipped — the host is shutting down',
          { kind, reason },
        );
        return false;
      }
      this.logger.warn(
        '[persistence-sqlite] background-work wait failed — taking the backup anyway',
        { kind, reason },
      );
      return true;
    }
  }

  /**
   * Drive one worker `backup` command and map its verdict to a path or `null`.
   *
   * The whole body sits in one `try` so the "never throws" contract holds even
   * for the no-factory branch: a reporter or a logger that threw would
   * otherwise escape from the one method four callers rely on not to.
   *
   * `destPath` is computed HERE rather than in `backup()`, so a queued call is
   * stamped with the time it actually runs. Non-daily names also carry four
   * random bytes, preventing separate hosts in one directory from normally
   * choosing the same destination even within the same millisecond.
   *
   * The worker owns the file permissions (`0600` on the artifact, `0700` on the
   * directory it creates); this method never chmods, because the file is
   * written by the process that locks it down and there is no window between
   * the two.
   */
  private async takeBackup(kind: BackupKind): Promise<string | null> {
    // Declared outside the try so every failed host path cleans staging only.
    let dest: string | null = null;
    let staging: string | null = null;
    try {
      dest = this.destPath(kind);
      if (fs.existsSync(dest)) {
        if (kind === 'daily') {
          this.logger.info(
            '[persistence-sqlite] daily backup for today already exists',
            { kind, dest },
          );
          return dest;
        }
        this.reportNotTaken(kind, `backup destination already exists: ${dest}`);
        return null;
      }

      const factory = this.factory;
      if (!factory) {
        this.logger.warn(
          '[persistence-sqlite] NO BACKUP TAKEN — this host registered no integrity worker factory',
          { kind },
        );
        this.degradation?.report({
          source: 'database',
          code: DEGRADE_NO_WORKER,
          severity: 'critical',
          summary: `No database backup was taken (${kind}): this host has no backup worker.`,
          detail:
            'PERSISTENCE_TOKENS.INTEGRITY_WORKER_PROCESS_FACTORY is unregistered, so the out-of-process backup command cannot run. There is no in-process fallback by design.',
        });
        return null;
      }

      const request: BackupRequest = {
        id: 1,
        type: 'backup',
        dbPath: this.dbPath,
        destPath: dest,
        stagingPath: `${dest}.${crypto.randomBytes(4).toString('hex')}.tmp`,
      };
      staging = request.stagingPath;
      const outcome = await this.runner.run<BackupResponse>(factory, {
        label: 'backup',
        request,
        budgetMs: BACKUP_WORKER_BUDGET_MS,
        narrow: asBackupResponse,
      }).settled;

      const response = outcome.response;
      if (response === null) {
        // The worker may have died mid-copy. Only its randomized staging path
        // belongs to this attempt; the final path may belong to another host.
        this.discardArtifact(staging, kind);
        this.reportNotTaken(
          kind,
          'the backup worker produced no result (no reply, early exit, or budget expiry)',
        );
        return null;
      }

      if (response.verdict === 'corrupt') {
        this.logger.warn(
          '[persistence-sqlite] backup discarded — integrity check failed',
          { kind, dest, staging, quickCheck: response.quickCheck },
        );
        this.discardArtifact(staging, kind);
        return null;
      }

      if (response.verdict === 'unavailable') {
        if (response.detail === BACKUP_DESTINATION_EXISTS) {
          if (kind === 'daily') {
            this.logger.info(
              '[persistence-sqlite] daily backup won by another host',
              { kind, dest },
            );
            return dest;
          }
          this.reportNotTaken(kind, response.detail);
          return null;
        }
        if (response.detail === BACKUP_STAGING_EXISTS) {
          this.reportNotTaken(kind, response.detail);
          return null;
        }
        this.discardArtifact(staging, kind);
        this.reportNotTaken(
          kind,
          response.detail ?? 'the backup could not be completed or validated',
        );
        return null;
      }

      this.logger.info('[persistence-sqlite] backup completed', {
        kind,
        dest,
        bytesWritten: response.bytesWritten,
        durationMs: response.durationMs,
      });
      return dest;
    } catch (error: unknown) {
      this.logger.warn('[persistence-sqlite] backup failed (non-fatal)', {
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
      if (staging !== null) this.discardArtifact(staging, kind);
      return null;
    }
  }

  /**
   * One `'critical'` degradation event for "the safety net is not there".
   *
   * `'critical'` rather than `'degraded'`: nothing has failed yet, and that is
   * precisely why it has to be loud now instead of at restore time — the
   * severity doc in `rpc-degradation.types.ts` names this exact case.
   */
  private reportNotTaken(kind: BackupKind, reason: string): void {
    this.logger.warn('[persistence-sqlite] NO BACKUP TAKEN', { kind, reason });
    this.degradation?.report({
      source: 'database',
      code: DEGRADE_NOT_TAKEN,
      severity: 'critical',
      summary: `No database backup was taken (${kind}).`,
      detail: reason,
    });
  }

  /**
   * Best-effort removal of this attempt's randomized staging file and its
   * `-wal` / `-shm` sidecars. A final destination must never be passed here.
   *
   * The sidecars are not decoration. The worker validates the copy on a
   * read-WRITE connection (`validateCopy`, so the checkpoint on close actually
   * happens), which means a run killed mid-validation leaves them behind; and a
   * run killed from outside — budget expiry, early exit — never reaches
   * `performBackup`'s own cleanup, so nothing else will ever remove them.
   * `rotate()` cannot count staging as a backup, and separately sweeps staging
   * older than two worker budgets. Host cleanup remains necessary for prompt
   * recovery after an early exit or budget kill.
   *
   * `removeBackupArtifact` is REUSED from the protocol module rather than
   * reimplemented here. That module is where the suffix list lives, and two
   * copies of "which files belong to a backup" is exactly how one of them ends
   * up out of date. This is a pure filesystem helper, not the backup mechanism
   * — the rule that this service talks to the worker over the protocol rather
   * than by calling its internals is about `performBackup`, and still holds.
   *
   * Never throws — `backup()` is documented never to throw, and a failed
   * cleanup must not turn into a thrown error at a call site that only
   * expects `null`.
   */
  private discardArtifact(staging: string, kind: BackupKind): void {
    try {
      const existed = fs.existsSync(staging);
      removeBackupArtifact(fs, staging);
      if (fs.existsSync(staging)) {
        // `removeBackupArtifact` swallows its own failures, so this is the only
        // place the one that matters for rotation can still be reported.
        this.logger.warn(
          '[persistence-sqlite] backup artifact cleanup failed (non-fatal) — a stale file may take a rotation slot',
          { kind, staging },
        );
        return;
      }
      if (!existed) return;
      this.logger.debug('[persistence-sqlite] backup artifact discarded', {
        kind,
        staging,
      });
    } catch (error: unknown) {
      this.logger.warn(
        '[persistence-sqlite] backup artifact cleanup failed (non-fatal) — a stale file may take a rotation slot',
        {
          kind,
          staging,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * Deletes all but the `keep` newest backup files for the given kind.
   * When `keep` is 0, no files are deleted (unbounded retention).
   *
   * Selection is purely by final filename order. This is safe because the
   * worker publishes a final name only after validation, using an atomic
   * no-overwrite hard link. Staging files never end in `.sqlite`, so they do not
   * consume keep slots. Staging groups older than two worker budgets are swept;
   * a younger group is never touched because another host may still own it.
   *
   * The `.sqlite` suffix test is load-bearing as well as cosmetic: a SQLite
   * sidecar is `<file>.sqlite-wal` / `-shm`, which fails `endsWith('.sqlite')`
   * and so can never take a rotation slot from a real backup, whoever left it
   * behind. Mixed old and new names remain chronological across different
   * seconds. For the same second only, the old `...SSZ.sqlite` form sorts newer
   * than the new `...SSmmmZ-<hex>.sqlite` form; this compatibility quirk is
   * documented and intentionally does not add parsing to rotation.
   *
   * The daily-backup callers invoke `rotate()` unconditionally, so the stale
   * staging sweep also runs after a failed attempt.
   */
  rotate(kind: BackupKind, keep: number): void {
    try {
      const dir = this.dirFor(kind);
      if (!fs.existsSync(dir)) return;
      const prefix = this.prefixFor(kind);
      const entries = fs.readdirSync(dir);
      const stagingRoots = new Set(
        entries
          .filter((file) => file.startsWith(prefix) && STAGING_SUFFIX.test(file))
          .map((file) =>
            path.join(dir, file.replace(/(?:-wal|-shm)$/, '')),
          ),
      );
      const staleBefore = Date.now() - 2 * BACKUP_WORKER_BUDGET_MS;
      for (const staging of stagingRoots) {
        const group = [staging, `${staging}-wal`, `${staging}-shm`].filter(
          (target) => fs.existsSync(target),
        );
        if (
          group.length > 0 &&
          group.every((target) => fs.statSync(target).mtimeMs < staleBefore)
        ) {
          removeBackupArtifact(fs, staging);
          this.logger.debug('[persistence-sqlite] stale staging swept', {
            kind,
            staging,
          });
        }
      }

      if (keep <= 0) return;
      const files = entries
        .filter((f) => f.startsWith(prefix) && f.endsWith('.sqlite'))
        .sort() // lexicographic = ISO timestamp order, ascending
        .reverse(); // newest first
      const toDelete = files.slice(keep);
      for (const file of toDelete) {
        try {
          fs.unlinkSync(path.join(dir, file));
          this.logger.debug('[persistence-sqlite] backup rotated (deleted)', {
            file,
            kind,
          });
        } catch (error: unknown) {
          this.logger.warn(
            '[persistence-sqlite] backup rotation delete failed (non-fatal)',
            {
              file,
              kind,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
    } catch (error: unknown) {
      this.logger.warn(
        '[persistence-sqlite] backup rotation scan failed (non-fatal)',
        {
          kind,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}

export { KEEP_BY_KIND };
