/**
 * Migration registry — SQL inlined at build time via esbuild's `text` loader.
 *
 * Each migration is identified by an integer `version`. Migrations are
 * applied in ascending order, exactly once, by `SqliteMigrationRunner`.
 *
 * Why static imports instead of fs.readFileSync(__dirname, ...): the
 * Electron app bundles this module into an ESM main.mjs where `__dirname`
 * is undefined and the .sql sibling files don't ship next to the bundle.
 * The text loader inlines each .sql file as a string at build time, so
 * the bundle has zero runtime file I/O and no path assumptions.
 *
 * Bundlers must register the `.sql` text loader. esbuild config lives at
 * apps/ptah-electron/esbuild.config.cjs; the Jest test environment
 * relies on jest-transform-stub (see jest.config.ts).
 */
import sql0001Init from './0001_init.sql';
import sql0002Memory from './0002_memory.sql';
import sql0003Skills from './0003_skills.sql';
import sql0004Cron from './0004_cron.sql';
import sql0005Gateway from './0005_gateway.sql';
import sql0006GatewayPairingCode from './0006_gateway_pairing_code.sql';
import sql0007FixVec0Rowid from './0007_fix_vec0_rowid.sql';

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
 * directory (zero-padded version), import it above, and append an entry
 * below. NEVER edit a previously-released migration — write a new one.
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
