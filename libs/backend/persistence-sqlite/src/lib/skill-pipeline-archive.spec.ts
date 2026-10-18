import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SqliteDatabase } from './sqlite-connection.service';
import { archiveSkillPipeline, verifySkillPipelineArchive } from './skill-pipeline-archive';
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
    db.prepare('INSERT INTO skill_candidates (id, payload) VALUES (?, ?)')
      .run('candidate-1', Buffer.from([1, 2, 3]));
    db.prepare('INSERT INTO job_runs (id, job_id) VALUES (?, ?)')
      .run('pipeline', '@ptah/skills-drain-nightly');
    db.prepare('INSERT INTO job_runs (id, job_id) VALUES (?, ?)')
      .run('unrelated', '@ptah/other');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('records absent tables and verifies only pipeline job rows', () => {
    const receipt = archiveSkillPipeline(db, root);
    expect(verifySkillPipelineArchive(path.join(receipt.archivePath, 'receipt.json'))).toEqual(receipt);
    expect(receipt.tables.find((entry) => entry.table === 'skill_candidates')).toMatchObject({ present: true, rows: 1 });
    expect(receipt.tables.find((entry) => entry.table === 'skill_candidates_vec')).toMatchObject({ present: false, rows: 0 });
    expect(receipt.tables.find((entry) => entry.table === 'job_runs')).toMatchObject({ present: true, rows: 1 });
    const archivedJobs = fs.readFileSync(path.join(receipt.archivePath, 'job_runs.jsonl'), 'utf8');
    expect(archivedJobs).toContain('pipeline');
    expect(archivedJobs).not.toContain('unrelated');
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

  it('fails the version-57 preflight when a vec table exists without sqlite-vec', async () => {
    db.exec('CREATE TABLE skill_candidates_vec (embedding BLOB)');
    const runner = new SqliteMigrationRunner(db, createMockLogger());
    await expect(runner.applyAll([
      { version: 57, name: '0057', sql: 'CREATE TABLE after_archive (id INTEGER)' },
    ], { vecExtensionLoaded: false })).rejects.toThrow('sqlite-vec is unavailable');
    expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'after_archive'").get()).toBeUndefined();
  });
});
