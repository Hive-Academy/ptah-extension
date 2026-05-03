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

export interface Migration {
  /** Monotonically increasing integer version (matches schema_migrations.version). */
  readonly version: number;
  /** Human-readable name (matches the migration's filename without extension). */
  readonly name: string;
  /** Raw SQL text — may contain multiple statements separated by semicolons. */
  readonly sql: string;
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
  { version: 2, name: '0002_memory', sql: sql0002Memory },
  { version: 3, name: '0003_skills', sql: sql0003Skills },
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
];
