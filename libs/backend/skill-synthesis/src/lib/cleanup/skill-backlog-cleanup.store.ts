import { inject, injectable } from 'tsyringe';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import type {
  BacklogCleanupCandidate,
  BacklogCleanupCounters,
  BacklogCleanupRejection,
  BacklogCleanupState,
} from './skill-backlog-cleanup.types';

interface RawState {
  version: number;
  cutoff_created_at: number;
  cursor_created_at: number | null;
  cursor_id: string | null;
  started_at: number;
  finished_at: number | null;
  last_run_at: number | null;
  last_outcome: string | null;
  last_reason: string | null;
  examined: number;
  kept_evidence: number;
  kept_verdict: number;
  kept_degraded_verdict: number;
  rejected_no_evidence: number;
  rejected_transcript_unreadable: number;
  invocations_deleted: number;
}

interface RawCandidate {
  id: string;
  created_at: number;
  source_session_ids: string;
  workspace_root: string | null;
}

@injectable()
export class SkillBacklogCleanupStore {
  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  readState(): BacklogCleanupState | null {
    const raw = this.db
      .prepare(`SELECT * FROM skill_backlog_cleanup_state WHERE id = @id`)
      .get({ id: 1 }) as RawState | undefined;
    return raw ? this.toState(raw) : null;
  }

  initialize(version: number, now: number): BacklogCleanupState {
    this.inImmediateTransaction(() => {
      const updated = this.db
        .prepare(
          `UPDATE skill_backlog_cleanup_state
              SET version = @version, cutoff_created_at = @cutoffCreatedAt,
                  cursor_created_at = NULL, cursor_id = NULL,
                  started_at = @startedAt, finished_at = NULL,
                  last_run_at = @lastRunAt, last_outcome = @lastOutcome,
                  last_reason = @lastReason,
                  examined = 0, kept_evidence = 0, kept_verdict = 0,
                  kept_degraded_verdict = 0, rejected_no_evidence = 0,
                  rejected_transcript_unreadable = 0,
                  invocations_deleted = 0
            WHERE id = @id`,
        )
        .run({
          id: 1,
          version,
          cutoffCreatedAt: now,
          startedAt: now,
          lastRunAt: now,
          lastOutcome: 'started',
          lastReason: null,
        });
      if (Number(updated.changes) === 0) {
        this.db
          .prepare(
            `INSERT INTO skill_backlog_cleanup_state
               (id, version, cutoff_created_at, cursor_created_at, cursor_id,
                started_at, finished_at, last_run_at, last_outcome, last_reason,
                examined, kept_evidence, kept_verdict, kept_degraded_verdict,
                rejected_no_evidence, rejected_transcript_unreadable,
                invocations_deleted)
             VALUES
               (@id, @version, @cutoffCreatedAt, NULL, NULL,
                @startedAt, NULL, @lastRunAt, @lastOutcome, @lastReason,
                0, 0, 0, 0, 0, 0, 0)`,
          )
          .run({
            id: 1,
            version,
            cutoffCreatedAt: now,
            startedAt: now,
            lastRunAt: now,
            lastOutcome: 'started',
            lastReason: null,
          });
      }
    });
    return this.requireState();
  }

  pageCandidates(
    cutoff: number,
    cursorCreatedAt: number | null,
    cursorId: string | null,
    limit: number,
  ): BacklogCleanupCandidate[] {
    const rows = this.db
      .prepare(
        `SELECT id, created_at, source_session_ids, workspace_root
           FROM skill_candidates
          WHERE status = 'candidate'
            AND created_at < @cutoff
            AND (created_at, id) > (@cursorCreatedAt, @cursorId)
          ORDER BY created_at ASC, id ASC
          LIMIT @limit`,
      )
      .all({
        cutoff,
        cursorCreatedAt: cursorCreatedAt ?? -1,
        cursorId: cursorId ?? '',
        limit,
      }) as RawCandidate[];
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      sourceSessionIds: this.parseSessionIds(row.source_session_ids),
      workspaceRoot: row.workspace_root ?? null,
    }));
  }

  rejectBatch(rejections: readonly BacklogCleanupRejection[], now: number): number {
    if (rejections.length > 100) {
      throw new Error('skill backlog cleanup reject batch exceeds 100 rows');
    }
    return this.inImmediateTransaction(() => {
      const statement = this.db.prepare(
        `UPDATE skill_candidates
            SET status = 'rejected', rejected_at = @now,
                rejected_reason = @reason
          WHERE id = @id AND status = 'candidate'`,
      );
      let changed = 0;
      for (const rejection of rejections) {
        changed += Number(
          statement.run({ id: rejection.id, now, reason: rejection.reason })
            .changes,
        );
      }
      return changed;
    });
  }

  deleteFakeInvocations(limit: number): number {
    return this.inImmediateTransaction(() =>
      Number(
        this.db
          .prepare(
            `DELETE FROM skill_invocations
              WHERE rowid IN (
                SELECT rowid FROM skill_invocations
                 WHERE context_id IS NOT NULL LIMIT @limit
              )`,
          )
          .run({ limit }).changes,
      ),
    );
  }

  writeProgress(input: {
    cursorCreatedAt: number | null;
    cursorId: string | null;
    finishedAt: number | null;
    lastRunAt: number;
    lastOutcome: string;
    lastReason: string | null;
    counters: BacklogCleanupCounters;
  }): BacklogCleanupState {
    const {
      cursorCreatedAt,
      cursorId,
      finishedAt,
      lastRunAt,
      lastOutcome,
      lastReason,
      counters,
    } = input;
    const result = this.db
      .prepare(
        `UPDATE skill_backlog_cleanup_state
            SET cursor_created_at = @cursorCreatedAt, cursor_id = @cursorId,
                finished_at = @finishedAt, last_run_at = @lastRunAt,
                last_outcome = @lastOutcome, last_reason = @lastReason,
                examined = @examined, kept_evidence = @keptEvidence,
                kept_verdict = @keptVerdict,
                kept_degraded_verdict = @keptDegradedVerdict,
                rejected_no_evidence = @rejectedNoEvidence,
                rejected_transcript_unreadable = @rejectedTranscriptUnreadable,
                invocations_deleted = @invocationsDeleted
          WHERE id = @id`,
      )
      .run({
        id: 1,
        cursorCreatedAt,
        cursorId,
        finishedAt,
        lastRunAt,
        lastOutcome,
        lastReason,
        ...counters,
      });
    if (Number(result.changes) !== 1) {
      throw new Error('skill backlog cleanup state row is missing');
    }
    return this.requireState();
  }

  private requireState(): BacklogCleanupState {
    const state = this.readState();
    if (!state) throw new Error('skill backlog cleanup state row is missing');
    return state;
  }

  private parseSessionIds(json: string): string[] {
    try {
      const value = JSON.parse(json) as unknown;
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      // degradation-audit: optional-capability - a malformed historical source
      // session list contains no session that cleanup can inspect safely.
      return [];
    }
  }

  private toState(raw: RawState): BacklogCleanupState {
    return {
      version: raw.version,
      cutoffCreatedAt: raw.cutoff_created_at,
      cursorCreatedAt: raw.cursor_created_at,
      cursorId: raw.cursor_id,
      startedAt: raw.started_at,
      finishedAt: raw.finished_at,
      lastRunAt: raw.last_run_at,
      lastOutcome: raw.last_outcome,
      lastReason: raw.last_reason,
      examined: raw.examined,
      keptEvidence: raw.kept_evidence,
      keptVerdict: raw.kept_verdict,
      keptDegradedVerdict: raw.kept_degraded_verdict,
      rejectedNoEvidence: raw.rejected_no_evidence,
      rejectedTranscriptUnreadable: raw.rejected_transcript_unreadable,
      invocationsDeleted: raw.invocations_deleted,
    };
  }

  private inImmediateTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error: unknown) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
