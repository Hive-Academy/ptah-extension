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
import {
  sql as sql0002Memory,
  vecSql as vecSql0002Memory,
} from './0002_memory';
import {
  sql as sql0003Skills,
  vecSql as vecSql0003Skills,
} from './0003_skills';
import { sql as sql0004Cron } from './0004_cron';
import { sql as sql0005Gateway } from './0005_gateway';
import { sql as sql0006GatewayPairingCode } from './0006_gateway_pairing_code';
import { vecSql as vecSql0007FixVec0Rowid } from './0007_fix_vec0_rowid';
import { sql as sql0008SymbolIndex } from './0008_symbol_index';
import { run as run0009AutoVacuum } from './0009_auto_vacuum';
import { sql as sql0010Fts5Porter } from './0010_fts5_porter';
import { sql as sql0011SkillsV2 } from './0011_skills_v2';
import { sql as sql0012IndexingState } from './0012_indexing_state';
import {
  sql as sql0013CodeSymbols,
  vecSql as vecSql0013CodeSymbols,
} from './0013_code_symbols';
import { sql as sql0014BootScanState } from './0014_boot_scan_state';
import { sql as sql0015MemoriesSubjectTierIdx } from './0015_memories_subject_tier_idx';
import { sql as sql0016ObservationQueue } from './0016_observation_queue';
import { sql as sql0017MemorySchemaV2 } from './0017_memory_schema_v2';
import { sql as sql0018Corpora } from './0018_corpora';
import { vecSql as vecSql0019MemoryChunksVecCleanup } from './0019_memory_chunks_vec_cleanup';
import { sql as sql0020GatewayBindingAllowListId } from './0020_gateway_binding_allow_list_id';
import { sql as sql0021SkillInvocationEvents } from './0021_skill_invocation_events';
import { sql as sql0022SkillRegistry } from './0022_skill_registry';
import { sql as sql0023SkillRegistryPending } from './0023_skill_registry_pending';
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
   * Optional `vec0` statements (CREATE VIRTUAL TABLE ... USING vec0, plus any
   * vec-only DROP/recreate) that require the sqlite-vec extension. Split out
   * from {@link sql} so the base relational + FTS5 schema always applies even
   * when sqlite-vec is unavailable. When vec is loaded the runner applies
   * `vecSql` in the same transaction as `sql`; when it is not, the runner
   * applies only `sql`, records the version, and defers `vecSql` into
   * `schema_migrations_vec_pending` for a later catch-up pass.
   *
   * Mutually exclusive with {@link run}.
   */
  readonly vecSql?: string;
  /**
   * When true the migration's ENTIRE body is vec0 (no base {@link sql}); it
   * provides only {@link vecSql}. If sqlite-vec is not loaded the runner defers
   * the whole migration into `schema_migrations_vec_pending` WITHOUT recording
   * it as applied, then runs it in full once vec becomes available.
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
  {
    version: 2,
    name: '0002_memory',
    sql: sql0002Memory,
    vecSql: vecSql0002Memory,
  },
  {
    version: 3,
    name: '0003_skills',
    sql: sql0003Skills,
    vecSql: vecSql0003Skills,
  },
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
    vecSql: vecSql0007FixVec0Rowid,
    requiresVec: true,
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
  {
    version: 11,
    name: '0011_skills_v2',
    sql: sql0011SkillsV2,
  },
  {
    version: 12,
    name: '0012_indexing_state',
    sql: sql0012IndexingState,
  },
  {
    version: 13,
    name: '0013_code_symbols',
    sql: sql0013CodeSymbols,
    vecSql: vecSql0013CodeSymbols,
  },
  {
    version: 14,
    name: '0014_boot_scan_state',
    sql: sql0014BootScanState,
  },
  {
    version: 15,
    name: '0015_memories_subject_tier_idx',
    sql: sql0015MemoriesSubjectTierIdx,
  },
  {
    version: 16,
    name: '0016_observation_queue',
    sql: sql0016ObservationQueue,
  },
  {
    version: 17,
    name: '0017_memory_schema_v2',
    sql: sql0017MemorySchemaV2,
  },
  {
    version: 18,
    name: '0018_corpora',
    sql: sql0018Corpora,
  },
  {
    version: 19,
    name: '0019_memory_chunks_vec_cleanup',
    vecSql: vecSql0019MemoryChunksVecCleanup,
    requiresVec: true,
  },
  {
    version: 20,
    name: '0020_gateway_binding_allow_list_id',
    sql: sql0020GatewayBindingAllowListId,
  },
  {
    version: 21,
    name: '0021_skill_invocation_events',
    sql: sql0021SkillInvocationEvents,
  },
  {
    version: 22,
    name: '0022_skill_registry',
    sql: sql0022SkillRegistry,
  },
  {
    version: 23,
    name: '0023_skill_registry_pending',
    sql: sql0023SkillRegistryPending,
  },
];
