/**
 * Migration registry — loads numbered .sql files at module init.
 *
 * Each migration is identified by an integer `version`. Migrations are
 * applied in ascending order, exactly once, by `SqliteMigrationRunner`.
 *
 * SQL is read from sibling .sql files via fs.readFileSync at module load.
 * That keeps the SQL human-readable in source control while letting the
 * runner treat it as opaque text. Consumers of bundled builds (esbuild)
 * must include `*.sql` in the build assets — see the lib's project.json.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Migration {
  /** Monotonically increasing integer version (matches schema_migrations.version). */
  readonly version: number;
  /** Human-readable name (filename without extension). */
  readonly name: string;
  /** Raw SQL text — may contain multiple statements separated by semicolons. */
  readonly sql: string;
}

/**
 * Canonical, ordered list of migrations bundled with this library.
 *
 * Adding a new migration: drop a new `NNNN_description.sql` file in this
 * directory (zero-padded version) and append an entry below. NEVER edit
 * a previously-released migration — write a new one instead.
 */
export const MIGRATIONS: readonly Migration[] = loadMigrations();

function loadMigrations(): readonly Migration[] {
  const dir = __dirname;
  const files: Array<{ version: number; name: string; file: string }> = [
    { version: 1, name: '0001_init', file: '0001_init.sql' },
    { version: 2, name: '0002_memory', file: '0002_memory.sql' },
    { version: 3, name: '0003_skills', file: '0003_skills.sql' },
    { version: 4, name: '0004_cron', file: '0004_cron.sql' },
    { version: 5, name: '0005_gateway', file: '0005_gateway.sql' },
  ];
  return files.map(({ version, name, file }) => ({
    version,
    name,
    sql: fs.readFileSync(path.join(dir, file), 'utf8'),
  }));
}
