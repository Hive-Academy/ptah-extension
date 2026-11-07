/**
 * The "a daily backup is owed" marker (main-loop-sync-blocks fix-12).
 *
 * WHY IT EXISTS. The daily backup is a cron job, and a cron slot is claimed
 * at most once (`cron-scheduler` `RunStore.tryClaim`, `UNIQUE(job_id,
 * scheduled_for)`). A daily backup that waits for a busy host and is then cut
 * short by a quit has already consumed its slot, so cron catch-up never runs it
 * again. This marker is written when a daily backup STARTS and removed once it
 * has RUN. A marker found at the next start therefore means "owed", whatever
 * stopped it — a quit while deferred, a crash, a kill mid-copy.
 *
 * WHERE. Beside the database (`<dbDir>/<dbBase>.daily-backup-pending.json`),
 * never inside `backups/`: the worker creates that directory with `0700` and
 * locks it down only when it creates it, so a host that created it first for a
 * marker would leave it unlocked. The name matches neither a rotation prefix
 * (`<dbBase>.pre-migration-`, `<dbBase>.reset-`) nor the staging suffix.
 *
 * The file is read back from disk, so it is parsed with Zod; anything that
 * does not parse is treated as owed-now rather than ignored, because an
 * unreadable marker is still evidence that a backup did not finish.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';

const MARKER_MODE = 0o600;

const markerSchema = z.object({ dueAt: z.number().int().nonnegative() });

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export class DailyBackupPendingMarker {
  readonly path: string;

  constructor(
    dbPath: string,
    private readonly logger: Logger,
  ) {
    const base = path.basename(dbPath, path.extname(dbPath));
    this.path = path.join(path.dirname(dbPath), `${base}.daily-backup-pending.json`);
  }

  /**
   * The owed backup's due time, or `null` when none is owed. A marker that
   * cannot be parsed counts as due `now`.
   */
  async read(now: number): Promise<number | null> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(this.path, 'utf8');
    } catch (error: unknown) {
      if (isMissingFile(error)) return null;
      this.logger.warn(
        '[persistence-sqlite] daily backup marker unreadable — treating the backup as owed',
        { path: this.path, error: describe(error) },
      );
      return now;
    }
    const parsed = this.parse(raw);
    if (parsed === null) {
      this.logger.warn(
        '[persistence-sqlite] daily backup marker malformed — treating the backup as owed',
        { path: this.path },
      );
      return now;
    }
    return parsed;
  }

  /**
   * Record that a daily backup is due. An existing marker keeps its earlier
   * due time, so a backup owed since yesterday is not re-dated to today.
   * Returns the due time in effect. A failed write is logged; the backup still
   * runs, it just would not be resumed after a quit.
   */
  async markDue(now: number): Promise<number> {
    const existing = await this.read(now);
    if (existing !== null) return Math.min(existing, now);
    try {
      await fs.promises.writeFile(this.path, JSON.stringify({ dueAt: now }), {
        mode: MARKER_MODE,
      });
    } catch (error: unknown) {
      this.logger.warn(
        '[persistence-sqlite] daily backup marker not written — a quit before the backup runs will skip it',
        { path: this.path, error: describe(error) },
      );
    }
    return now;
  }

  /** The daily backup has run. A missing marker is already the goal state. */
  async clear(): Promise<void> {
    try {
      await fs.promises.unlink(this.path);
    } catch (error: unknown) {
      if (isMissingFile(error)) return;
      this.logger.warn(
        '[persistence-sqlite] daily backup marker not removed — the next start will run one more daily backup',
        { path: this.path, error: describe(error) },
      );
    }
  }

  private parse(raw: string): number | null {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      // degradation-audit: reported - the caller logs a malformed marker at warn and treats the backup as owed
      return null;
    }
    const result = markerSchema.safeParse(json);
    return result.success ? result.data.dueAt : null;
  }
}
