import 'reflect-metadata';
import { sql, vecSql } from './0057_drop_skill_pipeline';
import { MIGRATIONS } from './index';
import { PIPELINE_JOB_IDS } from '../skill-pipeline-archive';
import * as skillPipelineArchive from '../skill-pipeline-archive';
import { SqliteMigrationRunner } from '../migration-runner';
import { FakeSqliteDatabase } from '../testing/fake-sqlite-database';
import { createMockLogger } from '../testing/mock-logger';

const relationalTables = [
  'skill_candidates', 'skill_suggestions', 'skill_synthesis_queue',
  'skill_synthesis_budget', 'skill_invocations',
  'skill_synthesis_workspace_cursor',
] as const;

function at56(): FakeSqliteDatabase {
  const db = new FakeSqliteDatabase();
  db.insertMigrationRow(56, 0);
  db.exec('PRAGMA user_version = 56');
  for (const table of relationalTables) db.exec(`CREATE TABLE ${table} (id TEXT);`);
  return db;
}

const migration57 = MIGRATIONS.find((entry) => entry.version === 57);
if (migration57 === undefined) throw new Error('Migration 0057 is not registered');

describe('migration 0057_drop_skill_pipeline', () => {
  it('registers last with relational and optional vec cleanup', () => {
    expect(migration57).toEqual({ version: 57, name: '0057_drop_skill_pipeline', sql, vecSql });
    expect(MIGRATIONS[MIGRATIONS.indexOf(migration57) - 1]?.version).toBe(56);
  });

  it('leaves version 56 and every table intact when archive verification fails', async () => {
    const db = at56();
    db.tables.add('skill_candidates_vec');
    const archive = jest.spyOn(skillPipelineArchive, 'archiveSkillPipeline')
      .mockImplementation(() => { throw new Error('archive verification failed'); });
    try {
      const runner = new SqliteMigrationRunner(db, createMockLogger());
      await expect(runner.applyAll([migration57]))
        .rejects.toThrow('archive verification failed');
      expect(runner.readAppliedVersions()).toEqual(new Set([56]));
      expect(db.getUserVersion()).toBe(56);
      for (const table of relationalTables) expect(db.tables.has(table)).toBe(true);
      expect(db.tables.has('skill_candidates_vec')).toBe(true);
    } finally {
      archive.mockRestore();
    }
  });

  it('does not begin when vec exists but sqlite-vec cannot load', async () => {
    const db = at56();
    db.tables.add('skill_candidates_vec');
    const prepare = db.prepare.bind(db);
    const probe = jest.spyOn(db, 'prepare').mockImplementation((query) => {
      const statement = prepare(query);
      if (query.includes('sqlite_schema')) {
        return Object.assign(statement, { get: () => ({ present: 1 }) });
      }
      return statement;
    });
    const archive = jest.spyOn(skillPipelineArchive, 'archiveSkillPipeline');
    try {
      const runner = new SqliteMigrationRunner(db, createMockLogger());
      await expect(runner.applyAll([migration57], { vecExtensionLoaded: false }))
        .rejects.toThrow('skill_candidates_vec exists but sqlite-vec is unavailable');
      expect(archive).not.toHaveBeenCalled();
      expect(runner.readAppliedVersions()).toEqual(new Set([56]));
      for (const table of relationalTables) expect(db.tables.has(table)).toBe(true);
      expect(db.tables.has('skill_candidates_vec')).toBe(true);
    } finally {
      probe.mockRestore();
      archive.mockRestore();
    }
  });

  it('defers empty vec cleanup when the vec table is absent', async () => {
    const db = at56();
    const archive = jest.spyOn(skillPipelineArchive, 'archiveSkillPipeline')
      .mockReturnValue({ archivePath: 'verified' } as ReturnType<typeof skillPipelineArchive.archiveSkillPipeline>);
    try {
      const runner = new SqliteMigrationRunner(db, createMockLogger());
      await runner.applyAll([migration57], { vecExtensionLoaded: false });
      expect(runner.readAppliedVersions().has(57)).toBe(true);
      expect(db.selectVecPendingVersions()).toEqual([{ version: 57 }]);
      for (const table of relationalTables) expect(db.tables.has(table)).toBe(false);
    } finally {
      archive.mockRestore();
    }
  });

  it('preserves unrelated job and cron history', () => {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => {
        exec(sql: string): void;
        prepare(sql: string): { all(): unknown[] };
        close(): void;
      };
    };
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('PRAGMA foreign_keys = ON');
      db.exec('CREATE TABLE job_runs (job_id TEXT); CREATE TABLE scheduled_jobs (id TEXT);');
      for (const table of relationalTables) db.exec(`CREATE TABLE ${table} (id TEXT);`);
      const quoted = (value: string): string => `'${value.replace(/'/g, "''")}'`;
      for (const id of [...PIPELINE_JOB_IDS, '@ptah/unrelated']) {
        db.exec(`INSERT INTO job_runs VALUES (${quoted(id)}); INSERT INTO scheduled_jobs VALUES (${quoted(id)});`);
      }
      db.exec(sql);
      expect(db.prepare('SELECT job_id FROM job_runs').all()).toEqual([{ job_id: '@ptah/unrelated' }]);
      expect(db.prepare('SELECT id FROM scheduled_jobs').all()).toEqual([{ id: '@ptah/unrelated' }]);
      for (const table of relationalTables) {
        expect(db.prepare(`SELECT name FROM sqlite_schema WHERE name = '${table}'`).all()).toEqual([]);
      }
    } finally {
      db.close();
    }
  });
});
