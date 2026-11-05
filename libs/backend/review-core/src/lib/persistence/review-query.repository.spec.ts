import 'reflect-metadata';
import { MIGRATIONS, SqliteConnectionService, type SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { Logger } from '@ptah-extension/vscode-core';
import { ReviewQueryRepository } from './review-query.repository';

describe('ReviewQueryRepository', () => {
  it('binds cursor parameters and filters partial runs by persisted result', async () => {
    const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase;
    const db = new Database(':memory:');
    try {
      db.pragma('foreign_keys = ON');
      const migration = MIGRATIONS.find((entry) => entry.version === 65);
      if (!migration?.sql) throw new Error('Review migration missing');
      db.exec(migration.sql);
      for (const version of [67, 68]) {
        const addition = MIGRATIONS.find((entry) => entry.version === version);
        if (!addition?.sql) throw new Error('Review migration missing: ' + version);
        db.exec(addition.sql);
      }
      const now = Date.UTC(2026, 0, 1);
      const sha = 'a'.repeat(40);
      db.prepare(`INSERT INTO review_repositories (repo_id, owner, name, created_at, updated_at)
        VALUES ('hive-academy/ptahcode', 'Hive-Academy', 'PtahCode', ?, ?)`).run(now, now);
      db.prepare(`INSERT INTO review_heads (repo_id, pr_number, head_sha, state, discovered_at)
        VALUES ('hive-academy/ptahcode', 1, ?, 'active', ?)`).run(sha, now);
      const insert = db.prepare(`INSERT INTO review_attempts
        (attempt_id, repo_id, pr_number, head_sha, attempt_number, trigger, state, result_status,
        queued_at, ended_at, deadline_at, config_snapshot_hash)
        VALUES (?, 'hive-academy/ptahcode', 1, ?, ?, 'manual', 'completed', ?, ?, ?, ?, ?)`);
      insert.run('a1', sha, 1, 'partial', now + 1, now + 11, now + 1000, sha);
      insert.run('a2', sha, 2, 'succeeded', now + 2, now + 12, now + 1000, sha);
      insert.run('a3', sha, 3, 'partial', now + 3, now + 13, now + 1000, sha);
      const checkpoint = db.prepare(`INSERT INTO review_stages (attempt_id, stage, ordinal, state, outcome)
        VALUES (?, 'checkpoint:context', 0, 'completed', '{"coverage":["src"]}')`);
      for (const id of ['a1', 'a2', 'a3']) checkpoint.run(id);
      db.prepare(`INSERT INTO review_attempts
        (attempt_id, repo_id, pr_number, head_sha, attempt_number, trigger, state, queued_at)
        VALUES ('a4', 'hive-academy/ptahcode', 1, ?, 4, 'manual', 'queued', ?)`)
        .run(sha, now + 4);
      db.prepare(`INSERT INTO review_attempts
        (attempt_id, repo_id, pr_number, head_sha, attempt_number, trigger, state, result_status, queued_at, ended_at)
        VALUES ('a5', 'hive-academy/ptahcode', 1, ?, 5, 'automatic', 'cancelled', 'superseded', ?, ?)`)
        .run(sha, now + 5, now + 6);
      db.prepare(`INSERT INTO review_stages (attempt_id, stage, ordinal, state, outcome, error_summary)
        VALUES ('a3', 'lens:security-privacy', 0, 'interrupted', 'partial', 'deadline')`).run();
      const findingId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const secret = `ghp_${'a'.repeat(30)}`;
      const finding = { schemaVersion: 1, lens: 'security-privacy', title: 'Credential exposure',
        failureMode: `Leaks ${secret}`, affectedBehavior: 'Credential visible', scenario: 'Export after review',
        path: 'src/review.ts', line: 3, evidence: [{ path: 'src/review.ts', line: 3, excerpt: 'token output' }],
        affectedCaller: null, severity: 'Major', category: 'security', confidence: 0.9,
        verification: 'cross-family', suggestedDiff: null, fixPrompt: 'Remove credential output' };
      db.prepare(`INSERT INTO review_findings
        (finding_id, repo_id, pr_number, path, category, status, severity, confidence,
         payload_json, first_head_sha, last_head_sha, created_at, updated_at)
        VALUES (?, 'hive-academy/ptahcode', 1, 'src/review.ts', 'security', 'open', 'Major', 0.9,
          ?, ?, ?, ?, ?)`).run(findingId, JSON.stringify(finding), sha, sha, now, now);
      db.prepare(`INSERT INTO review_finding_events (event_id, attempt_id, finding_id, kind, created_at)
        VALUES ('event', 'a3', ?, 'accepted', ?)`).run(findingId, now);
      const logger = Object.create(Logger.prototype) as Logger;
      const connection = new SqliteConnectionService(':memory:', logger);
      Object.defineProperty(connection, 'db', { value: db });
      const query = new ReviewQueryRepository(connection);
      db.prepare(`UPDATE review_repositories SET poll_status = 'failed', poll_error = 'github-poll-failed'
        WHERE repo_id = 'hive-academy/ptahcode'`).run();
      db.prepare(`INSERT INTO review_poll_state (repo_id, last_error_at, last_error)
        VALUES ('hive-academy/ptahcode', ?, 'github-poll-failed')`).run(now + 5);
      expect(await query.getRun('a4')).toMatchObject({ configHash: null, deadlineAt: null, coverage: [] });
      expect((await query.listRuns({ limit: 10 })).runs.find((run) => run.attemptId === 'a5'))
        .toMatchObject({ status: 'superseded' });
      expect(await query.getRun('a5')).toMatchObject({ status: 'superseded' });
      db.prepare(`UPDATE review_attempts SET result_status = NULL WHERE attempt_id = 'a5'`).run();
      expect((await query.listRuns({ limit: 10 })).runs.find((run) => run.attemptId === 'a5'))
        .toMatchObject({ status: 'superseded' });
      expect((await query.getRun('a3'))?.stages).toMatchObject([{ name: 'lenses', scope: 'security-privacy',
        status: 'partial', error: 'deadline' }]);
      for (const stage of ['discovery', 'context', 'checks', 'triage', 'lens:correctness-lifecycle',
        'lens:contracts-callers', 'lens:host-di-config', 'verification']) {
        db.prepare(`INSERT INTO review_stages (attempt_id, stage, ordinal, state)
          VALUES ('a3', ?, 0, 'completed')`).run(stage);
      }
      expect((await query.getRun('a3'))?.stages).toHaveLength(9);
      const findings = await query.listFindings('a3');
      expect(findings).toHaveLength(1);
      expect(JSON.stringify(findings)).not.toContain(secret);
      const first = await query.listRuns({ state: 'partial', limit: 1 });
      expect(first.poll).toEqual({ status: 'failed', error: 'github-poll-failed', lastSuccessAt: null,
        lastErrorAt: new Date(now + 5).toISOString() });
      db.prepare(`INSERT INTO review_repositories (repo_id, owner, name, enabled, poll_status, poll_error, created_at, updated_at)
        VALUES ('other/repo', 'Other', 'Repo', 1, 'failed', 'other-poll-failed', ?, ?)`).run(now, now);
      db.prepare(`INSERT INTO review_poll_state (repo_id, last_error_at, last_error)
        VALUES ('other/repo', ?, 'other-poll-failed')`).run(now + 10);
      expect((await query.listRuns({ limit: 10 })).poll.error).toBe('other-poll-failed');
      expect((await query.listRuns({ repo: { owner: 'Hive-Academy', name: 'PtahCode' }, limit: 10 })).poll.error)
        .toBe('github-poll-failed');
      db.prepare(`UPDATE review_repositories SET enabled = 0 WHERE repo_id = 'other/repo'`).run();
      expect((await query.listRuns({ limit: 10 })).poll.error).toBe('github-poll-failed');
      expect(first.runs.map((run) => run.attemptId)).toEqual(['a3']);
      expect(first.nextCursor).not.toBeNull();
      const second = await query.listRuns({ state: 'partial', limit: 1, cursor: first.nextCursor ?? undefined });
      expect(second.runs.map((run) => run.attemptId)).toEqual(['a1']);
      expect(second.nextCursor).toBeNull();
    } finally { db.close(); }
  });
});
