import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { SqliteDatabase } from './sqlite-connection.service';

export const FIRST_DESTRUCTIVE_SKILL_PIPELINE_VERSION = 57;
export const SKILL_PIPELINE_ARCHIVE_DIR_PREFIX = 'pre-0057-';

const TABLES = [
  'skill_candidates',
  'skill_suggestions',
  'skill_synthesis_queue',
  'skill_synthesis_budget',
  'skill_invocations',
  'skill_synthesis_workspace_cursor',
  'skill_candidates_vec',
  'job_runs',
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
  readonly archivePath: string;
  readonly tables: readonly SkillPipelineArchiveEntry[];
}

/** Export a fixed set of legacy pipeline data and verify the files from disk. */
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
        : `SELECT * FROM "${table}"`;
      const statement = db.prepare(query);
      const values = table === 'job_runs'
        ? statement.iterate(...PIPELINE_JOB_IDS)
        : statement.iterate();
      for (const row of values) {
        const line = Buffer.from(`${JSON.stringify(row, (_key, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value)}\n`);
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

  const receipt: SkillPipelineArchiveReceipt = { archivePath, tables: entries };
  const receiptPath = path.join(archivePath, 'receipt.json');
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  verifySkillPipelineArchive(receiptPath);
  return receipt;
}

/** Re-read the receipt and every archived file before destructive migration. */
export function verifySkillPipelineArchive(receiptPath: string): SkillPipelineArchiveReceipt {
  const value: unknown = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (!isReceipt(value) || path.resolve(value.archivePath) !== path.dirname(path.resolve(receiptPath))) {
    throw new Error('Skill pipeline archive receipt is invalid');
  }
  for (let index = 0; index < TABLES.length; index++) {
    const entry = value.tables[index];
    if (entry.table !== TABLES[index]) throw new Error('Skill pipeline archive table list is invalid');
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
      lastByte = buffer[length - 1];
      bytes += length;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { sha256: hash.digest('hex'), rows, endsWithNewline: bytes === 0 || lastByte === 10 };
}

function isReceipt(value: unknown): value is SkillPipelineArchiveReceipt {
  return typeof value === 'object' && value !== null &&
    'archivePath' in value && typeof value.archivePath === 'string' &&
    'tables' in value && Array.isArray(value.tables) && value.tables.length === TABLES.length &&
    value.tables.every((entry: unknown) => typeof entry === 'object' && entry !== null &&
      'table' in entry && 'present' in entry && 'file' in entry && 'rows' in entry && 'sha256' in entry);
}
