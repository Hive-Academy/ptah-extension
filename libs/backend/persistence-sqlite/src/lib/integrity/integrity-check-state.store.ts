/**
 * IntegrityCheckStateStore — the SQLite adapter over `db_integrity_check_state`
 * (migration `0042`, TASK_2026_380 B1).
 *
 * ONE ROW FOR THE WHOLE TABLE, keyed `id = 1`, because the record describes the
 * database file it lives in. That is the deliberate INVERSE of
 * `SkillMdMigrationStateStore`'s per-root key: that store describes directory
 * trees that can be repointed and are walked independently, so a shared row
 * would let one tree's verdict speak for another. Here there is exactly one
 * file, and a second row could only be a duplicate.
 *
 * EVERY METHOD DEGRADES INSTEAD OF THROWING, and the direction of the degrade
 * matters more than the fact of it. `connection.db` throws
 * `RpcUserError('PERSISTENCE_UNAVAILABLE')` when the database is not open, and
 * a host without persistence never registers this store at all. A failed READ
 * reports "no record", which makes the caller RUN a check — the safe direction,
 * costing at worst one out-of-band worker run. A failed WRITE costs one extra
 * check in the next window. Neither may escape into the dispatch path, and
 * neither may ever cause a due check to be SKIPPED.
 *
 * This store persists a verdict; it does not interpret one. Freshness, the
 * seven-day interval and the clock-skew rule all live in
 * `SqliteIntegrityService`.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from '../di/tokens';
import type {
  SqliteConnectionService,
  SqliteDatabase,
} from '../sqlite-connection.service';

/**
 * The persisted record of the last integrity check that reached a verdict.
 *
 * An `'unavailable'` worker verdict is never recorded, so `quickCheckOk` always
 * describes a check that actually ran.
 */
export interface IntegrityCheckState {
  /** Epoch ms at which the check completed. */
  readonly checkedAt: number;
  /** `true` when `PRAGMA quick_check` returned exactly `ok`. */
  readonly quickCheckOk: boolean;
  /** Row count returned by `PRAGMA foreign_key_check`. */
  readonly foreignKeyViolations: number;
  /** Wall-clock cost of the pair of pragmas, in ms. Diagnostic only. */
  readonly durationMs: number;
  /** `PRAGMA page_count` at check time. Diagnostic only. */
  readonly pageCount: number;
  /** What `quick_check` said when it was not `ok`; `null` on a clean check. */
  readonly detail: string | null;
}

interface RawStateRow {
  checked_at: number;
  quick_check_ok: number;
  foreign_key_violations: number;
  duration_ms: number;
  page_count: number;
  detail: string | null;
}

const SELECT_SQL = `SELECT checked_at, quick_check_ok, foreign_key_violations,
              duration_ms, page_count, detail
         FROM db_integrity_check_state
        WHERE id = 1`;

const UPSERT_SQL = `INSERT INTO db_integrity_check_state (
         id, checked_at, quick_check_ok, foreign_key_violations,
         duration_ms, page_count, detail
       ) VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         checked_at = excluded.checked_at,
         quick_check_ok = excluded.quick_check_ok,
         foreign_key_violations = excluded.foreign_key_violations,
         duration_ms = excluded.duration_ms,
         page_count = excluded.page_count,
         detail = excluded.detail`;

@injectable()
export class IntegrityCheckStateStore {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  /** The stored record, or `null` when there is none or the read failed. */
  read(): IntegrityCheckState | null {
    try {
      const row = this.db.prepare(SELECT_SQL).get() as RawStateRow | undefined;
      if (!row) return null;
      return {
        checkedAt: Number(row.checked_at),
        quickCheckOk: Number(row.quick_check_ok) === 1,
        foreignKeyViolations: Number(row.foreign_key_violations),
        durationMs: Number(row.duration_ms),
        pageCount: Number(row.page_count),
        detail: row.detail ?? null,
      };
    } catch (error: unknown) {
      // Debug, not warn: on a host with no open database this fires on every
      // due-check, and the outcome — run the check — is the correct one.
      this.logger.debug(
        '[persistence-sqlite] integrity check state read failed; treating as never checked',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return null;
    }
  }

  /** Persist the record, replacing any previous one. Never throws. */
  write(state: IntegrityCheckState): void {
    try {
      this.db
        .prepare(UPSERT_SQL)
        .run(
          state.checkedAt,
          state.quickCheckOk ? 1 : 0,
          state.foreignKeyViolations,
          state.durationMs,
          state.pageCount,
          state.detail,
        );
    } catch (error: unknown) {
      this.logger.warn(
        '[persistence-sqlite] integrity check state write failed (non-fatal)',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }
}
