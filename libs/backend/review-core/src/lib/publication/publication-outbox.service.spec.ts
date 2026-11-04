import {
  MIGRATIONS,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import type { IGitHubReviewPublicationPort } from '@ptah-extension/review-github';
import { ReviewFindingSchema } from '@ptah-extension/review-contracts';
import {
  PublicationOutboxService,
  type PublicationRequest,
} from './publication-outbox.service';
import { PublicationOutboxRepository } from './publication-outbox.repository';

const sha = 'a'.repeat(40);

describe('PublicationOutboxService', () => {
  it('reconciles changed unknown intent and preserves same, distinct, uncertain identities and repeat follow-ups', async () => {
    const Database = require('better-sqlite3') as new (
      path: string,
    ) => SqliteDatabase;
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const version of [65, 66]) {
      const migration = MIGRATIONS.find((entry) => entry.version === version);
      if (!migration?.sql) throw new Error(`Migration ${version} missing`);
      db.exec(migration.sql);
    }
    db.prepare(
      `INSERT INTO review_repositories (repo_id, owner, name, created_at, updated_at) VALUES (?, ?, ?, 1, 1)`,
    ).run('hive-academy/ptahcode', 'Hive-Academy', 'PtahCode');
    db.prepare(
      `INSERT INTO review_heads (repo_id, pr_number, head_sha, state, discovered_at) VALUES (?, 1, ?, 'active', 1)`,
    ).run('hive-academy/ptahcode', sha);
    db.prepare(
      `INSERT INTO review_attempts (attempt_id, repo_id, pr_number, head_sha, attempt_number, trigger, state, queued_at)
      VALUES ('attempt', ?, 1, ?, 1, 'automatic', 'running', 1)`,
    ).run('hive-academy/ptahcode', sha);
    let calls = 0;
    const publisher: IGitHubReviewPublicationPort = {
      publish: async () => {
        calls++;
        if (calls === 1) throw new Error('timeout');
        return {
          walkthrough: {
            id: 12,
            body: '',
            authorLogin: 'bot',
            createdAt: new Date().toISOString(),
          },
          review: {
            id: 34,
            body: '',
            submittedAt: new Date().toISOString(),
            threads: [],
          },
          deferred: [],
        };
      },
    };
    const service = new PublicationOutboxService({ db }, publisher);
    const input: PublicationRequest = {
      attemptId: 'attempt',
      target: {
        repo: { owner: 'Hive-Academy', name: 'PtahCode' },
        number: 1,
        headSha: sha,
      },
      walkthrough: 'walkthrough',
      overview: 'review',
      candidates: [],
      validRightAnchors: new Set<string>(),
    };
    await expect(service.publish(input)).rejects.toThrow('timeout');
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM review_publications WHERE state = 'unknown'`,
        )
        .get(),
    ).toEqual({ count: 2 });
    await service.publish({
      ...input,
      overview: 'review with updated summary',
    });
    expect(
      db
        .prepare(
          `SELECT request_hash FROM review_publications WHERE kind = 'review'`,
        )
        .get(),
    ).toBeDefined();
    await service.publish({
      ...input,
      overview: 'review with updated summary',
    });
    expect(calls).toBe(2);
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM review_publications WHERE state = 'confirmed'`,
        )
        .get(),
    ).toEqual({ count: 2 });
    const findingId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    db.prepare(
      `INSERT INTO review_findings (finding_id, repo_id, pr_number, path, category, status, severity,
      confidence, payload_json, first_head_sha, last_head_sha, created_at, updated_at)
      VALUES (?, ?, 1, 'src/a.ts', 'functional', 'addressed', 'Major', 0.9, '{}', ?, ?, 1, 1)`,
    ).run(findingId, 'hive-academy/ptahcode', sha, sha);
    const repository = new PublicationOutboxRepository(db);
    db.prepare(
      `UPDATE review_findings SET symbol_id = ?, failure_mode = ?, affected_behavior = ? WHERE finding_id = ?`,
    ).run(
      'retryCall',
      'Retry never starts',
      'Request remains pending',
      findingId,
    );
    const candidate = ReviewFindingSchema.parse({
      schemaVersion: 1,
      lens: 'correctness-lifecycle',
      title: 'Retry regression',
      failureMode: 'Retry never starts',
      affectedBehavior: 'Request remains pending',
      scenario: 'Timeout then retry',
      path: 'src/a.ts',
      line: 2,
      evidence: [{ path: 'src/a.ts', line: 2, excerpt: 'await pending' }],
      affectedCaller: 'retryCall',
      severity: 'Major',
      category: 'functional',
      confidence: 0.9,
      suggestedDiff: null,
      fixPrompt: 'Release pending',
      verification: 'cross-family',
    });
    expect(
      repository.proposeIdentity('attempt', 'same-candidate', candidate),
    ).toMatchObject({
      relation: 'same',
      priorFindingId: findingId,
    });
    expect(
      repository.proposeIdentity('attempt', 'ambiguous-candidate', {
        ...candidate,
        failureMode: 'Reworded failure',
      }),
    ).toMatchObject({ relation: 'uncertain' });
    const reworded = {
      ...candidate,
      failureMode: 'Same failure described in new words',
    };
    repository.recordVerifierIdentity(
      'attempt',
      'staged-same',
      reworded,
      {
        relation: 'same',
        priorFindingId: findingId,
        reason: 'Same observed failure path',
      },
      'verifier',
    );
    expect(
      repository.proposeIdentity('attempt', 'staged-same', reworded),
    ).toMatchObject({ relation: 'same', priorFindingId: findingId });
    const sameVerdict = repository.proposeIdentity(
      'attempt',
      'semantic-same',
      reworded,
      {
        relation: 'same',
        priorFindingId: findingId,
        reason: 'Same observed failure path',
      },
    );
    expect(
      repository.identity('attempt', reworded, sameVerdict, 'verifier')
        .findingId,
    ).toBe(findingId);
    expect(repository.pendingFollowUp('attempt', findingId)).toBe('reopened');
    // A manual retryHead/rerun of the same head gets a new attempt id and must still replay it.
    // Only one active attempt per PR is allowed, so the first attempt fails before the retry.
    db.prepare(
      `UPDATE review_attempts SET state = 'failed' WHERE attempt_id = 'attempt'`,
    ).run();
    db.prepare(
      `INSERT INTO review_attempts (attempt_id, repo_id, pr_number, head_sha, attempt_number, trigger, state, queued_at)
      VALUES ('manual-retry', ?, 1, ?, 2, 'manual', 'running', 2)`,
    ).run('hive-academy/ptahcode', sha);
    expect(repository.pendingFollowUp('manual-retry', findingId)).toBe(
      'reopened',
    );
    db.prepare(
      `DELETE FROM review_attempts WHERE attempt_id = 'manual-retry'`,
    ).run();
    db.prepare(
      `UPDATE review_attempts SET state = 'running' WHERE attempt_id = 'attempt'`,
    ).run();
    const distinct = {
      ...candidate,
      failureMode: 'A separate retry error',
      affectedBehavior: 'Second request fails',
    };
    const distinctVerdict = repository.proposeIdentity(
      'attempt',
      'semantic-distinct',
      distinct,
      {
        relation: 'distinct',
        priorFindingId: null,
        reason: 'Different failure path in same symbol',
      },
    );
    const distinctId = repository.identity(
      'attempt',
      distinct,
      distinctVerdict,
      'verifier',
    ).findingId;
    expect(distinctId).not.toBe(findingId);
    expect(distinctId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const uncertain = repository.proposeIdentity(
      'attempt',
      'semantic-uncertain',
      { ...candidate, failureMode: 'Ambiguous retry symptom' },
    );
    expect(
      repository.identity(
        'attempt',
        { ...candidate, failureMode: 'Ambiguous retry symptom' },
        uncertain,
        'verifier',
      ).findingId,
    ).toBeNull();
    const first = repository.plan({
      attemptId: 'attempt',
      kind: 'follow_up',
      key: 'addressed',
      findingId,
      marker: 'addressed',
      body: 'Addressed evidence',
    });
    const second = repository.plan({
      attemptId: 'attempt',
      kind: 'follow_up',
      key: 'reopened',
      findingId,
      marker: 'reopened',
      body: 'Reopened evidence',
    });
    expect(second.id).not.toBe(first.id);
    db.close();
  });

  it('plans a reopened follow-up with the reopened marker when it was not pre-planned', async () => {
    const Database = require('better-sqlite3') as new (
      path: string,
    ) => SqliteDatabase;
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (const version of [65, 66]) {
      const migration = MIGRATIONS.find((entry) => entry.version === version);
      if (!migration?.sql) throw new Error(`Migration ${version} missing`);
      db.exec(migration.sql);
    }
    db.prepare(
      `INSERT INTO review_repositories (repo_id, owner, name, created_at, updated_at) VALUES (?, ?, ?, 1, 1)`,
    ).run('hive-academy/ptahcode', 'Hive-Academy', 'PtahCode');
    db.prepare(
      `INSERT INTO review_heads (repo_id, pr_number, head_sha, state, discovered_at) VALUES (?, 1, ?, 'active', 1)`,
    ).run('hive-academy/ptahcode', sha);
    db.prepare(
      `INSERT INTO review_attempts (attempt_id, repo_id, pr_number, head_sha, attempt_number, trigger, state, queued_at)
      VALUES ('attempt', ?, 1, ?, 1, 'automatic', 'running', 1)`,
    ).run('hive-academy/ptahcode', sha);
    const findingId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
    db.prepare(
      `INSERT INTO review_findings (finding_id, repo_id, pr_number, path, category, status, severity,
      confidence, payload_json, first_head_sha, last_head_sha, created_at, updated_at)
      VALUES (?, ?, 1, 'src/a.ts', 'functional', 'reopened', 'Major', 0.9, '{}', ?, ?, 1, 1)`,
    ).run(findingId, 'hive-academy/ptahcode', sha, sha);
    const publisher: IGitHubReviewPublicationPort = {
      publish: async () => {
        throw new Error('timeout');
      },
    };
    const service = new PublicationOutboxService({ db }, publisher);
    await expect(
      service.publish({
        attemptId: 'attempt',
        target: {
          repo: { owner: 'Hive-Academy', name: 'PtahCode' },
          number: 1,
          headSha: sha,
        },
        walkthrough: 'walkthrough',
        overview: 'review',
        candidates: [],
        validRightAnchors: new Set<string>(),
        followUps: [
          {
            findingId,
            body: `Reopened\n<!-- ptah-review:reopened:${findingId} -->`,
          },
        ],
      }),
    ).rejects.toThrow('timeout');
    expect(
      new PublicationOutboxRepository(db).pendingFollowUp('attempt', findingId),
    ).toBe('reopened');
    db.close();
  });
});
