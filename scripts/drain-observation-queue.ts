/**
 * Offline drain of `observation_queue` processed-row backlog (TASK_2026_483).
 *
 * Why this exists
 * ---------------
 * `~/.ptah/state/ptah.sqlite` reached 1.2 GB, of which `observation_queue`
 * holds ~878 MB across ~178k rows — ~171.5k of them already curated
 * (`processed_at IS NOT NULL`). Runtime retention (`ObservationRetentionStore`,
 * TASK_2026_440 / TASK_2026_478) is CORRECT, but under sustained
 * `BackgroundWorkGovernor` contention it halves its batch to a floor of 50 rows
 * per run to keep synchronous SQLite work off the Electron main thread. At that
 * rate the standing backlog takes 4.8 to 14.3 months. That bound is the right
 * runtime trade-off and this script does not touch it.
 *
 * This is an OFFLINE tool. It runs with the app closed, so there is no main
 * thread to protect and no governor to respect. It is not a runtime path, so it
 * does not violate `libs/backend/memory-curator/CLAUDE.md`'s rule that
 * `observation_queue` rows leave the table through `ObservationRetentionStore`
 * only — no second runtime purge path is added anywhere.
 *
 * What it will not do
 * -------------------
 * - It never touches a row with `processed_at IS NULL`. Those are uncurated
 *   observations; deleting one loses data silently. Every statement carries the
 *   `processed_at IS NOT NULL` predicate, including the final DELETE, which
 *   re-checks it rather than trusting the id list it was handed.
 * - It never writes `processed_at`. Only a curator pass that actually ran may.
 * - It never runs `VACUUM`. A full vacuum rewrites the whole file; pages come
 *   back through bounded `PRAGMA incremental_vacuum(N)` steps, mirroring
 *   `SqlitePageReclaimer` in `persistence-sqlite` (that class is tsyringe- and
 *   DI-bound, so its pragma logic is reproduced here rather than imported).
 * - It never creates an index on `observation_queue`. A migration building one
 *   reads the 1 GB file on the boot path.
 *
 * The cutoff is keyed on `processed_at`, NOT `captured_at`, matching
 * `ObservationRetentionStore`: a row captured long ago but processed yesterday
 * is still fresh and must survive.
 *
 * Usage
 * -----
 *   npm run db:drain-observations -- --dry-run
 *   npm run db:drain-observations -- --processed-days 7
 *   npm run db:drain-observations -- --force        # skip the backup, deliberately
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// better-sqlite3 surface
//
// The repository carries no `@types/better-sqlite3`; `persistence-sqlite`
// declares the minimal structural subset it uses and `require`s the module
// with a cast (`sqlite-connection.service.ts:42,794`). This script follows the
// same convention rather than adding a dependency for a maintenance tool.
// ---------------------------------------------------------------------------

interface SqliteStatement {
  run(params: Record<string, unknown>): { changes: number };
  get(...params: unknown[]): unknown;
  all(params: Record<string, unknown>): unknown[];
}

interface SqliteTransaction<T> {
  (): T;
  immediate(): T;
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  /**
   * Transaction control goes through `exec`, never `prepare`. Every one of the
   * ten existing call sites in this repository does the same — e.g.
   * `observation-queue.store.ts:627`, `memory-lifecycle.store.ts:292`,
   * `observation-retention.store.ts:641`.
   */
  exec(sql: string): void;
  pragma(pragma: string, options?: { simple?: boolean }): unknown;
  backup(destPath: string): Promise<void>;
  close(): void;
  transaction<T>(fn: () => T): SqliteTransaction<T>;
}

type SqliteDatabaseConstructor = new (
  file: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => SqliteDatabase;

export function openDatabase(
  file: string,
  options: { readonly: boolean; fileMustExist: boolean },
): SqliteDatabase {
  const Database = require('better-sqlite3') as SqliteDatabaseConstructor;
  return new Database(file, options);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** `PRAGMA auto_vacuum` value meaning INCREMENTAL. Mirrors `SqlitePageReclaimer`. */
const AUTO_VACUUM_INCREMENTAL = 2;

/** Largest `maxPages` a single reclaim step accepts. Mirrors `SqlitePageReclaimer`. */
const MAX_PAGES_PER_STEP = 65_536;

/** Runtime default for `memory.retention.processedDays`. */
const DEFAULT_PROCESSED_DAYS = 7;

/** Rows deleted per transaction. Bounded so an interrupt loses at most one batch. */
const DEFAULT_BATCH_SIZE = 2_000;

/** Pages handed back per `incremental_vacuum` step. */
const DEFAULT_RECLAIM_STEP_PAGES = 4_096;

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Electron `userData` directory name, as observed on disk
 * (`%APPDATA%\Ptah`). The single-instance lock lives at `<userData>/lockfile`.
 */
const USER_DATA_DIR_NAME = 'Ptah';

const VSCODE_PROCESS_NAMES = new Set([
  'code.exe',
  'code - insiders.exe',
  'vscodium.exe',
]);
const NODE_PROCESS_NAMES = new Set(['node.exe', 'node']);

/**
 * Matches a Node command line that is a Ptah CLI or TUI entry point. Copied in
 * spirit from `apps/ptah-electron/scripts/backup-local-production-data.js`,
 * which solves the same "is a Ptah writer alive" problem.
 */
const PTAH_CLI_ENTRY =
  /[\\/](@hive-academy[\\/]ptah-cli|dist[\\/]apps[\\/]ptah-(cli|tui)|apps[\\/]ptah-(cli|tui)[\\/]src)[\\/](main|tui)\.(mjs|js|tsx?)(?:["'\s]|$)/i;

/**
 * Non-mutating exclusive-access probe, copied from
 * `apps/ptah-electron/scripts/backup-local-production-data.js:87`. Opens each
 * path with `FileShare::None` and disposes the handle immediately; a path that
 * cannot be opened that way is held by someone else. Paths arrive through the
 * environment, never through string interpolation into the script text.
 */
const WINDOWS_EXCLUSIVE_OPEN_PROBE =
  "$ErrorActionPreference='Stop';" +
  '$paths=ConvertFrom-Json $env:PTAH_DRAIN_PROBE_PATHS_JSON;' +
  '$locked=@();' +
  'foreach($file in $paths){try{' +
  '$handle=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);' +
  '$handle.Dispose()' +
  '}catch{$locked+=$file}};' +
  'ConvertTo-Json -InputObject @($locked) -Depth 2 -Compress';

const WINDOWS_PROCESS_INSPECTION =
  // Windows PowerShell 5.1 collapses a one-element array, so wrap in @().
  "$ErrorActionPreference='Stop';" +
  '$processes=@(Get-CimInstance Win32_Process|Select-Object ProcessId,Name,CommandLine);' +
  'ConvertTo-Json -InputObject @($processes) -Depth 3 -Compress';

// ---------------------------------------------------------------------------
// Argument parsing — the one external boundary, so Zod guards it
// ---------------------------------------------------------------------------

const KNOWN_FLAGS = new Set(['--dry-run', '--force']);
const KNOWN_OPTIONS = new Set([
  '--db',
  '--processed-days',
  '--batch-size',
  '--max-rows',
  '--reclaim-step-pages',
]);

/**
 * `--reclaim-step-pages` is interpolated into pragma text, which cannot take a
 * bound parameter. The `int()` + range bound here IS the injection guard, and
 * it is re-asserted at the call site before any SQL is built.
 */
const OptionsSchema = z.object({
  dbPath: z.string().min(1),
  processedDays: z.number().int().min(1).max(365),
  batchSize: z.number().int().min(1).max(50_000),
  maxRows: z.number().int().min(1).max(10_000_000).nullable(),
  reclaimStepPages: z.number().int().min(1).max(MAX_PAGES_PER_STEP),
  dryRun: z.boolean(),
  force: z.boolean(),
});

type Options = z.infer<typeof OptionsSchema>;

function defaultDatabasePath(): string {
  return path.join(os.homedir(), '.ptah', 'state', 'ptah.sqlite');
}

function parseIntegerOption(flag: string, raw: string | undefined): number {
  if (raw === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `${flag} expects a non-negative integer, received "${raw}"`,
    );
  }
  return Number.parseInt(raw, 10);
}

export function parseArgs(argv: readonly string[]): Options {
  let dbPath = defaultDatabasePath();
  let processedDays = DEFAULT_PROCESSED_DAYS;
  let batchSize = DEFAULT_BATCH_SIZE;
  let maxRows: number | null = null;
  let reclaimStepPages = DEFAULT_RECLAIM_STEP_PAGES;
  let dryRun = false;
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (!KNOWN_FLAGS.has(token) && !KNOWN_OPTIONS.has(token)) {
      throw new Error(`Unknown argument: ${token}`);
    }
    if (token === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (token === '--force') {
      force = true;
      continue;
    }
    const value = argv[index + 1];
    index += 1;
    switch (token) {
      case '--db':
        if (value === undefined || value.startsWith('--')) {
          throw new Error('--db requires a path');
        }
        dbPath = path.resolve(value);
        break;
      case '--processed-days':
        processedDays = parseIntegerOption(token, value);
        break;
      case '--batch-size':
        batchSize = parseIntegerOption(token, value);
        break;
      case '--max-rows':
        maxRows = parseIntegerOption(token, value);
        break;
      case '--reclaim-step-pages':
        reclaimStepPages = parseIntegerOption(token, value);
        break;
      default:
        throw new Error(`Unhandled option: ${token}`);
    }
  }

  const parsed = OptionsSchema.safeParse({
    dbPath,
    processedDays,
    batchSize,
    maxRows,
    reclaimStepPages,
    dryRun,
    force,
  });
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid arguments — ${detail}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Safety interlocks
// ---------------------------------------------------------------------------

export interface LivenessFinding {
  readonly kind: 'lockfile' | 'process' | 'file-lock' | 'write-lock';
  readonly detail: string;
}

/**
 * Candidate Electron single-instance lock paths. Windows is the shipping
 * desktop target; the other two are the standard Electron `userData` roots so
 * this check is not silently a no-op on another platform.
 */
export function lockfileCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = os.homedir(),
): string[] {
  if (platform === 'win32') {
    const appData = env['APPDATA'] ?? path.join(homedir, 'AppData', 'Roaming');
    return [path.join(appData, USER_DATA_DIR_NAME, 'lockfile')];
  }
  if (platform === 'darwin') {
    return [
      path.join(
        homedir,
        'Library',
        'Application Support',
        USER_DATA_DIR_NAME,
        'lockfile',
      ),
    ];
  }
  const configHome = env['XDG_CONFIG_HOME'] ?? path.join(homedir, '.config');
  return [path.join(configHome, USER_DATA_DIR_NAME, 'lockfile')];
}

function findLockfiles(): LivenessFinding[] {
  const findings: LivenessFinding[] = [];
  for (const candidate of lockfileCandidates()) {
    if (fs.existsSync(candidate)) {
      findings.push({
        kind: 'lockfile',
        detail: `single-instance lock present at ${candidate}`,
      });
    }
  }
  return findings;
}

interface WindowsProcessRecord {
  readonly ProcessId: number;
  readonly Name: string;
  readonly CommandLine: string | null;
}

export function findPtahProcesses(
  records: readonly WindowsProcessRecord[],
): WindowsProcessRecord[] {
  const writers: WindowsProcessRecord[] = [];
  for (const record of records) {
    if (
      typeof record?.ProcessId !== 'number' ||
      typeof record?.Name !== 'string' ||
      !(record.CommandLine === null || typeof record.CommandLine === 'string')
    ) {
      throw new Error('Process inspection returned malformed data');
    }
    const name = record.Name.toLowerCase();
    if (name === 'ptah.exe' || VSCODE_PROCESS_NAMES.has(name)) {
      writers.push(record);
      continue;
    }
    if (NODE_PROCESS_NAMES.has(name)) {
      if (record.CommandLine === null) {
        // An unreadable command line means we cannot rule this process out.
        // Refusing is the only safe reading.
        throw new Error(
          `Cannot verify whether Node process ${record.ProcessId} is a Ptah writer`,
        );
      }
      if (PTAH_CLI_ENTRY.test(record.CommandLine)) writers.push(record);
    }
  }
  return writers;
}

function powershellPath(): string {
  return path.join(
    process.env['SystemRoot'] ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
}

function inspectProcesses(): LivenessFinding[] {
  if (process.platform !== 'win32') {
    // No portable process inspection here. The exclusive-open probe below is
    // the authoritative check on every platform, so say so rather than
    // implying a check ran.
    return [];
  }
  let records: unknown;
  try {
    const output = execFileSync(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROCESS_INSPECTION],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
    );
    records = JSON.parse(output);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not verify that Ptah is closed: ${detail}`);
  }
  if (!Array.isArray(records)) {
    throw new Error('Process inspection returned malformed data');
  }
  return findPtahProcesses(records as readonly WindowsProcessRecord[]).map(
    (record) => ({
      kind: 'process' as const,
      detail: `${record.Name} (PID ${record.ProcessId}) is running`,
    }),
  );
}

/**
 * Parses the JSON array of locked paths emitted by
 * `WINDOWS_EXCLUSIVE_OPEN_PROBE`. Anything that is not an array of strings is a
 * failure to check, which must read as "locked", never as "clear".
 */
export function parseLockedPaths(payload: unknown): string[] {
  if (!Array.isArray(payload)) {
    throw new Error('Exclusive-access probe returned malformed data');
  }
  return payload.map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error('Exclusive-access probe returned malformed data');
    }
    return entry;
  });
}

/**
 * The authoritative interlock on Windows: try to take the database file with
 * `FileShare::None`, which succeeds only when nothing else holds it. This
 * catches a live app whose lockfile is missing, a stale lockfile left by a
 * crash, and any writer this script does not know how to name.
 *
 * This is the repository's own probe, copied from
 * `apps/ptah-electron/scripts/backup-local-production-data.js:87` — the file
 * this script's header already cites as its precedent. It opens a handle and
 * disposes it; it does NOT rename, truncate or write. An earlier revision used
 * `fs.renameSync(file, file)` here, which mutated the production file to ask a
 * read-only question.
 *
 * On POSIX, SQLite's locks are ADVISORY and no `open` mode denies another
 * process access, so an open probe cannot answer this question at all. Saying
 * so is better than an open that always succeeds and reads as "clear":
 * `probeWriteLock` is the authority there, and it contends for the very lock a
 * real write would take.
 */
export function probeExclusiveAccess(dbPath: string): LivenessFinding[] {
  if (process.platform !== 'win32') return [];

  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].filter((file) =>
    fs.existsSync(file),
  );
  if (files.length === 0) return [];

  let locked: string[];
  try {
    const output = execFileSync(
      powershellPath(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        WINDOWS_EXCLUSIVE_OPEN_PROBE,
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          PTAH_DRAIN_PROBE_PATHS_JSON: JSON.stringify(files),
        },
      },
    );
    locked = parseLockedPaths(JSON.parse(output));
  } catch (error: unknown) {
    // Fail closed. "I could not check" must never become "safe to proceed".
    const detail = error instanceof Error ? error.message : String(error);
    return [
      {
        kind: 'file-lock',
        detail: `could not verify exclusive access to ${path.basename(dbPath)} (${detail})`,
      },
    ];
  }

  return locked.map((file) => ({
    kind: 'file-lock' as const,
    detail: `${path.basename(file)} is held by another process (exclusive open denied)`,
  }));
}

/**
 * True when the target is the live database this Ptah install actually uses.
 *
 * The lockfile and process checks are INSTALL-WIDE: they say "a Ptah is
 * running", not "a Ptah has THIS file open". Applied to an arbitrary `--db`
 * (an old pre-migration snapshot, a copy, a test fixture) they would refuse
 * work that is perfectly safe. So they are blocking for the live file and
 * advisory for anything else, while the two per-file probes below — which DO
 * answer "is this file held" — stay blocking in every case.
 *
 * `path.resolve` alone is LEXICAL: it does not follow a symlink, does not
 * traverse an NTFS junction and does not expand an 8.3 short name, so
 * `C:\Users\ABDAL~1\.ptah\state\ptah.sqlite` compared unequal to the very file
 * it names. Both sides therefore go through `fs.realpathSync.native` first.
 *
 * A path that cannot be resolved (it does not exist, or a directory on the way
 * is unreadable) counts as the live database. "I could not tell" must read as
 * "treat it as live", because the live classification is the STRICTER one —
 * the alternative hands an unresolvable path the advisory branch.
 */
function normaliseRealPath(value: string): string | undefined {
  let resolved: string;
  try {
    resolved = fs.realpathSync.native(path.resolve(value));
  } catch {
    // Unresolvable — missing, or a directory on the way is unreadable. The
    // caller FAILS CLOSED on this, so the reason is not actionable here.
    return undefined;
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function targetsLiveDatabase(
  dbPath: string,
  livePath: string = defaultDatabasePath(),
): boolean {
  const target = normaliseRealPath(dbPath);
  const live = normaliseRealPath(livePath);
  if (target === undefined || live === undefined) return true;
  return target === live;
}

/**
 * Asks SQLite itself whether the write lock is free, with `busy_timeout = 0`
 * so a held lock returns SQLITE_BUSY immediately instead of blocking.
 *
 * This is the portable half of the interlock. The `FileShare::None` probe above
 * is decisive on Windows, where the OS enforces sharing, but it has no POSIX
 * equivalent — SQLite's locks there are ADVISORY and no `open` mode denies
 * another process. `BEGIN IMMEDIATE` is the check that works everywhere,
 * because it contends for the same lock a real write would take.
 */
export function probeWriteLock(dbPath: string): LivenessFinding[] {
  let db: SqliteDatabase | undefined;
  try {
    db = openDatabase(dbPath, { readonly: false, fileMustExist: true });
    db.pragma('busy_timeout = 0');
    db.exec('BEGIN IMMEDIATE');
    db.exec('ROLLBACK');
    return [];
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return [
      {
        kind: 'write-lock',
        detail: `SQLite refused the write lock immediately (${detail})`,
      },
    ];
  } finally {
    if (db !== undefined) {
      try {
        db.close();
      } catch {
        // Closing a connection that never opened cleanly is not a new fault.
      }
    }
  }
}

function collectLivenessFindings(
  dbPath: string,
  dryRun: boolean,
): { blocking: LivenessFinding[]; advisory: LivenessFinding[] } {
  // Both per-file probes are INTRUSIVE, each in its own way: `probeWriteLock`
  // opens the file read-write (which on close can checkpoint the WAL), and
  // `probeExclusiveAccess` momentarily denies every other process access to a
  // database a running app may be mid-read on. Neither belongs in a run that
  // advertises itself as read-only, so a dry run runs neither and the banner
  // says so. A dry run needs no interlock anyway: its only handle is read-only.
  const perFile = dryRun
    ? []
    : [...probeExclusiveAccess(dbPath), ...probeWriteLock(dbPath)];
  const live = targetsLiveDatabase(dbPath);
  // `inspectProcesses` THROWS when it cannot answer, and that throw propagates
  // out of `main` on every target, live or not. "I could not check" must never
  // become "safe to proceed" — the classification below decides whether a
  // finding is blocking, never whether a failure to look is tolerable.
  const installWide = [...findLockfiles(), ...inspectProcesses()];
  return live
    ? { blocking: [...installWide, ...perFile], advisory: [] }
    : { blocking: perFile, advisory: installWide };
}

/**
 * The interlocks re-run immediately before the first DELETE, closing the window
 * between the pre-flight check and the drain — a backup of a 1.2 GB file takes
 * minutes, and nothing holds the exclusion across it.
 *
 * `probeExclusiveAccess` is deliberately omitted: by this point THIS process
 * holds the database open, so a `FileShare::None` open would be denied by our
 * own handle and refuse every run. `probeWriteLock` has no such problem — our
 * connection holds no write lock between transactions — so it remains the
 * per-file authority here, alongside the install-wide checks.
 */
export function recheckBeforeDelete(dbPath: string): LivenessFinding[] {
  const live = targetsLiveDatabase(dbPath);
  const perFile = probeWriteLock(dbPath);
  const installWide = live ? [...findLockfiles(), ...inspectProcesses()] : [];
  return [...installWide, ...perFile];
}

// ---------------------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------------------

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function fileSizeBytes(dbPath: string): number {
  let total = 0;
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(file)) total += fs.statSync(file).size;
  }
  return total;
}

interface PageStats {
  readonly pageSize: number;
  readonly pageCount: number;
  readonly freelistCount: number;
  readonly autoVacuumMode: number;
}

function readPageStats(db: SqliteDatabase): PageStats {
  const read = (pragma: string): number => {
    const value = db.pragma(pragma, { simple: true });
    return typeof value === 'number' ? value : 0;
  };
  return {
    pageSize: read('page_size'),
    pageCount: read('page_count'),
    freelistCount: read('freelist_count'),
    autoVacuumMode: read('auto_vacuum'),
  };
}

interface QueueStats {
  readonly total: number;
  readonly processed: number;
  readonly unprocessed: number;
  readonly eligible: number;
  readonly oldestProcessedAt: number | null;
  readonly newestProcessedAt: number | null;
  readonly eligibleBytes: number;
}

function readCount(db: SqliteDatabase, sql: string, params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { value: number } | undefined;
  return row === undefined ? 0 : Number(row.value);
}

function readQueueStats(db: SqliteDatabase, cutoffMs: number): QueueStats {
  const total = readCount(
    db,
    'SELECT COUNT(*) AS value FROM observation_queue',
    [],
  );
  const processed = readCount(
    db,
    'SELECT COUNT(*) AS value FROM observation_queue WHERE processed_at IS NOT NULL',
    [],
  );
  const unprocessed = readCount(
    db,
    'SELECT COUNT(*) AS value FROM observation_queue WHERE processed_at IS NULL',
    [],
  );
  const eligible = readCount(
    db,
    'SELECT COUNT(*) AS value FROM observation_queue WHERE processed_at IS NOT NULL AND processed_at < ?',
    [cutoffMs],
  );
  const bounds = db
    .prepare(
      'SELECT MIN(processed_at) AS lo, MAX(processed_at) AS hi FROM observation_queue WHERE processed_at IS NOT NULL',
    )
    .get() as { lo: number | null; hi: number | null } | undefined;
  const bytes = db
    .prepare(
      `SELECT COALESCE(SUM(
         LENGTH(COALESCE(tool_input_json, '')) +
         LENGTH(COALESCE(tool_response_text, '')) +
         LENGTH(COALESCE(assistant_message, '')) +
         LENGTH(COALESCE(user_prompt, ''))
       ), 0) AS value
       FROM observation_queue
       WHERE processed_at IS NOT NULL AND processed_at < ?`,
    )
    .get(cutoffMs) as { value: number } | undefined;

  return {
    total,
    processed,
    unprocessed,
    eligible,
    oldestProcessedAt: bounds?.lo ?? null,
    newestProcessedAt: bounds?.hi ?? null,
    eligibleBytes: bytes === undefined ? 0 : Number(bytes.value),
  };
}

function formatTimestamp(value: number | null): string {
  if (value === null) return 'n/a';
  return new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

/**
 * Writes a consistent single-file copy through SQLite's own backup API, which
 * folds in WAL content — a plain `copyFile` of the main file alone would leave
 * the most recent commits behind in `-wal`.
 */
async function createBackup(
  db: SqliteDatabase,
  dbPath: string,
): Promise<string> {
  const backupDir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(
    backupDir,
    `${path.basename(dbPath, path.extname(dbPath))}-pre-drain-${stamp}.sqlite`,
  );
  if (fs.existsSync(destination)) {
    throw new Error(`Backup destination already exists: ${destination}`);
  }
  console.log(`[drain] backing up to ${destination} …`);
  await db.backup(destination);
  verifyBackup(dbPath, destination);
  console.log(
    `[drain] backup verified (${formatMegabytes(fs.statSync(destination).size)})`,
  );
  return destination;
}

/**
 * A backup taken before deleting 149,000 rows has to be proved, not assumed.
 * `size === 0` would pass a 4 KB truncated header.
 *
 * Two checks, both of which must hold before the first DELETE:
 *
 * 1. **Byte size against the source.** `db.backup()` is SQLite's online backup
 *    API: it copies the source page-for-page and folds in WAL content, so the
 *    copy is never smaller than the source main file. A shorter copy means a
 *    truncated or failed write.
 * 2. **`PRAGMA quick_check` on the copy.** Reads the copy back through SQLite
 *    and verifies its b-tree structure. This is the repository's own standard —
 *    `persistence-sqlite`'s `performBackup` validates the staging file before
 *    publishing it under the final name.
 *
 * Either failing throws, which aborts the run upstream of `drainBatches`.
 */
export function verifyBackup(dbPath: string, destination: string): void {
  const sourceBytes = fs.statSync(dbPath).size;
  const copyBytes = fs.statSync(destination).size;
  if (copyBytes === 0) {
    throw new Error(`Backup produced an empty file: ${destination}`);
  }
  if (copyBytes < sourceBytes) {
    throw new Error(
      `Backup is smaller than the source (${formatMegabytes(copyBytes)} < ` +
        `${formatMegabytes(sourceBytes)}); refusing to delete against it: ${destination}`,
    );
  }

  const copy = openDatabase(destination, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const result = copy.pragma('quick_check', { simple: true });
    if (result !== 'ok') {
      throw new Error(
        `PRAGMA quick_check on the backup returned "${String(result)}"; ` +
          `refusing to delete against it: ${destination}`,
      );
    }
  } finally {
    try {
      copy.close();
    } catch {
      // The verification already succeeded or threw; a close fault adds nothing.
    }
    // Reading the copy back re-creates its WAL sidecars. A backup is one file,
    // as `persistence-sqlite`'s `performBackup` publishes it — a stray `-wal`
    // beside it invites a later restore that half-applies.
    for (const sidecar of [`${destination}-wal`, `${destination}-shm`]) {
      try {
        if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
      } catch {
        // A sidecar the OS still holds is cosmetic; the copy is already valid.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Delete loop
// ---------------------------------------------------------------------------

/**
 * Selects one bounded batch of eligible ids. Keyed on the `id` primary key so
 * the cursor is monotonic across batches and an interrupted run resumes simply
 * by being re-run — the rows it already removed are gone, so the next run's
 * scan starts past them.
 */
const SELECT_BATCH_SQL = `SELECT id FROM observation_queue
 WHERE id > @cursor AND processed_at IS NOT NULL AND processed_at < @cutoff
 ORDER BY id
 LIMIT @limit`;

/**
 * Re-checks `processed_at IS NOT NULL AND processed_at < @cutoff` rather than
 * trusting the id list. The id list and the delete run in the same transaction,
 * but the re-check costs nothing and makes it impossible for this statement to
 * remove an unprocessed row even if the selection above were ever changed.
 */
const DELETE_BATCH_SQL = `DELETE FROM observation_queue
 WHERE id IN (SELECT value FROM json_each(@ids))
   AND processed_at IS NOT NULL
   AND processed_at < @cutoff`;

interface DrainResult {
  readonly deleted: number;
  readonly batches: number;
  readonly interrupted: boolean;
}

export function drainBatches(
  db: SqliteDatabase,
  options: Options,
  cutoffMs: number,
  isInterrupted: () => boolean,
): DrainResult {
  const selectBatch = db.prepare(SELECT_BATCH_SQL);
  const deleteBatch = db.prepare(DELETE_BATCH_SQL);

  let cursor = 0;
  let deleted = 0;
  let batches = 0;
  const startedAt = Date.now();

  for (;;) {
    if (isInterrupted()) {
      return { deleted, batches, interrupted: true };
    }
    if (options.maxRows !== null && deleted >= options.maxRows) break;

    const remaining =
      options.maxRows === null
        ? options.batchSize
        : Math.min(options.batchSize, options.maxRows - deleted);

    const rows = selectBatch.all({
      cursor,
      cutoff: cutoffMs,
      limit: remaining,
    }) as Array<{ id: number }>;
    if (rows.length === 0) break;

    const ids = rows.map((row) => row.id);
    const lastId = ids[ids.length - 1];
    if (lastId === undefined) break;

    const run = db.transaction(() => {
      return deleteBatch.run({ ids: JSON.stringify(ids), cutoff: cutoffMs })
        .changes;
    });
    // BEGIN IMMEDIATE: take the write lock up front rather than upgrading
    // mid-transaction, which is where SQLITE_BUSY comes from.
    const changes = run.immediate();

    cursor = lastId;
    deleted += changes;
    batches += 1;

    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const rate = elapsedSeconds > 0 ? Math.round(deleted / elapsedSeconds) : 0;
    console.log(
      `[drain] batch ${batches}: deleted ${formatCount(changes)} (total ${formatCount(
        deleted,
      )}, cursor id ${formatCount(cursor)}, ${formatCount(rate)} rows/s)`,
    );
  }

  return { deleted, batches, interrupted: false };
}

// ---------------------------------------------------------------------------
// Page reclamation
// ---------------------------------------------------------------------------

interface ReclaimOutcome {
  readonly available: boolean;
  readonly reason: string;
  readonly pagesReclaimed: number;
}

function reclaimPages(
  db: SqliteDatabase,
  stepPages: number,
  isInterrupted: () => boolean,
): ReclaimOutcome {
  const stats = readPageStats(db);
  if (stats.autoVacuumMode !== AUTO_VACUUM_INCREMENTAL) {
    const mode =
      stats.autoVacuumMode === 0
        ? 'NONE'
        : stats.autoVacuumMode === 1
          ? 'FULL'
          : String(stats.autoVacuumMode);
    return {
      available: false,
      reason:
        `PRAGMA auto_vacuum = ${mode} on this file, so incremental reclaim is ` +
        'unavailable. Pages freed by the delete stay on the freelist and will ' +
        'be reused by future writes; the file will not shrink. This script ' +
        'will NOT fall back to VACUUM.',
      pagesReclaimed: 0,
    };
  }

  // Injection guard: a pragma argument cannot be bound, so the integer is
  // re-proved here immediately before it is interpolated into SQL text.
  if (
    !Number.isInteger(stepPages) ||
    stepPages < 1 ||
    stepPages > MAX_PAGES_PER_STEP
  ) {
    throw new Error(`Invalid reclaim step page count: ${String(stepPages)}`);
  }

  let reclaimed = 0;
  let before = stats.freelistCount;
  while (before > 0) {
    if (isInterrupted()) break;
    db.pragma(`incremental_vacuum(${stepPages})`);
    const after = readPageStats(db).freelistCount;
    const step = before - after;
    if (step <= 0) break;
    reclaimed += step;
    before = after;
    console.log(
      `[drain] reclaimed ${formatCount(reclaimed)} pages (${formatCount(
        before,
      )} still free)`,
    );
  }

  return {
    available: true,
    reason: 'PRAGMA auto_vacuum = INCREMENTAL',
    pagesReclaimed: reclaimed,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function reportStats(
  label: string,
  stats: QueueStats,
  pages: PageStats,
  bytes: number,
): void {
  console.log(`\n[drain] ${label}`);
  console.log(`  file size (db+wal+shm) : ${formatMegabytes(bytes)}`);
  console.log(`  observation_queue rows : ${formatCount(stats.total)}`);
  console.log(`    processed_at set     : ${formatCount(stats.processed)}`);
  console.log(
    `    processed_at NULL    : ${formatCount(stats.unprocessed)} (never touched)`,
  );
  console.log(
    `  page_count             : ${formatCount(pages.pageCount)} @ ${formatCount(pages.pageSize)} B`,
  );
  console.log(
    `  freelist_count         : ${formatCount(pages.freelistCount)} (${formatMegabytes(
      pages.freelistCount * pages.pageSize,
    )})`,
  );
  console.log(`  auto_vacuum            : ${pages.autoVacuumMode}`);
}

/**
 * The post-run invariant: a drain may only remove rows with `processed_at` set,
 * so the count of `processed_at IS NULL` rows must be identical before and
 * after. A difference means the delete predicate reached uncurated data, and
 * the run must end loudly rather than reporting success.
 */
export function assertUnprocessedUnchanged(
  before: number,
  after: number,
): void {
  if (before !== after) {
    throw new Error(
      `INVARIANT VIOLATED: unprocessed row count changed from ${before} to ${after}`,
    );
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);

  if (!fs.existsSync(options.dbPath)) {
    throw new Error(`Database not found: ${options.dbPath}`);
  }

  const cutoffMs = Date.now() - options.processedDays * MILLISECONDS_PER_DAY;

  console.log(`[drain] database    : ${options.dbPath}`);
  console.log(
    `[drain] cutoff      : processed_at < ${formatTimestamp(cutoffMs)} (${options.processedDays} days)`,
  );
  if (options.dryRun) {
    console.log(
      '[drain] mode        : DRY RUN — the only handle opened on the database is',
    );
    console.log(
      '[drain]               read-only. No DELETE, no backup, no pragma that writes,',
    );
    console.log(
      '[drain]               and the two per-file lock probes are SKIPPED, because',
    );
    console.log(
      '[drain]               both open the file in a way a read-only run must not.',
    );
    console.log(
      '[drain]               Only the lockfile and process checks run, and they only',
    );
    console.log('[drain]               read.');
  } else {
    console.log('[drain] mode        : DESTRUCTIVE');
  }

  // The install-wide checks run in both modes so the operator is told when the
  // figures are a live snapshot. The per-file probes run only on the
  // destructive path — see `collectLivenessFindings`.
  const { blocking, advisory } = collectLivenessFindings(
    options.dbPath,
    options.dryRun,
  );

  if (advisory.length > 0) {
    console.warn(
      `\n[drain] NOTE — a Ptah install is running, but ${options.dbPath}`,
    );
    console.warn(
      '[drain] is not this install’s live database, and it is not locked:',
    );
    for (const finding of advisory) {
      console.warn(`  - [${finding.kind}] ${finding.detail}`);
    }
  }

  if (blocking.length > 0) {
    if (!options.dryRun) {
      console.error('\n[drain] REFUSING TO RUN — the database is in use:');
      for (const finding of blocking) {
        console.error(`  - [${finding.kind}] ${finding.detail}`);
      }
      console.error(
        '\n[drain] Close Ptah, any Ptah CLI/TUI process and all VS Code windows, then retry.',
      );
      console.error(
        '[drain] A stale lockfile after a crash also trips this; delete it only after confirming no Ptah process is running.',
      );
      return 1;
    }
    console.warn('\n[drain] NOTE — the database is IN USE right now:');
    for (const finding of blocking) {
      console.warn(`  - [${finding.kind}] ${finding.detail}`);
    }
    console.warn(
      '[drain] The dry run continues because it opens the database read-only and',
    );
    console.warn(
      '[drain] changes nothing, but these figures are a live snapshot and will drift.',
    );
    console.warn(
      '[drain] The destructive path would have REFUSED to run in this state.',
    );
  }

  const db = openDatabase(options.dbPath, {
    readonly: options.dryRun,
    fileMustExist: true,
  });

  let interrupted = false;
  const onSignal = (): void => {
    if (interrupted) return;
    interrupted = true;
    console.warn(
      '\n[drain] interrupt received — finishing the current batch, then stopping. Re-run to resume.',
    );
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    const beforeQueue = readQueueStats(db, cutoffMs);
    const beforePages = readPageStats(db);
    const beforeBytes = fileSizeBytes(options.dbPath);
    reportStats('BEFORE', beforeQueue, beforePages, beforeBytes);
    console.log(
      `  processed_at range     : ${formatTimestamp(beforeQueue.oldestProcessedAt)} … ${formatTimestamp(beforeQueue.newestProcessedAt)}`,
    );
    console.log(
      `  ELIGIBLE to delete     : ${formatCount(beforeQueue.eligible)} rows, ~${formatMegabytes(
        beforeQueue.eligibleBytes,
      )} of payload text`,
    );
    console.log(
      `  RETAINED               : ${formatCount(
        beforeQueue.total - beforeQueue.eligible,
      )} rows (${formatCount(beforeQueue.unprocessed)} unprocessed + ${formatCount(
        beforeQueue.processed - beforeQueue.eligible,
      )} processed within the cutoff)`,
    );

    if (options.dryRun) {
      console.log(
        `\n[drain] DRY RUN — no write reached the database; the connection above was\n[drain] opened read-only. ${formatCount(
          beforeQueue.eligible,
        )} rows would be deleted in ${formatCount(
          Math.ceil(beforeQueue.eligible / options.batchSize),
        )} batches of ${formatCount(options.batchSize)}.`,
      );
      if (beforePages.autoVacuumMode === AUTO_VACUUM_INCREMENTAL) {
        console.log(
          `[drain] DRY RUN — incremental reclaim IS available; ${formatCount(
            beforePages.freelistCount,
          )} pages (${formatMegabytes(
            beforePages.freelistCount * beforePages.pageSize,
          )}) are already free before any delete.`,
        );
      } else {
        console.log(
          `[drain] DRY RUN — incremental reclaim is NOT available (auto_vacuum = ${beforePages.autoVacuumMode}); the file would not shrink.`,
        );
      }
      return 0;
    }

    if (options.force) {
      console.warn(
        '\n[drain] --force: skipping the backup at the operator\u2019s explicit request.',
      );
    } else {
      await createBackup(db, options.dbPath);
    }

    // TOCTOU: the checks above ran before a backup that takes minutes on a
    // 1.2 GB file. Re-run them here, with nothing between this point and the
    // first DELETE.
    const reblocking = recheckBeforeDelete(options.dbPath);
    if (reblocking.length > 0) {
      console.error(
        '\n[drain] REFUSING TO DELETE — the database came into use during the backup:',
      );
      for (const finding of reblocking) {
        console.error(`  - [${finding.kind}] ${finding.detail}`);
      }
      console.error(
        '[drain] No rows were deleted. The backup that was just taken is intact.',
      );
      return 1;
    }

    console.log('');
    const result = drainBatches(db, options, cutoffMs, () => interrupted);
    console.log(
      `[drain] deleted ${formatCount(result.deleted)} rows in ${formatCount(result.batches)} batches${
        result.interrupted ? ' (INTERRUPTED — re-run to resume)' : ''
      }`,
    );

    const reclaim = reclaimPages(
      db,
      options.reclaimStepPages,
      () => interrupted,
    );
    if (!reclaim.available) {
      console.warn(`[drain] page reclaim unavailable: ${reclaim.reason}`);
    } else {
      console.log(
        `[drain] reclaimed ${formatCount(reclaim.pagesReclaimed)} pages (${formatMegabytes(
          reclaim.pagesReclaimed * beforePages.pageSize,
        )})`,
      );
    }

    db.pragma('wal_checkpoint(TRUNCATE)');

    const afterQueue = readQueueStats(db, cutoffMs);
    const afterPages = readPageStats(db);
    const afterBytes = fileSizeBytes(options.dbPath);
    reportStats('AFTER', afterQueue, afterPages, afterBytes);
    console.log(
      `\n[drain] rows removed      : ${formatCount(beforeQueue.total - afterQueue.total)}`,
    );
    console.log(
      `[drain] unprocessed rows  : ${formatCount(beforeQueue.unprocessed)} before, ${formatCount(
        afterQueue.unprocessed,
      )} after (must be unchanged)`,
    );
    console.log(
      `[drain] file size         : ${formatMegabytes(beforeBytes)} → ${formatMegabytes(
        afterBytes,
      )} (freed ${formatMegabytes(beforeBytes - afterBytes)})`,
    );

    assertUnprocessedUnchanged(beforeQueue.unprocessed, afterQueue.unprocessed);
    return result.interrupted ? 2 : 0;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    db.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(
        `[drain] ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
}
