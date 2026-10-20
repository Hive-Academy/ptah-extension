import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { SqliteDatabase } from './sqlite-connection.service';

export const FIRST_DESTRUCTIVE_SKILL_PIPELINE_VERSION = 57;
export const SKILL_PIPELINE_ARCHIVE_DIR_PREFIX = 'pre-0057-';
const STALE_PARTIAL_ARCHIVE_MS = 60 * 60 * 1000;

const TABLES = [
  'skill_candidates',
  'skill_suggestions',
  'skill_synthesis_queue',
  'skill_synthesis_budget',
  'skill_invocations',
  'skill_synthesis_workspace_cursor',
  'skill_candidates_vec',
  'job_runs',
  'scheduled_jobs',
] as const;

const PIPELINE_JOB_IDS = [
  '@ptah/skills-drain-frequent',
  '@ptah/skills-drain-nightly',
  '@ptah/skills-drain-weekly',
  '@ptah/skills-backlog-cleanup',
] as const;

export interface SkillPipelineArchiveEntry {
  readonly table: (typeof TABLES)[number];
  readonly present: boolean;
  readonly file: string | null;
  readonly rows: number;
  readonly sha256: string | null;
}

export interface SkillPipelineArchiveReceipt {
  readonly format: 2;
  readonly archivePath: string;
  readonly tables: readonly SkillPipelineArchiveEntry[];
  /** Run-local maintenance result; omitted from receipt.json. */
  readonly maintenance?: {
    readonly reused: boolean;
    readonly pruned: number;
    readonly kept: number;
    readonly maintenanceError?: boolean;
  };
}

/** Export a fixed set of legacy pipeline data and verify the files from disk.
 * On Windows, POSIX modes are not enforced: archives inherit the per-user ACL
 * of the DB directory (normally in the user profile). The connection derives
 * this root from the DB path for that reason.
 */
export function archiveSkillPipeline(
  db: SqliteDatabase,
  archiveRoot = path.join(os.homedir(), '.ptah', 'backups', 'skill-pipeline'),
): SkillPipelineArchiveReceipt {
  fs.mkdirSync(archiveRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(archiveRoot, 0o700);
  const archivePath = fs.mkdtempSync(path.join(archiveRoot, SKILL_PIPELINE_ARCHIVE_DIR_PREFIX));
  fs.chmodSync(archivePath, 0o700);
  const entries: SkillPipelineArchiveEntry[] = [];

  for (const table of TABLES) {
    const exists = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table);
    if (exists === undefined) {
      entries.push({ table, present: false, file: null, rows: 0, sha256: null });
      continue;
    }
    const file = `${table}.jsonl`;
    const filePath = path.join(archivePath, file);
    const fd = fs.openSync(filePath, 'wx', 0o600);
    let rows = 0;
    try {
      const query = table === 'job_runs'
        ? 'SELECT * FROM job_runs WHERE job_id IN (?, ?, ?, ?)'
        : table === 'scheduled_jobs'
          ? 'SELECT * FROM scheduled_jobs WHERE id IN (?, ?, ?, ?)'
          // vec0 rowid is implicit; candidate embeddings refer to this key.
          : table === 'skill_candidates_vec'
            ? 'SELECT rowid AS rowid, * FROM "skill_candidates_vec"'
            : `SELECT * FROM "${table}"`;
      const statement = db.prepare(query);
      const values = table === 'job_runs' || table === 'scheduled_jobs'
        ? statement.iterate(...PIPELINE_JOB_IDS)
        : statement.iterate();
      for (const row of values) {
        if (!isRecord(row)) throw new Error(`Skill pipeline archive row is not an object: ${table}`);
        const encoded = Object.fromEntries(Object.entries(row).map(([key, value]) => [
          key,
          value instanceof Uint8Array ? { $base64: Buffer.from(value).toString('base64') }
            : typeof value === 'bigint' ? value.toString() : value,
        ]));
        const line = Buffer.from(`${JSON.stringify(encoded)}\n`);
        let offset = 0;
        while (offset < line.length) {
          const written = fs.writeSync(fd, line, offset, line.length - offset);
          if (written === 0) throw new Error('Skill pipeline archive write made no progress');
          offset += written;
        }
        rows++;
      }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    entries.push({ table, present: true, file, rows, sha256: inspectFile(filePath).sha256 });
  }

  const receipt: SkillPipelineArchiveReceipt = { format: 2, archivePath, tables: entries };
  const receiptPath = path.join(archivePath, 'receipt.json');
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  verifySkillPipelineArchive(receiptPath);
  let pruned = 0;
  let kept = 0;
  let newestOlder: SkillPipelineArchiveReceipt | null = null;
  let newestMtime = -Infinity;
  // A verified new archive already exists; maintenance must never block drop preflight.
  try {
    for (const name of fs.readdirSync(archiveRoot)) {
      if (!name.startsWith(SKILL_PIPELINE_ARCHIVE_DIR_PREFIX)) continue;
      const olderPath = path.join(archiveRoot, name);
      const stat = fs.lstatSync(olderPath);
      if (!stat.isDirectory() || olderPath === archivePath) continue;
      const olderReceiptPath = path.join(olderPath, 'receipt.json');
      try {
        fs.lstatSync(olderReceiptPath);
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
        if (Date.now() - stat.mtimeMs <= STALE_PARTIAL_ARCHIVE_MS) continue;
        fs.rmSync(olderPath, { recursive: true });
        pruned++;
        continue;
      }
      let older: SkillPipelineArchiveReceipt;
      try {
        older = verifySkillPipelineArchive(olderReceiptPath);
      } catch {
        // A receipt is present: old format, corruption, or transient I/O. Keep it.
        kept++;
        continue;
      }
      if (stat.mtimeMs > newestMtime) {
        newestOlder = older;
        newestMtime = stat.mtimeMs;
      }
    }
    if (newestOlder && newestOlder.tables.length === entries.length &&
      newestOlder.tables.every((entry, index) => {
        const current = entries[index];
        return current !== undefined && entry.present === current.present &&
          entry.rows === current.rows && entry.sha256 === current.sha256;
      })) {
      // The older archive is verified and identical, so it stays the receipt even
      // if this delete fails part-way and leaves the new copy incomplete.
      let maintenanceError = false;
      try {
        fs.rmSync(archivePath, { recursive: true });
      } catch {
        maintenanceError = true;
      }
      return {
        ...newestOlder,
        maintenance: { reused: true, pruned, kept, ...(maintenanceError ? { maintenanceError } : {}) },
      };
    }
  } catch {
    return { ...receipt, maintenance: { reused: false, pruned, kept, maintenanceError: true } };
  }
  return pruned > 0 || kept > 0 ? { ...receipt, maintenance: { reused: false, pruned, kept } } : receipt;
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Decode the explicit BLOB envelope used by format-2 JSONL rows. */
export function decodeSkillPipelineArchiveRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    isBase64Envelope(value) ? Buffer.from(value.$base64, 'base64') : value,
  ]));
}

function isBase64Envelope(value: unknown): value is { $base64: string } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === 1 && '$base64' in value && typeof value.$base64 === 'string' &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.$base64);
}

/** Re-read the receipt and every archived file before destructive migration. */
export function verifySkillPipelineArchive(receiptPath: string): SkillPipelineArchiveReceipt {
  const value: unknown = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (!isReceipt(value) || path.resolve(value.archivePath) !== path.dirname(path.resolve(receiptPath))) {
    throw new Error('Skill pipeline archive receipt is invalid');
  }
  for (let index = 0; index < TABLES.length; index++) {
    const entry = value.tables[index];
    if (entry === undefined || entry.table !== TABLES[index]) throw new Error('Skill pipeline archive table list is invalid');
    if (!entry.present) {
      if (entry.file !== null || entry.sha256 !== null || entry.rows !== 0) throw new Error(`Invalid absent table receipt: ${entry.table}`);
      continue;
    }
    if (entry.file !== `${entry.table}.jsonl` || !entry.sha256 || !Number.isSafeInteger(entry.rows) || entry.rows < 0) {
      throw new Error(`Invalid archive receipt: ${entry.table}`);
    }
    const inspected = inspectFile(path.join(value.archivePath, entry.file));
    if (!inspected.endsWithNewline || inspected.rows !== entry.rows || inspected.sha256 !== entry.sha256) {
      throw new Error(`Skill pipeline archive verification failed: ${entry.table}`);
    }
  }
  return value;
}

function inspectFile(filePath: string): { sha256: string; rows: number; endsWithNewline: boolean } {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const fd = fs.openSync(filePath, 'r');
  let rows = 0;
  let lastByte = 10;
  let bytes = 0;
  try {
    let length: number;
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, length));
      for (let index = 0; index < length; index++) {
        if (buffer[index] === 10) rows++;
      }
      lastByte = buffer.readUInt8(length - 1);
      bytes += length;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { sha256: hash.digest('hex'), rows, endsWithNewline: bytes === 0 || lastByte === 10 };
}

function isReceipt(value: unknown): value is SkillPipelineArchiveReceipt {
  return typeof value === 'object' && value !== null &&
    'format' in value && value.format === 2 &&
    'archivePath' in value && typeof value.archivePath === 'string' &&
    'tables' in value && Array.isArray(value.tables) && value.tables.length === TABLES.length &&
    value.tables.every((entry: unknown) => typeof entry === 'object' && entry !== null &&
      'table' in entry && TABLES.some((table) => table === entry.table) &&
      'present' in entry && typeof entry.present === 'boolean' &&
      'file' in entry && (entry.file === null || typeof entry.file === 'string') &&
      'rows' in entry && typeof entry.rows === 'number' &&
      'sha256' in entry && (entry.sha256 === null || typeof entry.sha256 === 'string'));
}
