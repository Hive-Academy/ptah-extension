/**
 * SqliteBackupService — pre-migration and daily SQLite backups with rotation.
 *
 * Uses the better-sqlite3 Online Backup API (`db.backup(destPath)`) which
 * performs a hot backup without pausing readers. Failures are non-fatal:
 * `backup()` catches all errors, logs a warning, and returns `null` so the
 * caller (migration runner, cron job) continues normally.
 *
 * Rotation is owned directly in this class — no separate helper. The
 * bookkeeping is two lines: `fs.readdirSync` → sort desc by filename (ISO
 * timestamps sort lexicographically) → delete excess files.
 *
 * Note: `db.backup()` can block briefly on Windows with NTFS when a shared
 * WAL hasn't been checkpointed (the API restarts page copy on concurrent
 * reads). D2 backups fire at boot before RPC handlers register; D7 daily
 * backups fire at 03:00 UTC when user is inactive — both windows have
 * negligible concurrent load.
 */
import { inject, injectable } from 'tsyringe';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from './di/tokens';
import type { SqliteDatabase } from './sqlite-connection.service';

/** Discriminated kind for backup filenames and rotation policy. */
export type BackupKind = 'pre-migration' | 'daily' | 'reset';

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
   */
  backup(db: SqliteDatabase, kind: BackupKind): Promise<string | null>;

  /**
   * Deletes old backup files of the given kind, keeping only the `keep` newest.
   * A `keep` of `0` means unlimited — no files are deleted.
   * Filenames sort lexicographically by ISO compact timestamp.
   */
  rotate(kind: BackupKind, keep: number): void;
}

@injectable()
export class SqliteBackupService implements IBackupService {
  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_DB_PATH) private readonly dbPath: string,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

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
   */
  async backup(db: SqliteDatabase, kind: BackupKind): Promise<string | null> {
    try {
      if (typeof db.backup !== 'function') {
        this.logger.warn(
          '[persistence-sqlite] backup skipped — db.backup() is unavailable on this database instance',
          { kind },
        );
        return null;
      }
      const dest = this.destPath(kind);
      const dir = path.dirname(dest);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      await db.backup(dest);
      this.logger.info('[persistence-sqlite] backup completed', { kind, dest });
      return dest;
    } catch (err: unknown) {
      this.logger.warn('[persistence-sqlite] backup failed (non-fatal)', {
        kind,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Deletes all but the `keep` newest backup files for the given kind.
   * When `keep` is 0, no files are deleted (unbounded retention).
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
