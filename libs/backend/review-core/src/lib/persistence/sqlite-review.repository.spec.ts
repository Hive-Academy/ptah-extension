import 'reflect-metadata';
import { MIGRATIONS, SqliteConnectionService, type SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { Logger } from '@ptah-extension/vscode-core';
import type { ReviewQueueHead } from '../review-queue.service';
import { SqliteReviewRepository } from './sqlite-review.repository';

const at = (offset: number): string => new Date(Date.UTC(2026, 0, 1) + offset).toISOString();
const head = (prNumber: number, letter: string): ReviewQueueHead => ({
  repo: { owner: 'Hive-Academy', name: 'PtahCode' }, prNumber, headSha: letter.repeat(40),
});

function setup() {
  const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase;
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const migration = MIGRATIONS.find((entry) => entry.version === 65);
  if (!migration?.sql) throw new Error('Review migration missing');
  db.exec(migration.sql);
  const logger = Object.create(Logger.prototype) as Logger;
  logger.info = jest.fn();
  const connection = new SqliteConnectionService(':memory:', logger);
  Object.defineProperty(connection, 'db', { value: db });
  return { db, repository: new SqliteReviewRepository(connection, logger) };
}

describe('SqliteReviewRepository', () => {
  it('reads the last successful head and open failures from shipped review tables', async () => {
    const { db, repository } = setup();
    try {
      const old = head(1, 'a');
      const attempt = await repository.enqueueDiscovered(old, at(0));
      const claim = await repository.claimNext('worker', at(1), at(10000));
      expect(claim?.attemptId).toBe(attempt.attemptId);
      await repository.release(attempt.attemptId, 'worker', 'succeeded', at(2));
      await repository.enqueueDiscovered(head(1, 'b'), at(3));
      const now = Date.UTC(2026, 0, 1);
      db.prepare(`INSERT INTO review_findings (finding_id, repo_id, pr_number, path, category, status, severity,
        confidence, payload_json, first_head_sha, last_head_sha, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('01ARZ3NDEKTSV4RRFFQ69G5FAV',
        'hive-academy/ptahcode', 1, 'src/old.ts', 'functional', 'open', 'Major', 0.9, '{}', old.headSha, old.headSha, now, now);
      expect(await repository.getLastReviewedHead(old.repo, 1)).toBe(old.headSha);
      expect(await repository.getOpenFailures(old.repo, 1)).toEqual([{ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', path: 'src/old.ts' }]);
      db.prepare(`UPDATE review_findings SET status = 'reopened' WHERE finding_id = ?`).run('01ARZ3NDEKTSV4RRFFQ69G5FAV');
      expect(await repository.getOpenFailures(old.repo, 1)).toEqual([{ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', path: 'src/old.ts' }]);
    } finally { db.close(); }
  });
  it('records failed and recovered polls without advancing the success cursor on failure', async () => {
    const { db, repository } = setup();
    const repo = head(1, 'a').repo;
    try {
      await repository.recordPoll(repo, true);
      const lastSuccess = await repository.getLastPollAt(repo);
      await repository.recordPoll(repo, false);
      expect(await repository.getLastPollAt(repo)).toBe(lastSuccess);
      expect(db.prepare('SELECT poll_status, poll_error FROM review_repositories').get())
        .toEqual({ poll_status: 'failed', poll_error: 'github-poll-failed' });
      await repository.recordPoll(repo, true);
      expect(db.prepare('SELECT poll_status, poll_error FROM review_repositories').get())
        .toEqual({ poll_status: 'succeeded', poll_error: null });
      expect(db.prepare('SELECT last_error FROM review_poll_state').get()).toEqual({ last_error: null });
    } finally { db.close(); }
  });
  it('dedupes concurrent discovery to one automatic attempt', async () => {
    const { db, repository } = setup();
    try {
      const [one, two] = await Promise.all([repository.enqueueDiscovered(head(1, 'a'), at(0)), repository.enqueueDiscovered(head(1, 'a'), at(1))]);
      expect(one.attemptId).toBe(two.attemptId);
      expect(db.prepare('SELECT count(*) AS count FROM review_attempts').get()).toEqual({ count: 1 });
    } finally { db.close(); }
  });

  it('supersedes an active head and interrupts its running stage', async () => {
    const { db, repository } = setup();
    try {
      const old = await repository.enqueueDiscovered(head(1, 'a'), at(0));
      await repository.claimNext('worker', at(1), at(100));
      await repository.saveStage({ attemptId: old.attemptId, stage: 'checks', ordinal: 0, state: 'running', startedAt: at(1), endedAt: null,
        outcome: null, errorSummary: null, artifactHash: null, artifactPath: null });
      const next = await repository.enqueueDiscovered(head(1, 'b'), at(2));
      expect(next.headSha).toBe('b'.repeat(40));
      expect((await repository.getAttempt(old.attemptId))?.state).toBe('cancelled');
      expect(db.prepare('SELECT result_status FROM review_attempts WHERE attempt_id = ?').get(old.attemptId))
        .toEqual({ result_status: 'superseded' });
      expect((await repository.getStages(old.attemptId))[0].state).toBe('interrupted');
      expect(await repository.heartbeat(old.attemptId, 'worker', at(3), at(100))).toBe(false);
    } finally { db.close(); }
  });

  it('claims the newest head and leaves one active claim per PR', async () => {
    const { db, repository } = setup();
    try {
      await repository.enqueueDiscovered(head(1, 'a'), at(0));
      const newest = await repository.enqueueDiscovered(head(2, 'b'), at(1));
      expect((await repository.claimNext('one', at(2), at(100)))?.attemptId).toBe(newest.attemptId);
      await repository.enqueueManual(head(2, 'b'), 'manual-1', at(3));
      expect((await repository.claimNext('two', at(4), at(100)))?.prNumber).toBe(1);
      expect(await repository.claimNext('three', at(5), at(100))).toBeNull();
      expect(await repository.release(newest.attemptId, 'wrong', 'succeeded', at(6))).toBe(false);
      expect(await repository.heartbeat(newest.attemptId, 'wrong', at(6), at(100))).toBe(false);
    } finally { db.close(); }
  });

  it('requeues an expired lease and allows its interrupted stage to restart', async () => {
    const { db, repository } = setup();
    try {
      const attempt = await repository.enqueueDiscovered(head(1, 'a'), at(0));
      await repository.claimNext('owner', at(1), at(5));
      await repository.saveStage({ attemptId: attempt.attemptId, stage: 'checks', ordinal: 0, state: 'running', startedAt: at(1), endedAt: null,
        outcome: null, errorSummary: null, artifactHash: null, artifactPath: null });
      expect(await repository.reconcileExpiredLeases(at(6))).toBe(1);
      expect((await repository.getStages(attempt.attemptId))[0].state).toBe('interrupted');
      expect(await repository.enqueueDiscovered(head(1, 'a'), at(7))).toEqual(attempt);
      expect((await repository.getAttempt(attempt.attemptId))?.state).toBe('queued');
      expect((await repository.claimNext('new-owner', at(8), at(100)))?.attemptId).toBe(attempt.attemptId);
      expect(await repository.reconcileExpiredLeases(at(9))).toBe(0);
    } finally { db.close(); }
  });

  it('activates a previously seen SHA and queues a fresh attempt after a force-push back', async () => {
    const { db, repository } = setup();
    try {
      const first = await repository.enqueueDiscovered(head(1, 'a'), at(0));
      await repository.enqueueDiscovered(head(1, 'b'), at(1));
      const returned = await repository.enqueueDiscovered(head(1, 'a'), at(2));
      expect(returned.attemptId).not.toBe(first.attemptId);
      expect((await repository.claimNext('owner', at(3), at(100)))?.attemptId).toBe(returned.attemptId);
      expect(db.prepare(`SELECT head_sha FROM review_heads WHERE state = 'active'`).get()).toEqual({ head_sha: 'a'.repeat(40) });
    } finally { db.close(); }
  });

  it('queues a new automatic attempt after a failed review of the current head', async () => {
    const { db, repository } = setup();
    try {
      const first = await repository.enqueueDiscovered(head(1, 'a'), at(0));
      await repository.claimNext('owner', at(1), at(100));
      expect(await repository.release(first.attemptId, 'owner', 'failed', at(2))).toBe(true);
      const retried = await repository.enqueueDiscovered(head(1, 'a'), at(3));
      expect(retried.attemptId).not.toBe(first.attemptId);
      expect((await repository.claimNext('owner', at(4), at(100)))?.attemptId).toBe(retried.attemptId);
    } finally { db.close(); }
  });

  it('records a draft head without an attempt and enqueues it when it becomes eligible', async () => {
    const { db, repository } = setup();
    try {
      await repository.recordDraft(head(1, 'a'), at(0));
      expect(db.prepare('SELECT draft, trust_reason FROM review_heads').get()).toEqual({ draft: 1, trust_reason: 'draft' });
      expect(db.prepare('SELECT count(*) AS count FROM review_attempts').get()).toEqual({ count: 0 });
      const attempt = await repository.enqueueDiscovered(head(1, 'a'), at(1));
      expect(db.prepare('SELECT draft, trust_reason FROM review_heads').get()).toEqual({ draft: 0, trust_reason: null });
      expect((await repository.claimNext('owner', at(2), at(100)))?.attemptId).toBe(attempt.attemptId);
    } finally { db.close(); }
  });

  it('round trips a checkpoint and gives manual attempts distinct identities', async () => {
    const { db, repository } = setup();
    try {
      await repository.enqueueDiscovered(head(1, 'a'), at(0));
      const manual = await repository.enqueueManual(head(1, 'a'), 'manual-1', at(1));
      expect(manual.trigger).toBe('manual');
      await expect(repository.enqueueManual(head(1, 'a'), 'manual-1', at(2))).rejects.toThrow();
      await repository.saveCheckpoint(manual.attemptId, 'checks', 0, { done: ['lint'], version: 1 });
      expect(await repository.getCheckpoint(manual.attemptId, 'checks', 0)).toEqual({ done: ['lint'], version: 1 });
    } finally { db.close(); }
  });
});
