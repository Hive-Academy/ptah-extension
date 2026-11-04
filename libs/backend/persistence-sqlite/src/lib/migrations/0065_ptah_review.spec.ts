import 'reflect-metadata';
import { SqliteMigrationRunner } from '../migration-runner';
import * as skillPipelineArchive from '../skill-pipeline-archive';
import { FakeSqliteDatabase } from '../testing/fake-sqlite-database';
import { createMockLogger } from '../testing/mock-logger';
import { sql } from './0065_ptah_review';
import { MIGRATIONS } from './index';

interface DatabaseShape {
  exec(statement: string): void;
  prepare(statement: string): {
    run(...params: (string | number | null)[]): unknown;
    get(...params: (string | number | null)[]): unknown;
    all(...params: (string | number | null)[]): unknown;
  };
  close(): void;
}

describe('migration 0065_ptah_review', () => {
  let db: DatabaseShape;

  beforeEach(() => {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => DatabaseShape;
    };
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(sql);
  });

  afterEach(() => db.close());

  const repo = `INSERT INTO review_repositories
    (repo_id, owner, name, created_at, updated_at) VALUES (?, ?, ?, 1, 1)`;
  const head = `INSERT INTO review_heads
    (repo_id, pr_number, head_sha, state, discovered_at) VALUES (?, ?, ?, ?, 1)`;
  const attempt = `INSERT INTO review_attempts
    (attempt_id, repo_id, pr_number, head_sha, attempt_number, trigger, state, queued_at)
    VALUES (?, 'r1', 1, ?, ?, ?, ?, 1)`;
  const sha1 = 'a'.repeat(40);
  const sha2 = 'b'.repeat(40);

  function seed(): void {
    db.prepare(repo).run('r1', 'Owner', 'Repo');
    db.prepare(head).run('r1', 1, sha1, 'active');
  }

  it('registers after 64 and creates every durable table', () => {
    const previous = MIGRATIONS.findIndex((migration) => migration.version === 64);
    expect(MIGRATIONS[previous + 1]).toEqual({ version: 65, name: '0065_ptah_review', sql });
    expect(Math.max(...MIGRATIONS.map((migration) => migration.version))).toBeGreaterThanOrEqual(65);
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'review_%'").all() as { name: string }[];
    expect(rows.map((row) => row.name).sort()).toEqual([
      'review_artifacts', 'review_attempts', 'review_finding_events',
      'review_findings', 'review_heads', 'review_identity_matches',
      'review_operator_settings', 'review_poll_state', 'review_publications', 'review_repositories',
      'review_stages',
    ]);
    expect(sql).not.toContain('${');
  });

  it('enforces canonical repository and active PR head identities', () => {
    seed();
    expect(() => db.prepare(repo).run('r2', 'owner', 'repo')).toThrow();
    expect(() => db.prepare(head).run('r1', 1, sha2, 'active')).toThrow();
    db.prepare("UPDATE review_heads SET state = 'superseded', superseded_at = 2 WHERE head_sha = ?").run(sha1);
    expect(() => db.prepare(head).run('r1', 1, sha2, 'active')).not.toThrow();
    expect(() => db.prepare(head).run('r1', 1, sha1, 'superseded')).toThrow();
  });

  it('keeps manual attempts distinct and serializes running attempts per PR', () => {
    seed();
    db.prepare(attempt).run('a0', sha1, 0, 'automatic', 'completed');
    db.prepare(attempt).run('a1', sha1, 1, 'manual', 'running');
    expect(() => db.prepare(attempt).run('duplicate', sha1, 1, 'manual', 'queued')).toThrow();
    expect(() => db.prepare(attempt).run('a2', sha1, 2, 'manual', 'running')).toThrow();
    expect(() => db.prepare(attempt).run('a2', sha1, 2, 'manual', 'queued')).not.toThrow();
  });

  it('enforces foreign keys and cascades stage rows only with their attempt', () => {
    seed();
    expect(() => db.prepare(attempt).run('bad', sha2, 0, 'automatic', 'queued')).toThrow();
    db.prepare(attempt).run('a0', sha1, 0, 'automatic', 'completed');
    db.prepare(`INSERT INTO review_stages (attempt_id, stage, ordinal, state)
      VALUES ('a0', 'triage', 0, 'completed')`).run();
    expect(() => db.prepare("DELETE FROM review_heads WHERE head_sha = ?").run(sha1)).toThrow();
    db.prepare("DELETE FROM review_attempts WHERE attempt_id = 'a0'").run();
    expect(db.prepare('SELECT count(*) AS count FROM review_stages').get()).toMatchObject({ count: 0 });
  });

  it('uses assigned ULIDs and deduplicates events, matches and outbox intents', () => {
    seed();
    db.prepare(attempt).run('a0', sha1, 0, 'automatic', 'completed');
    const finding = `INSERT INTO review_findings
      (finding_id, repo_id, pr_number, path, category, status, severity,
       confidence, first_head_sha, last_head_sha, payload_json, created_at, updated_at)
      VALUES (?, 'r1', 1, 'src/a.ts', 'bug', 'open', 'high', 0.9, ?, ?, '{}', 1, 1)`;
    const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    expect(() => db.prepare(finding).run('prose-hash', sha1, sha1)).toThrow();
    db.prepare(finding).run(id, sha1, sha1);
    const event = `INSERT INTO review_finding_events
      (event_id, attempt_id, finding_id, kind, created_at)
      VALUES (?, 'a0', ?, 'accepted', 1)`;
    db.prepare(event).run('e1', id);
    expect(() => db.prepare(event).run('e2', id)).toThrow();
    const match = `INSERT INTO review_identity_matches
      (attempt_id, candidate_id, relation, evidence_json, evidence_hash, verifier_family, created_at)
      VALUES ('a0', 'c1', 'uncertain', '{}', 'hash', 'codex', 1)`;
    db.prepare(match).run();
    expect(() => db.prepare(match).run()).toThrow();
    const publication = `INSERT INTO review_publications
      (publication_id, repo_id, pr_number, head_sha, attempt_id, kind,
       publication_key, state, request_hash, marker, created_at, updated_at)
      VALUES (?, 'r1', 1, ?, 'a0', 'review', 'main', 'planned', 'hash', 'marker', 1, 1)`;
    db.prepare(publication).run('p1', sha1);
    expect(() => db.prepare(publication).run('p2', sha1)).toThrow();
    expect(() => db.prepare("DELETE FROM review_findings WHERE finding_id = ?").run(id)).toThrow();
  });

  it('re-applies its static CREATE statements without changing schema or data', () => {
    seed();
    const before = db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name LIKE 'review_%'").get();
    expect(() => db.exec(sql)).not.toThrow();
    expect(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name LIKE 'review_%'").get()).toEqual(before);
    expect(db.prepare('SELECT count(*) AS count FROM review_repositories').get()).toMatchObject({ count: 1 });
  });

  it('stores one validated operator row and required finding payload JSON', () => {
    db.prepare(`INSERT INTO review_operator_settings (id, settings_json, updated_at) VALUES (1, '{}', 1)`).run();
    expect(() => db.prepare(`INSERT INTO review_operator_settings (id, settings_json, updated_at) VALUES (2, '{}', 1)`).run()).toThrow();
    expect(() => db.prepare(`UPDATE review_operator_settings SET settings_json = 'invalid'`).run()).toThrow();
    const columns = db.prepare(`PRAGMA table_info(review_findings)`).all() as { name: string }[];
    expect(columns.map((column) => column.name)).toContain('payload_json');
    const attemptColumns = db.prepare(`PRAGMA table_info(review_attempts)`).all() as { name: string }[];
    expect(attemptColumns.map((column) => column.name)).toContain('result_status');
    seed();
    const insert = db.prepare(`INSERT INTO review_findings (finding_id, repo_id, pr_number, path, category, status,
      severity, confidence, first_head_sha, last_head_sha, payload_json, created_at, updated_at)
      VALUES (?, 'r1', 1, 'src/a.ts', 'functional', 'open', 'Major', 0.9, ?, ?, ?, 1, 1)`);
    expect(() => insert.run('01ARZ3NDEKTSV4RRFFQ69G5FAV', sha1, sha1, '{bad')).toThrow();
    expect(() => insert.run('01ARZ3NDEKTSV4RRFFQ69G5FAV', sha1, sha1, '{}')).not.toThrow();
    expect(() => db.prepare(`INSERT INTO review_findings (finding_id, repo_id, pr_number, path, category, status,
      severity, confidence, first_head_sha, last_head_sha, created_at, updated_at)
      VALUES ('01ARZ3NDEKTSV4RRFFQ69G5FAW', 'r1', 1, 'src/a.ts', 'functional', 'open', 'Major', 0.9, ?, ?, 1, 1)`)
      .run(sha1, sha1)).toThrow();
  });

  it('skips version 65 when the migration runner replays its chain', async () => {
    const fake = new FakeSqliteDatabase();
    const archive = jest.spyOn(skillPipelineArchive, 'archiveSkillPipeline')
      .mockReturnValue({ archivePath: 'verified' } as ReturnType<typeof skillPipelineArchive.archiveSkillPipeline>);
    try {
      const runner = new SqliteMigrationRunner(fake, createMockLogger());
      const chain = [{ version: 65, name: '0065_ptah_review', sql }];
      expect((await runner.applyAll(chain)).appliedVersions).toEqual([65]);
      const replay = await runner.applyAll(chain);
      expect(replay.appliedVersions).toEqual([]);
      expect(replay.skippedVersions).toEqual([65]);
      expect(runner.readAppliedVersions()).toContain(65);
    } finally {
      archive.mockRestore();
    }
  });
});
