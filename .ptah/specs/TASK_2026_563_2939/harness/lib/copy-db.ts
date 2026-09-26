/**
 * Working-copy helper for the TASK_2026_563_2939 measurement harness.
 *
 * Evidence tooling, not product code. Every measurement runs on a working copy
 * derived from the pristine snapshot with the SQLite online backup API — never
 * a plain file copy, never the live database.
 *
 * Refusals (each one throws before any file is opened):
 *  - a target anywhere under `%USERPROFILE%\.ptah\state` (the live app DB);
 *  - a target whose file name starts with `ptah` (case-insensitive);
 *  - a target outside `%TEMP%\mqs-563-eval\`;
 *  - a target (or its `-wal`/`-shm`) that already exists (fail-if-exists);
 *  - a source that is not the verified snapshot, or whose SHA-256 differs.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const SNAPSHOT_PATH = path.join(
  os.tmpdir(),
  'mqs-563-snapshot',
  'memcopy-563.sqlite',
);
export const SNAPSHOT_SHA256 =
  '2661275c4c120fd7554953cfae60ec6cc5f82c726ef0ebe925adf5b2e33b7810';
export const EVAL_DIR = path.join(os.tmpdir(), 'mqs-563-eval');
const LIVE_STATE_DIR = path.join(os.homedir(), '.ptah', 'state');

export interface WorkingCopyRecord {
  readonly source: string;
  readonly sourceSha256: string;
  readonly target: string;
  readonly method: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly totalPages: number;
  readonly bytes: number;
  readonly integrityCheck: string;
  readonly integrityMs: number;
}

interface BackupCapableDb {
  backup(
    destination: string,
    options?: {
      progress?: (info: {
        totalPages: number;
        remainingPages: number;
      }) => number;
    },
  ): Promise<{ totalPages: number; remainingPages: number }>;
  prepare(sql: string): { get(): unknown; all(): unknown[] };
  close(): void;
}

type BetterSqlite3Ctor = new (
  file: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => BackupCapableDb;

function normalise(p: string): string {
  return path
    .resolve(p)
    .replace(/[\\/]+$/, '')
    .toLowerCase();
}

function isInside(child: string, parent: string): boolean {
  const c = normalise(child);
  const p = normalise(parent);
  return c === p || c.startsWith(p + path.sep);
}

/** Throws unless `target` is a safe, fresh working-copy path. */
export function assertSafeTarget(target: string): string {
  const resolved = path.resolve(target);
  if (isInside(resolved, LIVE_STATE_DIR)) {
    throw new Error(`refusing a target under the live state dir: ${resolved}`);
  }
  if (path.basename(resolved).toLowerCase().startsWith('ptah')) {
    throw new Error(`refusing a target named ptah*: ${resolved}`);
  }
  if (
    !isInside(resolved, EVAL_DIR) ||
    normalise(resolved) === normalise(EVAL_DIR)
  ) {
    throw new Error(`refusing a target outside ${EVAL_DIR}: ${resolved}`);
  }
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    if (fs.existsSync(resolved + suffix)) {
      throw new Error(
        `refusing to overwrite an existing file: ${resolved}${suffix}`,
      );
    }
  }
  return resolved;
}

/** Streaming SHA-256 of a file. */
export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Re-verify the pristine snapshot. Throws (stop) on mismatch. */
export async function verifySnapshot(): Promise<string> {
  if (isInside(SNAPSHOT_PATH, LIVE_STATE_DIR)) {
    throw new Error('snapshot path resolves under the live state dir');
  }
  const actual = await sha256File(SNAPSHOT_PATH);
  if (actual !== SNAPSHOT_SHA256) {
    throw new Error(
      `snapshot SHA-256 mismatch: expected ${SNAPSHOT_SHA256}, got ${actual}. STOP.`,
    );
  }
  return actual;
}

/**
 * Derive a working copy from the verified snapshot via the online backup API
 * (better-sqlite3 `Database#backup`, source opened `readonly` +
 * `fileMustExist`). The target is reserved with an exclusive create (`wx`)
 * before the backup writes it, so two scripts can never share a copy.
 */
export async function makeWorkingCopy(
  fileName: string,
): Promise<WorkingCopyRecord> {
  const target = assertSafeTarget(path.join(EVAL_DIR, fileName));
  const sourceSha256 = await verifySnapshot();
  fs.mkdirSync(EVAL_DIR, { recursive: true });
  // Exclusive reservation: throws EEXIST if another process created it first.
  fs.closeSync(fs.openSync(target, 'wx'));

  const Database = require('better-sqlite3') as BetterSqlite3Ctor;
  const started = new Date();
  const t0 = performance.now();
  const src = new Database(SNAPSHOT_PATH, {
    readonly: true,
    fileMustExist: true,
  });
  let totalPages = 0;
  try {
    // One step: returning a huge page count copies everything in one read
    // transaction, as take-snapshot.mjs did with node:sqlite.
    const result = await src.backup(target, { progress: () => 2_000_000_000 });
    totalPages = result.totalPages;
  } finally {
    src.close();
  }
  const durationMs = performance.now() - t0;
  const finished = new Date();

  const copy = new Database(target, { fileMustExist: true });
  const i0 = performance.now();
  let integrityCheck: string;
  try {
    const rows = copy.prepare('PRAGMA integrity_check').all() as Array<{
      integrity_check: string;
    }>;
    integrityCheck = rows.map((r) => r.integrity_check).join('; ');
  } finally {
    copy.close();
  }
  const integrityMs = performance.now() - i0;

  return {
    source: SNAPSHOT_PATH,
    sourceSha256,
    target,
    method:
      'SQLite online backup API: better-sqlite3 Database#backup from a readonly+fileMustExist source handle, single step (progress returns 2e9 pages), exclusive-create (wx) fail-if-exists target',
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: Math.round(durationMs),
    totalPages,
    bytes: fs.statSync(target).size,
    integrityCheck,
    integrityMs: Math.round(integrityMs),
  };
}
