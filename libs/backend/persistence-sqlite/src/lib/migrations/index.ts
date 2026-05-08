/**
 * Migration registry — SQL inlined as TS template-literal exports.
 *
 * Each migration is identified by an integer `version`. Migrations are
 * applied in ascending order, exactly once, by `SqliteMigrationRunner`.
 *
 * Why TS modules instead of .sql + a custom loader: the Electron app
 * bundles this module into an ESM main.mjs where `__dirname` is undefined
 * and any custom esbuild `.sql` text loader has to be re-wired in every
 * consuming app's build config. TS template literals are pure JS strings —
 * zero build-tool coupling, zero runtime file I/O, zero path assumptions,
 * works identically across electron / cli / vscode / jest / tsx dev mode.
 *
 * Security: the SQL strings MUST stay static. Each migration file carries
 * a header comment forbidding `${...}` interpolation; ESLint
 * (`no-template-curly-in-migration`) and Semgrep
 * (`sql-injection-in-migration`) enforce the rule under
 * `libs/backend/persistence-sqlite/src/lib/migrations/**\/*.ts`.
 */
import { sql as sql0001Init } from './0001_init';
import { sql as sql0002Memory } from './0002_memory';
import { sql as sql0003Skills } from './0003_skills';
import { sql as sql0004Cron } from './0004_cron';
import { sql as sql0005Gateway } from './0005_gateway';
import { sql as sql0006GatewayPairingCode } from './0006_gateway_pairing_code';
import { sql as sql0007FixVec0Rowid } from './0007_fix_vec0_rowid';
import { sql as sql0008SymbolIndex } from './0008_symbol_index';
import { run as run0009AutoVacuum } from './0009_auto_vacuum';
import { sql as sql0010Fts5Porter } from './0010_fts5_porter';
import type { SqliteDatabase } from '../sqlite-connection.service';

export interface Migration {
  /** Monotonically increasing integer version (matches schema_migrations.version). */
  readonly version: number;
  /** Human-readable name (matches the migration's filename without extension). */
  readonly name: string;
  /**
   * Raw SQL text — may contain multiple statements separated by semicolons.
   * Mutually exclusive with {@link run}: a migration must provide exactly one
   * of `sql` or `run`, never both.
   */
  readonly sql?: string;
  /**
   * Imperative migration function that runs OUTSIDE any transaction. Use only
   * for statements that cannot run inside a transaction (e.g. `VACUUM`).
   * The runner executes `run(db)` first, then records bookkeeping inside a
   * separate post-run transaction. If `run` throws, bookkeeping is NOT written.
   *
   * Mutually exclusive with {@link sql}.
   */
  readonly run?: (db: SqliteDatabase) => void;
  /**
   * When true the migration creates `vec0` virtual tables that require the
   * sqlite-vec extension. If the extension is not loaded the migration runner
   * skips this migration with a warning instead of throwing, so non-vec
   * migrations (cron, gateway) can still be applied.
   */
  readonly requiresVec?: boolean;
}

/**
 * Canonical, ordered list of migrations bundled with this library.
 *
 * Adding a new migration: drop a new `NNNN_description.ts` file in this
 * directory (zero-padded version) exporting `export const sql = \`...\`;`
 * with the static-text header comment, import it above, and append an
 * entry below. NEVER edit a previously-released migration — write a new one.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '0001_init', sql: sql0001Init },
  { version: 2, name: '0002_memory', sql: sql0002Memory, requiresVec: true },
  { version: 3, name: '0003_skills', sql: sql0003Skills, requiresVec: true },
  { version: 4, name: '0004_cron', sql: sql0004Cron },
  { version: 5, name: '0005_gateway', sql: sql0005Gateway },
  {
    version: 6,
    name: '0006_gateway_pairing_code',
    sql: sql0006GatewayPairingCode,
  },
  {
    version: 7,
    name: '0007_fix_vec0_rowid',
    sql: sql0007FixVec0Rowid,
  },
  {
    version: 8,
    name: '0008_symbol_index',
    sql: sql0008SymbolIndex,
  },
  {
    version: 9,
    name: '0009_auto_vacuum',
    run: run0009AutoVacuum,
  },
  {
    version: 10,
    name: '0010_fts5_porter',
    sql: sql0010Fts5Porter,
  },
];
