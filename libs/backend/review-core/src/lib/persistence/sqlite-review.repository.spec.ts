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

  it('reconciles expired leases and restart discovery cannot duplicate an interrupted run', async () => {
    const { db, repository } = setup();
    try {
      const attempt = await repository.enqueueDiscovered(head(1, 'a'), at(0));
      await repository.claimNext('owner', at(1), at(5));
      await repository.saveStage({ attemptId: attempt.attemptId, stage: 'checks', ordinal: 0, state: 'running', startedAt: at(1), endedAt: null,
        outcome: null, errorSummary: null, artifactHash: null, artifactPath: null });
      expect(await repository.reconcileExpiredLeases(at(6))).toBe(1);
      expect((await repository.getStages(attempt.attemptId))[0].state).toBe('interrupted');
      expect(await repository.enqueueDiscovered(head(1, 'a'), at(7))).toEqual(attempt);
      expect(await repository.claimNext('new-owner', at(8), at(100))).toBeNull();
      expect(await repository.reconcileExpiredLeases(at(9))).toBe(0);
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
