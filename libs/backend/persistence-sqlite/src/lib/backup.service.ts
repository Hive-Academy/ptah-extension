/**
 * SqliteBackupService — pre-migration and daily SQLite backups with rotation.
 *
 * Uses the better-sqlite3 Online Backup API (`db.backup(destPath)`) which
 * performs a hot backup without pausing readers. Failures are non-fatal:
 * `backup()` catches all errors, logs a warning, and returns `null` so the
 * caller (migration runner, cron job) continues normally.
 *
 * A failed backup leaves NO artifact behind. `db.backup()` can create the
 * destination file and then fail part-way through the page copy, and the
 * subsequent `chmod` can fail on its own; in either case the destination is
 * unlinked before `backup()` returns `null`. Before returning a path,
 * `backup()` also opens the finished file and runs `PRAGMA quick_check` —
 * a file that reports corruption is deleted and `null` is returned. So the
 * only files this class ever leaves on disk are validated ones.
 *
 * That invariant is what makes rotation safe. Rotation is owned directly in
 * this class — no separate helper. The bookkeeping is two lines:
 * `fs.readdirSync` → sort desc by filename (ISO timestamps sort
 * lexicographically) → delete excess files. It has no validity check of its
 * own, so an unvalidated artifact would occupy a keep slot on the newest end
 * and silently evict a genuinely good backup.
 *
 * Note: `db.backup()` can block briefly on Windows with NTFS when a shared
 * WAL hasn't been checkpointed (the API restarts page copy on concurrent
 * reads). Pre-migration backups fire at boot before RPC handlers register;
 * daily backups fire at 03:00 UTC when user is inactive — both windows have
 * negligible concurrent load.
 */
import { inject, injectable } from 'tsyringe';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from './di/tokens';
import type {
  SqliteDatabase,
  SqliteDatabaseFactory,
} from './sqlite-connection.service';

/** Discriminated kind for backup filenames and rotation policy. */
export type BackupKind = 'pre-migration' | 'daily' | 'reset';

/**
 * Verdict from integrity-checking a freshly written backup file.
 *
 * `corrupt` is reserved for a *definite* answer — `quick_check` ran and
 * reported something other than `ok`. Anything that stops us asking the
 * question at all (native module missing, file locked, open refused) is
 * `unavailable`, and an unvalidatable backup is kept rather than destroyed:
 * deleting a good backup on an inconclusive check would be a worse failure
 * than the stale-artifact bug this validation exists to close.
 */
type BackupIntegrity = 'ok' | 'corrupt' | 'unavailable';

/**
 * Resolves the better-sqlite3 constructor and returns a factory bound to it.
 *
 * Deliberately split into "load the module" (here, may throw → `unavailable`)
 * and "open this file" (the returned closure, may throw → still inconclusive)
 * so a missing native binary is never mistaken for a corrupt backup.
 * `fileMustExist` stops a vanished destination being recreated as an empty
 * database that would then pass `quick_check`.
 */
function loadBetterSqlite3ValidationFactory(): SqliteDatabaseFactory {
  const Database = require('better-sqlite3') as new (
    file: string,
    options?: { fileMustExist?: boolean },
  ) => SqliteDatabase;
  return (filePath: string) => new Database(filePath, { fileMustExist: true });
}

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

export interface IBackupService {
  /**
   * Calls `db.backup(destPath)` via the better-sqlite3 Online Backup API.
   * Returns the destination path on success, `null` on failure. Never throws.
   *
   * On failure no file is left at the destination, and a returned path has
   * passed `PRAGMA quick_check` (or was explicitly reported as unverifiable).
   */
  backup(db: SqliteDatabase, kind: BackupKind): Promise<string | null>;

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
  ) {}

  /**
   * Test seam: factory used to reopen a finished backup for `quick_check`.
   *
   * `undefined` means "not resolved yet" — the real better-sqlite3
   * constructor is loaded lazily on first validation. `null` means "no
   * validation mechanism", which makes `backup()` degrade to skipping the
   * check. Mirrors the `factory` seam on `SqliteConnectionService`; it is a
   * field rather than a constructor parameter because tsyringe reflects
   * every constructor parameter of an `@injectable()` class and a
   * function-typed one resolves as `Function`, which fails registration with
   * `TypeInfo not known for "Function"`.
   */
  private validationFactory: SqliteDatabaseFactory | null | undefined =
    undefined;

  /** Override the validation factory. Pass `null` to disable validation. */
  setValidationFactory(factory: SqliteDatabaseFactory | null): void {
    this.validationFactory = factory;
  }

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
   * Calls `db.backup(destPath)` and returns the destination path on success.
   * Returns `null` and logs a warning if `db.backup` is unavailable or throws.
   *
   * F-M2 security fix: backup files and their parent directory are chmod'd to
   * owner-only permissions on POSIX (file: 0600, dir: 0700) to prevent other
   * local users from reading sensitive workspace content stored in the DB.
   * On Windows these chmod calls are silent no-ops — ACL-level lockdown is
   * governed by the parent ~/.ptah directory which inherits user-only ACL by
   * default from the Windows user profile tree.
   */
  async backup(db: SqliteDatabase, kind: BackupKind): Promise<string | null> {
    // Declared outside the try so the catch can clean up a partial file.
    let dest: string | null = null;
    try {
      if (typeof db.backup !== 'function') {
        this.logger.warn(
          '[persistence-sqlite] backup skipped — db.backup() is unavailable on this database instance',
          { kind },
        );
        return null;
      }
      dest = this.destPath(kind);
      const dir = path.dirname(dest);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });

        fs.chmodSync(dir, 0o700);
      }
      await db.backup(dest);

      fs.chmodSync(dest, 0o600);

      const integrity = this.checkIntegrity(dest, kind);
      if (integrity === 'corrupt') {
        this.logger.warn(
          '[persistence-sqlite] backup discarded — integrity check failed',
          { kind, dest },
        );
        this.discardArtifact(dest, kind);
        return null;
      }

      this.logger.info('[persistence-sqlite] backup completed', {
        kind,
        dest,
        validated: integrity === 'ok',
      });
      return dest;
    } catch (err: unknown) {
      this.logger.warn('[persistence-sqlite] backup failed (non-fatal)', {
        kind,
        error: err instanceof Error ? err.message : String(err),
      });
      // `db.backup()` can fail after creating the destination, and the chmod
      // can fail on a fully written one. Either way the artifact is not fit
      // to be rotated, so it must not survive this call.
      if (dest !== null) this.discardArtifact(dest, kind);
      return null;
    }
  }

  /**
   * Opens a finished backup file and runs `PRAGMA quick_check` on it.
   *
   * Always closes the handle, including on the error path. Never throws —
   * anything that prevents the check returns `unavailable`, which the caller
   * treats as "keep the file but say so".
   */
  private checkIntegrity(dest: string, kind: BackupKind): BackupIntegrity {
    if (this.validationFactory === undefined) {
      try {
        this.validationFactory = loadBetterSqlite3ValidationFactory();
      } catch (err: unknown) {
        this.validationFactory = null;
        this.logger.warn(
          '[persistence-sqlite] backup integrity check unavailable — could not load better-sqlite3',
          { kind, error: err instanceof Error ? err.message : String(err) },
        );
      }
    }
    const factory = this.validationFactory;
    if (factory === null) {
      this.logger.warn(
        '[persistence-sqlite] backup integrity check skipped — no validation mechanism',
        { kind, dest },
      );
      return 'unavailable';
    }

    let handle: SqliteDatabase | null = null;
    try {
      handle = factory(dest);
      const result = handle.pragma('quick_check', { simple: true }) as string;
      if (result === 'ok') return 'ok';
      this.logger.warn('[persistence-sqlite] backup quick_check reported', {
        kind,
        dest,
        result: String(result),
      });
      return 'corrupt';
    } catch (err: unknown) {
      this.logger.warn(
        '[persistence-sqlite] backup integrity check could not run (non-fatal)',
        { kind, dest, error: err instanceof Error ? err.message : String(err) },
      );
      return 'unavailable';
    } finally {
      try {
        handle?.close();
      } catch (closeErr: unknown) {
        this.logger.warn(
          '[persistence-sqlite] closing backup validation handle failed (non-fatal)',
          {
            kind,
            dest,
            error:
              closeErr instanceof Error ? closeErr.message : String(closeErr),
          },
        );
      }
    }
  }

  /**
   * Best-effort removal of a backup file that must not be retained.
   * Never throws — `backup()` is documented never to throw, and a failed
   * cleanup must not turn into a thrown error at a call site that only
   * expects `null`.
   */
  private discardArtifact(dest: string, kind: BackupKind): void {
    try {
      if (!fs.existsSync(dest)) return;
      fs.unlinkSync(dest);
      this.logger.debug('[persistence-sqlite] backup artifact discarded', {
        kind,
        dest,
      });
    } catch (err: unknown) {
      this.logger.warn(
        '[persistence-sqlite] backup artifact cleanup failed (non-fatal) — a stale file may take a rotation slot',
        {
          kind,
          dest,
          error: err instanceof Error ? err.message : String(err),
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
   * it was written completely, chmod'd, and passed `quick_check`. Weaken
   * that (stop deleting on failure, stop validating) and rotation starts
   * evicting good backups in favour of junk, because a partial file carries
   * the newest timestamp and so occupies a keep slot.
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
        } catch (err: unknown) {
          this.logger.warn(
            '[persistence-sqlite] backup rotation delete failed (non-fatal)',
            {
              file,
              kind,
              error: err instanceof Error ? err.message : String(err),
            },
          );
        }
      }
    } catch (err: unknown) {
      this.logger.warn(
        '[persistence-sqlite] backup rotation scan failed (non-fatal)',
        {
          kind,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }
}

export { KEEP_BY_KIND };
