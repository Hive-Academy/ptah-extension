/**
 * SkillMdMigrationStateStore — the SQLite adapter behind
 * `SkillMdMigrationMarkerStore` (migration `0041`, TASK_2026_331 B4).
 *
 * ONE ROW PER SCANNED ROOT, keyed by `skills_root`. `skill-synthesis.service.ts`
 * walks TWO roots back to back — the active root and the candidates root, the
 * latter of which defaults to a SUBdirectory of the former but can be repointed
 * anywhere by `skillSynthesis.candidatesDir`. A single shared row would let a
 * clean walk of the first root assert that the second was migrated too, so a
 * failure in the second would be hidden for the whole 24 h freshness window.
 * Each root's marker is a statement about the tree it names and nothing else.
 *
 * EVERY METHOD DEGRADES INSTEAD OF THROWING. `connection.db` throws
 * `RpcUserError('PERSISTENCE_UNAVAILABLE')` when the database is not open, and
 * a host without persistence never registers this store at all. A failed read
 * reports "no marker", which makes the caller walk — today's behaviour. A
 * failed write costs one extra walk on the next launch. Neither is allowed to
 * escape into `SkillSynthesisService.start()`, and neither may ever cause a
 * walk to be SKIPPED.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import type {
  SkillMdMigrationMarkerState,
  SkillMdMigrationMarkerStore,
} from './skill-md-migration';

interface RawMarkerRow {
  migration_version: number;
  last_scan_at: number;
}

const SELECT_SQL = `SELECT migration_version, last_scan_at
       FROM skill_md_migration_state
      WHERE skills_root = ?`;

const UPSERT_SQL = `INSERT INTO skill_md_migration_state (
         skills_root, migration_version, last_scan_at
       ) VALUES (?, ?, ?)
       ON CONFLICT(skills_root) DO UPDATE SET
         migration_version = excluded.migration_version,
         last_scan_at = excluded.last_scan_at`;

@injectable()
export class SkillMdMigrationStateStore implements SkillMdMigrationMarkerStore {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  read(skillsRoot: string): SkillMdMigrationMarkerState | null {
    try {
      const row = this.db.prepare(SELECT_SQL).get(skillsRoot) as
        | RawMarkerRow
        | undefined;
      if (!row) return null;
      return {
        migrationVersion: Number(row.migration_version),
        lastScanAt: Number(row.last_scan_at),
      };
    } catch (error: unknown) {
      this.logger.debug(
        '[skill-synthesis] SKILL.md migration marker read failed; treating as absent',
        {
          skillsRoot,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return null;
    }
  }

  write(skillsRoot: string, state: SkillMdMigrationMarkerState): void {
    try {
      this.db
        .prepare(UPSERT_SQL)
        .run(skillsRoot, state.migrationVersion, state.lastScanAt);
    } catch (error: unknown) {
      this.logger.warn(
        '[skill-synthesis] SKILL.md migration marker write failed (non-fatal)',
        {
          skillsRoot,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
