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
 * A FAILED BACKUP LEAVES NO ARTIFACT — AND NO SIDECAR. The worker removes its
 * own partial copy whenever it runs to completion, but it CANNOT clean up after
 * a run the host killed: a budget expiry or an early exit tears the process down
 * from outside, so `performBackup`'s own cleanup branch never executes, and a
 * write-mode validation session leaves `<dest>-wal` / `<dest>-shm` behind. So
 * this class removes the destination AND its WAL sidecars on every path that
 * returns `null` — including the `'unavailable'` one, where the worker may
 * deliberately have KEPT an unvalidated copy. That is not a disagreement with
 * the worker: the worker reports, this class decides, and a file this method
 * does not return is a file rotation must never see.
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
 * `fs.readdirSync` → sort desc by filename (ISO timestamps sort
 * lexicographically) → delete excess files. It has no validity check of its
 * own, so an unvalidated artifact would occupy a keep slot on the newest end
 * and silently evict a genuinely good backup.
 *
 * `backup()` NEVER THROWS. Its callers are a migration runner, two cron jobs
 * and a reset RPC handler; each treats `null` as non-fatal and continues.
 */
import { inject, injectable } from 'tsyringe';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  TOKENS,
  type Logger,
  type DegradationReporter,
} from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from './di/tokens';
import { DbWorkerRunner } from './integrity/db-worker-runner';
import type { IIntegrityWorkerProcessFactory } from './integrity/worker-process.port';
import { removeBackupArtifact } from './integrity/integrity-worker-protocol';
import type {
  BackupRequest,
  BackupResponse,
} from './integrity/integrity-worker-protocol';

/** Discriminated kind for backup filenames and rotation policy. */
export type BackupKind = 'pre-migration' | 'daily' | 'reset';

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

/** ISO8601-compact timestamp safe as a filename on Windows and macOS. */
function compactIso(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** Keep-count table keyed by kind. `reset` is 0 = unbounded (never rotated). */
const KEEP_BY_KIND: Record<BackupKind, number> = {
  'pre-migration': 3,
  daily: 7,
  reset: 0,
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
   * On failure no file is left at the destination, and a returned path has
   * passed `PRAGMA quick_check` inside the worker. A copy that could not be
   * validated is discarded and reported, not returned.
   */
  backup(kind: BackupKind): Promise<string | null>;

  /**
   * Deletes old backup files of the given kind, keeping only the `keep` newest.
   * A `keep` of `0` means unlimited — no files are deleted.
   * Filenames sort lexicographically by ISO compact timestamp.
   * Assumes every file under the kind's prefix was validated by `backup()`.
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
   */
  async backup(kind: BackupKind): Promise<string | null> {
    const run = this.queue.then(() => this.takeBackup(kind));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Drive one worker `backup` command and map its verdict to a path or `null`.
   *
   * The whole body sits in one `try` so the "never throws" contract holds even
   * for the no-factory branch: a reporter or a logger that threw would
   * otherwise escape from the one method four callers rely on not to.
   *
   * `destPath` is computed HERE rather than in `backup()`, so a queued call is
   * stamped with the time it actually runs. Computing it at enqueue time would
   * give two queued `pre-migration` backups timestamps from the same second and
   * therefore the same filename.
   *
   * The worker owns the file permissions (`0600` on the artifact, `0700` on the
   * directory it creates); this method never chmods, because the file is
   * written by the process that locks it down and there is no window between
   * the two.
   */
  private async takeBackup(kind: BackupKind): Promise<string | null> {
    // Declared outside the try so the catch can clean up a partial file.
    let dest: string | null = null;
    try {
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

      dest = this.destPath(kind);
      const request: BackupRequest = {
        id: 1,
        type: 'backup',
        dbPath: this.dbPath,
        destPath: dest,
      };
      const outcome = await this.runner.run<BackupResponse>(factory, {
        label: 'backup',
        request,
        budgetMs: BACKUP_WORKER_BUDGET_MS,
        narrow: asBackupResponse,
      }).settled;

      const response = outcome.response;
      if (response === null) {
        // No reply, an early exit, or a spent budget. The runner already said
        // which at `warn`; what matters here is that no verdict exists, so
        // whatever is at the destination is unvalidated and must not survive.
        this.discardArtifact(dest, kind);
        this.reportNotTaken(
          kind,
          'the backup worker produced no result (no reply, early exit, or budget expiry)',
        );
        return null;
      }

      if (response.verdict === 'corrupt') {
        this.logger.warn(
          '[persistence-sqlite] backup discarded — integrity check failed',
          { kind, dest, quickCheck: response.quickCheck },
        );
        this.discardArtifact(dest, kind);
        return null;
      }

      if (response.verdict === 'unavailable') {
        // The worker keeps an unvalidatable copy and reports `bytesWritten`;
        // this class does not return it, so it cannot be allowed to stay and
        // take the newest rotation slot away from a validated backup.
        this.discardArtifact(dest, kind);
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
      if (dest !== null) this.discardArtifact(dest, kind);
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
   * Best-effort removal of a backup file — AND its `-wal` / `-shm` sidecars —
   * that must not be retained.
   *
   * The sidecars are not decoration. The worker validates the copy on a
   * read-WRITE connection (`validateCopy`, so the checkpoint on close actually
   * happens), which means a run killed mid-validation leaves them behind; and a
   * run killed from outside — budget expiry, early exit — never reaches
   * `performBackup`'s own cleanup, so nothing else will ever remove them.
   * `rotate()` cannot mistake one for a backup, so this is disk space rather
   * than correctness, but it is disk space that grows on every failed attempt.
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
  private discardArtifact(dest: string, kind: BackupKind): void {
    try {
      const existed = fs.existsSync(dest);
      removeBackupArtifact(fs, dest);
      if (fs.existsSync(dest)) {
        // `removeBackupArtifact` swallows its own failures, so this is the only
        // place the one that matters for rotation can still be reported.
        this.logger.warn(
          '[persistence-sqlite] backup artifact cleanup failed (non-fatal) — a stale file may take a rotation slot',
          { kind, dest },
        );
        return;
      }
      if (!existed) return;
      this.logger.debug('[persistence-sqlite] backup artifact discarded', {
        kind,
        dest,
      });
    } catch (error: unknown) {
      this.logger.warn(
        '[persistence-sqlite] backup artifact cleanup failed (non-fatal) — a stale file may take a rotation slot',
        {
          kind,
          dest,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * Deletes all but the `keep` newest backup files for the given kind.
   * When `keep` is 0, no files are deleted (unbounded retention).
   *
   * Selection is purely by filename order — there is deliberately no
   * validity check here, and adding one would mean opening every retained
   * file on every rotation. The safety of that depends entirely on the
   * invariant `backup()` upholds: a file only exists under these prefixes if
   * it was written completely, locked down, and passed `quick_check`. Weaken
   * that (stop deleting on failure, stop validating) and rotation starts
   * evicting good backups in favour of junk, because a partial file carries
   * the newest timestamp and so occupies a keep slot.
   *
   * The `.sqlite` suffix test is load-bearing as well as cosmetic: a SQLite
   * sidecar is `<file>.sqlite-wal` / `-shm`, which fails `endsWith('.sqlite')`
   * and so can never take a rotation slot from a real backup, whoever left it
   * behind.
   *
   * Not guarded on the caller's side either: the daily-backup cron jobs in
   * `cli-engine` and `thoth-runtime` call `rotate()` unconditionally, without
   * checking whether `backup()` returned a path — which is why cleanup has to
   * live in `backup()` rather than at the call sites.
   */
  rotate(kind: BackupKind, keep: number): void {
    if (keep <= 0) return;
    try {
      const dir = this.dirFor(kind);
      if (!fs.existsSync(dir)) return;
      const prefix = this.prefixFor(kind);
      const files = fs
        .readdirSync(dir)
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
