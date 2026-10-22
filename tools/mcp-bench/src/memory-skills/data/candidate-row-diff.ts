import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import {
  FROZEN_CANDIDATES_NAME,
  compareCodePoints,
  resolveEntryBenchDataDir,
  type BenchDataRules,
} from './verify-candidate-manifest';

/** Snapshot taken on 2026-10-06 (context.md, Status). */
export const FROZEN_SNAPSHOT_FILE = 'ptah-20261006-pre-retention.sqlite';
export const FROZEN_SNAPSHOT_SHA256 =
  '82cd16ac39b60699c241286eda2db59b25be70c6aa85480db0be8ae7b77d575a';

/** The subset of the better-sqlite3 surface the bench reads with. */
export interface ReadonlySqlite {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
}

type SqliteConstructor = new (
  file: string,
  options: { readonly: boolean; fileMustExist: boolean },
) => ReadonlySqlite;

export interface SnapshotReadResult<T> {
  result: T;
  sha256: string;
}

const SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const;

/**
 * Opens a snapshot `readonly` + `fileMustExist`, runs `read`, closes it and
 * fails when the file hash changed or a sidecar appeared (R12). The snapshot is
 * private data: callers keep anything they derive from it in the bench data dir.
 */
export async function withReadonlySnapshot<T>(
  snapshotPath: string,
  read: (db: ReadonlySqlite) => T,
  expectedSha256: string | null = null,
): Promise<SnapshotReadResult<T>> {
  const sidecarsBefore = SIDECAR_SUFFIXES.filter((s) =>
    existsSync(snapshotPath + s),
  );
  const before = await sha256File(snapshotPath);
  if (expectedSha256 !== null && before !== expectedSha256) {
    throw new Error(
      `Snapshot sha256 ${before} is not the frozen value ${expectedSha256}: ${snapshotPath}`,
    );
  }
  // The product loads better-sqlite3 the same lazy way (sqlite-connection.service.ts).
  const Database = require('better-sqlite3') as SqliteConstructor;
  const db = new Database(snapshotPath, {
    readonly: true,
    fileMustExist: true,
  });
  let result: T;
  try {
    result = read(db);
  } finally {
    db.close();
  }
  const after = await sha256File(snapshotPath);
  if (after !== before) {
    throw new Error(
      `Snapshot changed while it was read: ${before} -> ${after} (${snapshotPath})`,
    );
  }
  const newSidecars = SIDECAR_SUFFIXES.filter(
    (s) => existsSync(snapshotPath + s) && !sidecarsBefore.includes(s),
  );
  if (newSidecars.length > 0) {
    throw new Error(
      `Reading the snapshot created sidecar file(s) ${newSidecars.join(', ')}: ${snapshotPath}`,
    );
  }
  return { result, sha256: before };
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolvePromise(hash.digest('hex')));
  });
}

export interface CandidateRow {
  id: string;
  name: string;
  status: string;
  bodyPath: string;
}

export interface CandidateRowDiff {
  archiveSha256: string;
  copyDir: string;
  rows: number;
  dirs: number;
  matched: number;
  /** Rows whose body dir is absent from the copy (missing bodies), by status. */
  rowsWithoutDir: { id: string; name: string; status: string }[];
  rowsWithoutDirByStatus: Record<string, number>;
  /** Dirs in the copy with no `skill_candidates` row. */
  dirsWithoutRow: string[];
  /** Rows whose dir exists but holds no SKILL.md. */
  dirsWithoutSkillMd: string[];
  /** Rows whose `body_path` does not end in `<name>/SKILL.md`. */
  bodyPathMismatches: { id: string; name: string }[];
}

export interface CandidateRowDiffOptions {
  /** Bench data root. Default: 619's `resolveBenchDataDir()`. */
  benchDataDir?: string;
  archiveReceiptFile?: string;
  candidatesName?: string;
  /** Optional pin for the archived candidate JSONL. */
  expectedArchiveSha256?: string;
  /** Overrides for 619's bench-data rules (specs only). */
  benchDataRules?: BenchDataRules;
}

export interface CandidateRowDiffResult {
  diff: CandidateRowDiff;
  /** Where the full diff (it lists slugs, which are private) was written. */
  reportPath: string;
}

const archiveReceiptSchema = z.object({
  format: z.literal(2),
  archivePath: z.string(),
  tables: z.array(z.object({
    table: z.string(),
    present: z.boolean(),
    file: z.string().nullable(),
    rows: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  })),
});
export const ARCHIVE_TABLES = [
  'skill_candidates', 'skill_suggestions', 'skill_synthesis_queue',
  'skill_synthesis_budget', 'skill_invocations',
  'skill_synthesis_workspace_cursor', 'skill_candidates_vec', 'job_runs', 'scheduled_jobs',
] as const;

/** Read a batch-15 JSONL table only after checking its receipt and digest. */
export async function readArchiveTable(
  receiptPath: string,
  table: string,
): Promise<{ rows: Record<string, unknown>[]; sha256: string }> {
  const receipt = archiveReceiptSchema.parse(JSON.parse(await readFile(receiptPath, 'utf8')));
  if (resolve(receipt.archivePath) !== dirname(resolve(receiptPath))) {
    throw new Error('Archive receipt path does not match its directory');
  }
  if (receipt.tables.length !== ARCHIVE_TABLES.length ||
    receipt.tables.some((entry, index) => entry.table !== ARCHIVE_TABLES[index] ||
      (!entry.present && (entry.file !== null || entry.rows !== 0 || entry.sha256 !== null)))) {
    throw new Error('Archive receipt table list is invalid');
  }
  const entry = receipt.tables.find((item) => item.table === table);
  if (!entry?.present || entry.file !== `${table}.jsonl` || entry.sha256 === null) {
    throw new Error(`Archive table is absent or invalid: ${table}`);
  }
  const filePath = join(receipt.archivePath, entry.file);
  const contents = await readFile(filePath, 'utf8');
  const digest = createHash('sha256').update(contents).digest('hex');
  if (digest !== entry.sha256 || (contents.length > 0 && !contents.endsWith('\n'))) {
    throw new Error(`Archive verification failed: ${table}`);
  }
  const lines = contents.length === 0 ? [] : contents.trimEnd().split('\n');
  if (lines.length !== entry.rows) throw new Error(`Archive row count changed: ${table}`);
  return { rows: lines.map((line) => decodeArchiveRow(z.record(z.string(), z.unknown()).parse(JSON.parse(line)))), sha256: digest };
}

const candidateArchiveRowSchema = z.object({
  id: z.string(), name: z.string(), status: z.string(), body_path: z.string(),
});

export async function readCandidateRows(receiptPath: string): Promise<{ rows: CandidateRow[]; sha256: string }> {
  const archive = await readArchiveTable(receiptPath, 'skill_candidates');
  return {
    sha256: archive.sha256,
    rows: archive.rows.map((raw) => {
      const row = candidateArchiveRowSchema.parse(raw);
      return { id: row.id, name: row.name, status: row.status, bodyPath: row.body_path };
    }).sort((a, b) => compareCodePoints(a.name, b.name)),
  };
}

/** Pure diff of the copy's dirs against the candidate rows. */
export function diffCandidateRows(
  rows: readonly CandidateRow[],
  dirs: ReadonlyMap<string, boolean>,
  meta: { archiveSha256: string; copyDir: string },
): CandidateRowDiff {
  const rowNames = new Set(rows.map((r) => r.name));
  const rowsWithoutDir: CandidateRowDiff['rowsWithoutDir'] = [];
  const rowsWithoutDirByStatus: Record<string, number> = {};
  const dirsWithoutSkillMd: string[] = [];
  const bodyPathMismatches: CandidateRowDiff['bodyPathMismatches'] = [];
  let matched = 0;
  for (const row of rows) {
    const hasSkillMd = dirs.get(row.name);
    if (hasSkillMd === undefined) {
      rowsWithoutDir.push({ id: row.id, name: row.name, status: row.status });
      rowsWithoutDirByStatus[row.status] =
        (rowsWithoutDirByStatus[row.status] ?? 0) + 1;
    } else if (!hasSkillMd) {
      dirsWithoutSkillMd.push(row.name);
    } else {
      matched += 1;
    }
    const normalised = row.bodyPath.replace(/\\/g, '/');
    if (!normalised.endsWith(`/${row.name}/SKILL.md`)) {
      bodyPathMismatches.push({ id: row.id, name: row.name });
    }
  }
  const dirsWithoutRow = [...dirs.keys()]
    .filter((d) => !rowNames.has(d))
    .sort(compareCodePoints);
  return {
    archiveSha256: meta.archiveSha256,
    copyDir: meta.copyDir,
    rows: rows.length,
    dirs: dirs.size,
    matched,
    rowsWithoutDir,
    rowsWithoutDirByStatus,
    dirsWithoutRow,
    dirsWithoutSkillMd,
    bodyPathMismatches,
  };
}

/**
 * Diffs the frozen candidate copy against archived `skill_candidates`
 * rows and writes the full report under `<benchDataDir>/reports/` only.
 */
export async function runCandidateRowDiff(
  options: CandidateRowDiffOptions,
): Promise<CandidateRowDiffResult> {
  const benchDataDir = resolveEntryBenchDataDir(
    options.benchDataDir,
    options.benchDataRules,
  );
  const archiveReceiptFile = options.archiveReceiptFile ?? 'pre-0057/receipt.json';
  const candidatesName = options.candidatesName ?? FROZEN_CANDIDATES_NAME;
  const receiptPath = join(benchDataDir, 'snapshots', archiveReceiptFile);
  const copyDir = join(benchDataDir, 'snapshots', candidatesName);

  const dirs = await readCandidateDirs(copyDir);
  const { rows, sha256: archiveSha256 } = await readCandidateRows(receiptPath);
  if (options.expectedArchiveSha256 !== undefined && archiveSha256 !== options.expectedArchiveSha256) {
    throw new Error('Archive sha256 is not the pinned value');
  }
  const diff = diffCandidateRows(rows, dirs, { archiveSha256, copyDir });
  const reportDir = join(benchDataDir, 'reports');
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(
    reportDir,
    `candidate-row-diff.${candidatesName}.json`,
  );
  await writeFile(reportPath, `${JSON.stringify(diff, null, 2)}\n`, 'utf8');
  return { diff, reportPath };
}

/** Top-level dirs of the copy mapped to whether each holds a SKILL.md. */
async function readCandidateDirs(
  copyDir: string,
): Promise<Map<string, boolean>> {
  const entries = await readdir(copyDir, { withFileTypes: true });
  const dirs = new Map<string, boolean>();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    dirs.set(entry.name, existsSync(join(copyDir, entry.name, 'SKILL.md')));
  }
  return dirs;
}

/**
 * Decode the `{ "$base64": ... }` BLOB envelope of a format-2 archive row
 * (written by persistence-sqlite `skill-pipeline-archive.ts`). Kept local so
 * this reader does not load the persistence DI barrel.
 */
function decodeArchiveRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      isBase64Envelope(value) ? Buffer.from(value.$base64, 'base64') : value,
    ]),
  );
}

function isBase64Envelope(value: unknown): value is { $base64: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    '$base64' in value &&
    typeof value.$base64 === 'string' &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.$base64)
  );
}
