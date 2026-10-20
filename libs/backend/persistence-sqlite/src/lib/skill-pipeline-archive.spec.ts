import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SqliteDatabase } from './sqlite-connection.service';
import {
  archiveSkillPipeline,
  decodeSkillPipelineArchiveRow,
  FIRST_DESTRUCTIVE_SKILL_PIPELINE_VERSION,
  SKILL_PIPELINE_ARCHIVE_DIR_PREFIX,
  verifySkillPipelineArchive,
} from './skill-pipeline-archive';
import { SqliteMigrationRunner } from './migration-runner';
import { createMockLogger } from './testing/mock-logger';

let Database: (new (file: string) => SqliteDatabase) | undefined;
try {
  const NativeDatabase = require('better-sqlite3') as new (file: string) => SqliteDatabase;
  const probe = new NativeDatabase(':memory:');
  probe.close();
  Database = NativeDatabase;
} catch {
  Database = undefined;
}

const maybe = Database ? describe : describe.skip;

maybe('skill pipeline archive', () => {
  let root: string;
  let db: SqliteDatabase;

  beforeEach(() => {
    if (!Database) throw new Error('better-sqlite3 unavailable');
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-archive-test-'));
    db = new Database(':memory:');
    db.exec('CREATE TABLE skill_candidates (id TEXT PRIMARY KEY, payload BLOB)');
    db.exec('CREATE TABLE job_runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL)');
    db.exec('CREATE TABLE scheduled_jobs (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    db.prepare('INSERT INTO skill_candidates (id, payload) VALUES (?, ?)')
      .run('candidate-1', Buffer.from([1, 2, 3]));
    db.prepare('INSERT INTO job_runs (id, job_id) VALUES (?, ?)')
      .run('pipeline', '@ptah/skills-drain-nightly');
    db.prepare('INSERT INTO job_runs (id, job_id) VALUES (?, ?)')
      .run('unrelated', '@ptah/other');
    db.prepare('INSERT INTO scheduled_jobs (id, name) VALUES (?, ?)')
      .run('@ptah/skills-drain-nightly', 'pipeline');
    db.prepare('INSERT INTO scheduled_jobs (id, name) VALUES (?, ?)')
      .run('@ptah/other', 'unrelated');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('records absent tables and verifies only pipeline job rows', () => {
    const receipt = archiveSkillPipeline(db, root);
    expect(FIRST_DESTRUCTIVE_SKILL_PIPELINE_VERSION).toBe(57);
    expect(receipt.format).toBe(2);
    expect(receipt.tables).toHaveLength(9);
    expect(path.basename(receipt.archivePath)).toMatch(
      new RegExp(`^${SKILL_PIPELINE_ARCHIVE_DIR_PREFIX}`),
    );
    expect(verifySkillPipelineArchive(path.join(receipt.archivePath, 'receipt.json'))).toEqual(receipt);
    expect(receipt.tables.find((entry) => entry.table === 'skill_candidates')).toMatchObject({ present: true, rows: 1 });
    expect(receipt.tables.find((entry) => entry.table === 'skill_candidates_vec')).toMatchObject({ present: false, rows: 0 });
    expect(receipt.tables.find((entry) => entry.table === 'job_runs')).toMatchObject({ present: true, rows: 1 });
    const archivedJobs = fs.readFileSync(path.join(receipt.archivePath, 'job_runs.jsonl'), 'utf8');
    expect(archivedJobs).toContain('pipeline');
    expect(archivedJobs).not.toContain('unrelated');
    expect(receipt.tables.find((entry) => entry.table === 'scheduled_jobs')).toMatchObject({ present: true, rows: 1 });
    const scheduled = fs.readFileSync(path.join(receipt.archivePath, 'scheduled_jobs.jsonl'), 'utf8');
    expect(scheduled).toContain('pipeline');
    expect(scheduled).not.toContain('unrelated');
    const candidate = JSON.parse(fs.readFileSync(path.join(receipt.archivePath, 'skill_candidates.jsonl'), 'utf8')) as Record<string, unknown>;
    expect(candidate.payload).toEqual({ $base64: 'AQID' });
    expect(decodeSkillPipelineArchiveRow(candidate).payload).toEqual(Buffer.from([1, 2, 3]));
    if (process.platform !== 'win32') {
      expect(fs.statSync(receipt.archivePath).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(receipt.archivePath, 'receipt.json')).mode & 0o777).toBe(0o600);
    }
  });

  it('rejects an altered archive file', () => {
    const receipt = archiveSkillPipeline(db, root);
    fs.appendFileSync(path.join(receipt.archivePath, 'skill_candidates.jsonl'), '{}\n');
    expect(() => verifySkillPipelineArchive(path.join(receipt.archivePath, 'receipt.json')))
      .toThrow('verification failed');
  });

  it('preserves implicit vector rowids and embedding bytes', () => {
    db.exec('CREATE TABLE skill_candidates_vec (embedding BLOB)');
    const insert = db.prepare('INSERT INTO skill_candidates_vec (rowid, embedding) VALUES (?, ?)');
    insert.run(7, Buffer.from([0, 1, 255]));
    insert.run(42, Buffer.from([10, 20, 30, 40]));

    const receipt = archiveSkillPipeline(db, root);
    const lines = fs.readFileSync(path.join(receipt.archivePath, 'skill_candidates_vec.jsonl'), 'utf8')
      .trimEnd().split('\n');
    const rows = lines.map((line) => decodeSkillPipelineArchiveRow(JSON.parse(line) as Record<string, unknown>));
    expect(rows).toHaveLength(2);
    expect(rows[0].rowid).toBe(7);
    expect(rows[0].embedding).toEqual(Buffer.from([0, 1, 255]));
    expect(rows[1].rowid).toBe(42);
    expect(rows[1].embedding).toEqual(Buffer.from([10, 20, 30, 40]));
  });

  it('reuses identical verified archives and prunes incomplete older directories', () => {
    const first = archiveSkillPipeline(db, root);
    const partial = fs.mkdtempSync(path.join(root, SKILL_PIPELINE_ARCHIVE_DIR_PREFIX));
    fs.writeFileSync(path.join(partial, 'skill_candidates.jsonl'), 'partial');
    const staleTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(partial, staleTime, staleTime);
    const second = archiveSkillPipeline(db, root);
    expect(second.archivePath).toBe(first.archivePath);
    expect(second.maintenance).toEqual({ reused: true, pruned: 1, kept: 0 });
    expect(fs.existsSync(partial)).toBe(false);
    expect(fs.readdirSync(root).filter((name) => name.startsWith(SKILL_PIPELINE_ARCHIVE_DIR_PREFIX))).toHaveLength(1);
  });

  it('leaves a fresh receipt-less archive for an in-flight writer', () => {
    const partial = fs.mkdtempSync(path.join(root, SKILL_PIPELINE_ARCHIVE_DIR_PREFIX));
    fs.writeFileSync(path.join(partial, 'skill_candidates.jsonl'), 'partial');
    const receipt = archiveSkillPipeline(db, root);
    expect(fs.existsSync(partial)).toBe(true);
    expect(receipt.maintenance?.pruned ?? 0).toBe(0);
    expect(receipt.maintenance?.kept ?? 0).toBe(0);
  });

  it('keeps older directories with a present but invalid or format-1 receipt', () => {
    const legacy = fs.mkdtempSync(path.join(root, SKILL_PIPELINE_ARCHIVE_DIR_PREFIX));
    fs.writeFileSync(path.join(legacy, 'receipt.json'), JSON.stringify({ archivePath: legacy, tables: [] }));
    const receipt = archiveSkillPipeline(db, root);
    expect(fs.existsSync(legacy)).toBe(true);
    expect(receipt.maintenance).toEqual({ reused: false, pruned: 0, kept: 1 });
    expect(verifySkillPipelineArchive(path.join(receipt.archivePath, 'receipt.json'))).toEqual({
      format: receipt.format, archivePath: receipt.archivePath, tables: receipt.tables,
    });
  });

  it('keeps the identical older receipt when deleting the new copy fails', () => {
    const first = archiveSkillPipeline(db, root);
    const remove = jest.spyOn(require('node:fs') as typeof fs, 'rmSync')
      .mockImplementation(() => { throw new Error('EBUSY'); });
    const second = (() => {
      try {
        return archiveSkillPipeline(db, root);
      } finally {
        remove.mockRestore();
      }
    })();
    expect(second.archivePath).toBe(first.archivePath);
    expect(second.maintenance).toEqual({ reused: true, pruned: 0, kept: 0, maintenanceError: true });
    expect(verifySkillPipelineArchive(path.join(second.archivePath, 'receipt.json'))).toEqual({
      format: second.format, archivePath: second.archivePath, tables: second.tables,
    });
  });

  it('keeps a differing older verified archive', () => {
    const first = archiveSkillPipeline(db, root);
    db.prepare('INSERT INTO skill_candidates (id, payload) VALUES (?, ?)')
      .run('candidate-2', Buffer.from([4]));
    const second = archiveSkillPipeline(db, root);
    expect(second.archivePath).not.toBe(first.archivePath);
    expect(fs.existsSync(first.archivePath)).toBe(true);
    expect(verifySkillPipelineArchive(path.join(first.archivePath, 'receipt.json')).tables[0].rows).toBe(1);
  });

  it('fails the version-57 preflight when a vec table exists without sqlite-vec', async () => {
    db.exec('CREATE TABLE skill_candidates_vec (embedding BLOB)');
    const runner = new SqliteMigrationRunner(db, createMockLogger());
    await expect(runner.applyAll([
      { version: 57, name: '0057', sql: 'CREATE TABLE after_archive (id INTEGER)' },
    ], { vecExtensionLoaded: false })).rejects.toThrow('sqlite-vec is unavailable');
    expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'after_archive'").get()).toBeUndefined();
  });
});
