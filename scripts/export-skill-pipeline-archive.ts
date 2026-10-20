/** Dry-run OP-1 archive from a private, quiescent database copy. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  archiveSkillPipeline, verifySkillPipelineArchive, type SkillPipelineArchiveReceipt,
} from '../libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive';
import type { SqliteDatabase } from '../libs/backend/persistence-sqlite/src/lib/sqlite-connection.service';

type DatabaseConstructor = new (file: string, options: { readonly: boolean; fileMustExist: boolean }) => SqliteDatabase;

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export interface ExportResult { receipt: SkillPipelineArchiveReceipt; copyPath: string }

export function exportArchive(source: string, outputRoot?: string): ExportResult {
  const sourcePath = path.resolve(source);
  if (!fs.statSync(sourcePath).isFile()) throw new Error('Source database is not a regular file');
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (fs.existsSync(sourcePath + suffix)) throw new Error(`Source has a SQLite sidecar (${suffix}); close the host and checkpoint first`);
  }
  const before = fs.statSync(sourcePath);
  const root = outputRoot ? path.resolve(outputRoot) : fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-op1-'));
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  const copyPath = path.join(root, 'source-copy.sqlite');
  fs.copyFileSync(sourcePath, copyPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(copyPath, 0o600);
  const beforeHash = sha256(sourcePath);
  if (sha256(copyPath) !== beforeHash) throw new Error('Database copy differs from source');
  const Database = require('better-sqlite3') as DatabaseConstructor;
  const db = new Database(copyPath, { readonly: true, fileMustExist: true });
  let receipt: SkillPipelineArchiveReceipt;
  try {
    const vec = db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'skill_candidates_vec'").get();
    if (vec !== undefined) {
      const sqliteVec = require('sqlite-vec') as { getLoadablePath: () => string };
      if (!db.loadExtension) throw new Error('sqlite-vec cannot load for archive export');
      db.loadExtension(sqliteVec.getLoadablePath());
    }
    receipt = archiveSkillPipeline(db, root);
    verifySkillPipelineArchive(path.join(receipt.archivePath, 'receipt.json'));
  } finally {
    db.close();
  }
  const after = fs.statSync(sourcePath);
  if (before.mtimeMs !== after.mtimeMs || before.size !== after.size || sha256(sourcePath) !== beforeHash) {
    throw new Error('Source database changed during export');
  }
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (fs.existsSync(sourcePath + suffix)) throw new Error(`Source SQLite sidecar appeared during export (${suffix})`);
  }
  return { receipt, copyPath };
}

export function main(args = process.argv.slice(2)): void {
  const get = (name: string): string | undefined => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const source = get('--db');
  if (!source) throw new Error('--db is required');
  const result = exportArchive(source, get('--output-root'));
  console.log(JSON.stringify({ archivePath: result.receipt.archivePath, copyPath: result.copyPath, tables: result.receipt.tables }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error: unknown) { console.error(error); process.exitCode = 1; }
}
