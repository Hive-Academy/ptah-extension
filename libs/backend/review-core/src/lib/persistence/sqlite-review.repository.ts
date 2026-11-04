import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import { z } from 'zod';
import { RepoIdentitySchema, ShaSchema, type RepoIdentity } from '@ptah-extension/review-contracts';
import { PERSISTENCE_TOKENS, SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { ReviewQueueAttempt, ReviewQueueClaim, ReviewQueueHead } from '../review-queue.service';
import type { IReviewRepository, ReviewAttemptRecord, ReviewStageRecord } from './review-repository.interface';

const attemptRow = z.object({ attempt_id: z.string(), repo_id: z.string(), pr_number: z.number(), head_sha: z.string(),
  attempt_number: z.number(), trigger: z.enum(['automatic', 'manual']), state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted']),
  queued_at: z.number(), started_at: z.number().nullable(), ended_at: z.number().nullable(), lease_owner: z.string().nullable(), lease_expires_at: z.number().nullable(),
  owner: z.string(), name: z.string() });
const stageRow = z.object({ attempt_id: z.string(), stage: z.string(), ordinal: z.number(),
  state: z.enum(['queued', 'running', 'completed', 'failed', 'interrupted', 'skipped']),
  started_at: z.number().nullable(), ended_at: z.number().nullable(), outcome: z.string().nullable(), error_summary: z.string().nullable(),
  artifact_hash: z.string().nullable(), artifact_path: z.string().nullable() });
const countRow = z.object({ count: z.number() });
const iso = (value: number | null): string | null => value === null ? null : new Date(value).toISOString();
const ms = (value: string): number => { const result = Date.parse(value); if (!Number.isFinite(result)) throw new Error('Invalid review timestamp'); return result; };
const repoId = (head: ReviewQueueHead): string => `${head.repo.owner.toLowerCase()}/${head.repo.name.toLowerCase()}`;
const SELECT_ATTEMPT = `SELECT a.*, r.owner, r.name FROM review_attempts a JOIN review_repositories r ON r.repo_id = a.repo_id`;

@injectable()
export class SqliteReviewRepository implements IReviewRepository {
  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION) private readonly sqlite: SqliteConnectionService,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  async getLastReviewedHead(repo: RepoIdentity, prNumber: number): Promise<string | null> {
    RepoIdentitySchema.parse(repo);
    if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('Invalid PR number');
    const row = this.sqlite.db.prepare(`SELECT head_sha FROM review_attempts
      WHERE repo_id = ? AND pr_number = ? AND state = 'completed' AND result_status = 'succeeded'
      ORDER BY ended_at DESC, attempt_id DESC LIMIT 1`).get(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`, prNumber);
    return row ? z.object({ head_sha: ShaSchema }).parse(row).head_sha : null;
  }

  async getOpenFailures(repo: RepoIdentity, prNumber: number): Promise<Array<{ id: string; path: string }>> {
    RepoIdentitySchema.parse(repo);
    if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('Invalid PR number');
    return this.sqlite.db.prepare(`SELECT finding_id, path FROM review_findings
      WHERE repo_id = ? AND pr_number = ? AND status IN ('open', 'reopened') ORDER BY created_at LIMIT 1000`)
      .all(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`, prNumber)
      .map((row) => {
        const parsed = z.object({ finding_id: z.string().min(1), path: z.string().min(1) }).parse(row);
        return { id: parsed.finding_id, path: parsed.path };
      });
  }

  async getLastPollAt(repo: RepoIdentity): Promise<number | null> {
    const row = this.sqlite.db.prepare('SELECT last_poll_at FROM review_repositories WHERE repo_id = ?')
      .get(`${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`);
    return row ? z.object({ last_poll_at: z.number().int().nullable() }).parse(row).last_poll_at : null;
  }

  async recordPoll(repo: RepoIdentity, ok: boolean): Promise<void> {
    const at = Date.now();
    const id = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
    const errorCode = ok ? null : 'github-poll-failed';
    this.sqlite.db.transaction(() => {
      this.sqlite.db.prepare(`INSERT INTO review_repositories (repo_id, owner, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(repo_id) DO NOTHING`).run(id, repo.owner, repo.name, at, at);
      this.sqlite.db.prepare(`UPDATE review_repositories SET last_poll_at = CASE WHEN ? THEN ? ELSE last_poll_at END,
        poll_status = ?, poll_error = ?, updated_at = ? WHERE repo_id = ?`)
        .run(Number(ok), at, ok ? 'succeeded' : 'failed', errorCode, at, id);
      this.sqlite.db.prepare(`INSERT INTO review_poll_state (repo_id, last_success_at, last_error_at, last_error)
        VALUES (?, ?, ?, ?) ON CONFLICT(repo_id) DO UPDATE SET
          last_success_at = CASE WHEN ? THEN excluded.last_success_at ELSE review_poll_state.last_success_at END,
          last_error_at = CASE WHEN ? THEN review_poll_state.last_error_at ELSE excluded.last_error_at END,
          last_error = excluded.last_error`)
        .run(id, ok ? at : null, ok ? null : at, errorCode, Number(ok), Number(ok));
    })();
  }

  private queueAttempt(row: unknown): ReviewQueueAttempt {
    const a = attemptRow.parse(row);
    return { attemptId: a.attempt_id, repo: RepoIdentitySchema.parse({ owner: a.owner, name: a.name }), prNumber: a.pr_number,
      headSha: a.head_sha, trigger: a.trigger === 'automatic' ? 'poll' : 'manual', queuedAt: new Date(a.queued_at).toISOString() };
  }

  async enqueueDiscovered(head: ReviewQueueHead, queuedAt: string): Promise<ReviewQueueAttempt> {
    return this.enqueue(head, 'automatic', null, queuedAt);
  }

  async enqueueManual(head: ReviewQueueHead, attemptId: string, queuedAt: string): Promise<ReviewQueueAttempt> {
    return this.enqueue(head, 'manual', attemptId, queuedAt);
  }

  async recordDraft(head: ReviewQueueHead, queuedAt: string): Promise<void> {
    const db = this.sqlite.db;
    const at = ms(queuedAt);
    const repo = repoId(head);
    db.transaction(() => {
      db.prepare(`INSERT INTO review_repositories (repo_id, owner, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(repo_id) DO NOTHING`).run(repo, head.repo.owner, head.repo.name, at, at);
      db.prepare(`UPDATE review_heads SET state = 'superseded', superseded_at = ?
        WHERE repo_id = ? AND pr_number = ? AND state = 'active' AND head_sha <> ?`).run(at, repo, head.prNumber, head.headSha);
      db.prepare(`INSERT INTO review_heads (repo_id, pr_number, head_sha, state, draft, trust_reason, discovered_at)
        VALUES (?, ?, ?, 'active', 1, 'draft', ?)
        ON CONFLICT(repo_id, pr_number, head_sha) DO UPDATE SET state = 'active', draft = 1, trust_reason = 'draft', superseded_at = NULL`)
        .run(repo, head.prNumber, head.headSha, at);
      db.prepare(`UPDATE review_stages SET state = 'interrupted', ended_at = ?, error_summary = 'Pull request is draft'
        WHERE state = 'running' AND attempt_id IN (SELECT attempt_id FROM review_attempts WHERE repo_id = ? AND pr_number = ? AND state = 'running')`)
        .run(at, repo, head.prNumber);
      db.prepare(`UPDATE review_attempts SET state = 'cancelled', result_status = 'superseded', ended_at = ?, lease_owner = NULL, lease_expires_at = NULL
        WHERE repo_id = ? AND pr_number = ? AND state IN ('queued', 'running')`).run(at, repo, head.prNumber);
    })();
  }

  private enqueue(head: ReviewQueueHead, trigger: 'automatic' | 'manual', id: string | null, queuedAt: string): ReviewQueueAttempt {
    const db = this.sqlite.db;
    const at = ms(queuedAt);
    return db.transaction(() => {
      const repo = repoId(head);
      db.prepare(`INSERT INTO review_repositories (repo_id, owner, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(repo_id) DO NOTHING`).run(repo, head.repo.owner, head.repo.name, at, at);
      const current = z.object({ head_sha: z.string(), draft: z.number() }).safeParse(db.prepare(`SELECT head_sha, draft FROM review_heads WHERE repo_id = ? AND pr_number = ? AND state = 'active'`).get(repo, head.prNumber));
      const headChanged = current.success && current.data.head_sha !== head.headSha;
      const becameEligible = current.success && current.data.draft === 1;
      if (headChanged) {
        db.prepare(`UPDATE review_heads SET state = 'superseded', superseded_at = ? WHERE repo_id = ? AND pr_number = ? AND state = 'active'`).run(at, repo, head.prNumber);
        db.prepare(`UPDATE review_stages SET state = 'interrupted', ended_at = ?, error_summary = 'Head superseded' WHERE attempt_id IN
          (SELECT attempt_id FROM review_attempts WHERE repo_id = ? AND pr_number = ? AND state = 'running') AND state = 'running'`).run(at, repo, head.prNumber);
        db.prepare(`UPDATE review_attempts SET state = 'cancelled', result_status = 'superseded', ended_at = ?, lease_owner = NULL, lease_expires_at = NULL
          WHERE repo_id = ? AND pr_number = ? AND state IN ('queued', 'running')`).run(at, repo, head.prNumber);
      }
      db.prepare(`INSERT INTO review_heads (repo_id, pr_number, head_sha, state, discovered_at) VALUES (?, ?, ?, 'active', ?)
        ON CONFLICT(repo_id, pr_number, head_sha) DO UPDATE SET state = 'active', draft = 0, trust_reason = NULL, superseded_at = NULL`).run(repo, head.prNumber, head.headSha, at);
      const existing = trigger === 'automatic' ? db.prepare(`${SELECT_ATTEMPT} WHERE a.repo_id = ? AND a.pr_number = ? AND a.head_sha = ? AND a.trigger = 'automatic'
        ORDER BY a.attempt_number DESC LIMIT 1`).get(repo, head.prNumber, head.headSha) : undefined;
      if (existing && !headChanged && !becameEligible) {
        const previous = attemptRow.parse(existing);
        if (previous.state === 'queued' || previous.state === 'running' || previous.state === 'completed') return this.queueAttempt(existing);
      }
      const number = countRow.parse(db.prepare(`SELECT COALESCE(MAX(attempt_number), -1) + 1 AS count FROM review_attempts WHERE repo_id = ? AND pr_number = ? AND head_sha = ?`)
        .get(repo, head.prNumber, head.headSha)).count;
      const attemptId = id ?? ulid(at);
      db.prepare(`INSERT INTO review_attempts (attempt_id, repo_id, pr_number, head_sha, attempt_number, trigger, state, queued_at)
        VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`).run(attemptId, repo, head.prNumber, head.headSha, number, trigger, at);
      return this.queueAttempt(db.prepare(`${SELECT_ATTEMPT} WHERE a.attempt_id = ?`).get(attemptId));
    })();
  }

  async claimNext(owner: string, now: string, expiresAt: string): Promise<ReviewQueueClaim | null> {
    const db = this.sqlite.db;
    return db.transaction(() => {
      const row = db.prepare(`${SELECT_ATTEMPT} WHERE a.state = 'queued' AND EXISTS
        (SELECT 1 FROM review_heads h WHERE h.repo_id = a.repo_id AND h.pr_number = a.pr_number AND h.head_sha = a.head_sha AND h.state = 'active')
        AND NOT EXISTS (SELECT 1 FROM review_attempts running WHERE running.repo_id = a.repo_id AND running.pr_number = a.pr_number AND running.state = 'running')
        ORDER BY a.queued_at DESC, a.attempt_id DESC LIMIT 1`).get();
      if (!row) return null;
      const a = attemptRow.parse(row);
      db.prepare(`UPDATE review_attempts SET state = 'running', started_at = ?, lease_owner = ?, lease_expires_at = ?, heartbeat_at = ? WHERE attempt_id = ?`)
        .run(ms(now), owner, ms(expiresAt), ms(now), a.attempt_id);
      return { ...this.queueAttempt(row), lease: { owner, expiresAt } };
    })();
  }

  async heartbeat(attemptId: string, owner: string, now: string, expiresAt: string): Promise<boolean> {
    const db = this.sqlite.db;
    return db.transaction(() => db.prepare(`UPDATE review_attempts SET heartbeat_at = ?, lease_expires_at = ?
      WHERE attempt_id = ? AND state = 'running' AND lease_owner = ? AND lease_expires_at > ?`)
      .run(ms(now), ms(expiresAt), attemptId, owner, ms(now)).changes === 1)();
  }

  async release(attemptId: string, owner: string, status: 'succeeded' | 'partial' | 'failed' | 'superseded', now: string): Promise<boolean> {
    const db = this.sqlite.db;
    const state = status === 'succeeded' || status === 'partial' ? 'completed' : status === 'failed' ? 'failed' : 'cancelled';
    return db.transaction(() => db.prepare(`UPDATE review_attempts SET state = ?, result_status = ?, ended_at = ?, lease_owner = NULL, lease_expires_at = NULL
      WHERE attempt_id = ? AND state = 'running' AND lease_owner = ? AND lease_expires_at > ?`)
      .run(state, status, ms(now), attemptId, owner, ms(now)).changes === 1)();
  }

  async reconcileExpiredLeases(now: string): Promise<number> {
    const db = this.sqlite.db;
    return db.transaction(() => {
      const at = ms(now);
      const count = countRow.parse(db.prepare(`SELECT COUNT(*) AS count FROM review_attempts WHERE state = 'running' AND lease_expires_at <= ?`).get(at)).count;
      db.prepare(`UPDATE review_stages SET state = 'interrupted', ended_at = ?, error_summary = 'Lease expired'
        WHERE state = 'running' AND attempt_id IN (SELECT attempt_id FROM review_attempts WHERE state = 'running' AND lease_expires_at <= ?)`).run(at, at);
      db.prepare(`UPDATE review_attempts SET state = 'queued', started_at = NULL, ended_at = NULL, lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL
        WHERE state = 'running' AND lease_expires_at <= ? AND EXISTS
        (SELECT 1 FROM review_heads h WHERE h.repo_id = review_attempts.repo_id AND h.pr_number = review_attempts.pr_number
          AND h.head_sha = review_attempts.head_sha AND h.state = 'active')`).run(at);
      db.prepare(`UPDATE review_attempts SET state = 'cancelled', result_status = 'superseded', ended_at = ?, lease_owner = NULL, lease_expires_at = NULL
        WHERE state = 'running' AND lease_expires_at <= ?`).run(at, at);
      if (count) this.logger.info(`Reconciled ${count} expired review leases`);
      return count;
    })();
  }

  async getAttempt(attemptId: string): Promise<ReviewAttemptRecord | null> {
    const row = this.sqlite.db.prepare(`${SELECT_ATTEMPT} WHERE a.attempt_id = ?`).get(attemptId);
    if (!row) return null;
    const a = attemptRow.parse(row);
    return { attemptId: a.attempt_id, repoId: a.repo_id, prNumber: a.pr_number, headSha: a.head_sha, attemptNumber: a.attempt_number,
      trigger: a.trigger, state: a.state, queuedAt: new Date(a.queued_at).toISOString(), startedAt: iso(a.started_at), endedAt: iso(a.ended_at) };
  }

  async getStages(attemptId: string): Promise<ReviewStageRecord[]> {
    return this.sqlite.db.prepare(`SELECT * FROM review_stages WHERE attempt_id = ? ORDER BY ordinal, stage`).all(attemptId).map((row) => {
      const s = stageRow.parse(row);
      return { attemptId: s.attempt_id, stage: s.stage, ordinal: s.ordinal, state: s.state, startedAt: iso(s.started_at), endedAt: iso(s.ended_at),
        outcome: s.outcome, errorSummary: s.error_summary, artifactHash: s.artifact_hash, artifactPath: s.artifact_path };
    });
  }

  async saveStage(stage: ReviewStageRecord): Promise<void> {
    const db = this.sqlite.db;
    db.transaction(() => db.prepare(`INSERT INTO review_stages (attempt_id, stage, ordinal, state, started_at, ended_at, outcome, error_summary, artifact_hash, artifact_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(attempt_id, stage, ordinal) DO UPDATE SET state = excluded.state,
      started_at = excluded.started_at, ended_at = excluded.ended_at, outcome = excluded.outcome, error_summary = excluded.error_summary,
      artifact_hash = excluded.artifact_hash, artifact_path = excluded.artifact_path`)
      .run(stage.attemptId, stage.stage, stage.ordinal, stage.state, stage.startedAt ? ms(stage.startedAt) : null,
        stage.endedAt ? ms(stage.endedAt) : null, stage.outcome, stage.errorSummary, stage.artifactHash, stage.artifactPath))();
  }

  async saveCheckpoint(attemptId: string, stage: string, ordinal: number, data: unknown): Promise<void> {
    const db = this.sqlite.db;
    const payload = JSON.stringify(data);
    if (payload === undefined) throw new Error('Checkpoint must be JSON serializable');
    db.transaction(() => db.prepare(`INSERT INTO review_stages (attempt_id, stage, ordinal, state, outcome) VALUES (?, ?, ?, 'completed', ?)
      ON CONFLICT(attempt_id, stage, ordinal) DO UPDATE SET state = 'completed', outcome = excluded.outcome`)
      .run(attemptId, `checkpoint:${stage}`, ordinal, payload))();
  }

  async getCheckpoint(attemptId: string, stage: string, ordinal: number): Promise<unknown | null> {
    const row = this.sqlite.db.prepare(`SELECT outcome FROM review_stages WHERE attempt_id = ? AND stage = ? AND ordinal = ?`)
      .get(attemptId, `checkpoint:${stage}`, ordinal);
    const parsed = z.object({ outcome: z.string().nullable() }).safeParse(row);
    return parsed.success && parsed.data.outcome !== null ? JSON.parse(parsed.data.outcome) : null;
  }
}
