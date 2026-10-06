import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FROZEN_CANDIDATES_NAME,
  assertSafeBenchDataDir,
  compareCodePoints,
  type BenchDataDirGuardOptions,
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
  snapshotSha256: string;
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
  benchDataDir: string;
  snapshotFile?: string;
  candidatesName?: string;
  /** `null` skips the frozen-hash pin (specs pass synthetic snapshots). */
  expectedSnapshotSha256?: string | null;
  guard?: BenchDataDirGuardOptions;
}

export interface CandidateRowDiffResult {
  diff: CandidateRowDiff;
  /** Where the full diff (it lists slugs, which are private) was written. */
  reportPath: string;
}

/** Reads every `skill_candidates` row (id, name, status, body_path). */
export function readCandidateRows(db: ReadonlySqlite): CandidateRow[] {
  return db
    .prepare(
      'SELECT id, name, status, body_path FROM skill_candidates ORDER BY name',
    )
    .all()
    .map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        id: String(row['id']),
        name: String(row['name']),
        status: String(row['status']),
        bodyPath: String(row['body_path']),
      };
    });
}

/** Pure diff of the copy's dirs against the candidate rows. */
export function diffCandidateRows(
  rows: readonly CandidateRow[],
  dirs: ReadonlyMap<string, boolean>,
  meta: { snapshotSha256: string; copyDir: string },
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
    snapshotSha256: meta.snapshotSha256,
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
 * Diffs the frozen candidate copy against the snapshot's `skill_candidates`
 * rows and writes the full report under `<benchDataDir>/reports/` only.
 */
export async function runCandidateRowDiff(
  options: CandidateRowDiffOptions,
): Promise<CandidateRowDiffResult> {
  const benchDataDir = assertSafeBenchDataDir(
    options.benchDataDir,
    options.guard,
  );
  const snapshotFile = options.snapshotFile ?? FROZEN_SNAPSHOT_FILE;
  const candidatesName = options.candidatesName ?? FROZEN_CANDIDATES_NAME;
  const snapshotPath = join(benchDataDir, 'snapshots', snapshotFile);
  const copyDir = join(benchDataDir, 'snapshots', candidatesName);
  const expected =
    options.expectedSnapshotSha256 === undefined
      ? FROZEN_SNAPSHOT_SHA256
      : options.expectedSnapshotSha256;

  const dirs = await readCandidateDirs(copyDir);
  const { result: rows, sha256: snapshotSha256 } = await withReadonlySnapshot(
    snapshotPath,
    readCandidateRows,
    expected,
  );
  const diff = diffCandidateRows(rows, dirs, { snapshotSha256, copyDir });
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
