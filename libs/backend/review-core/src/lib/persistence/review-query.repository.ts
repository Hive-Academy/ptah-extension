import { inject, injectable } from 'tsyringe';
import { basename } from 'node:path';
import { z } from 'zod';
import { PERSISTENCE_TOKENS, SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { RepoIdentitySchema, ReviewFindingSchema, ReviewRunSchema, ReviewRpcSchemas, type ReviewFinding, type ReviewRun } from '@ptah-extension/review-contracts';

export interface IReviewQueryRepository {
  listRuns(input: z.input<typeof ReviewRpcSchemas['review:listRuns']['params']>): Promise<z.output<typeof ReviewRpcSchemas['review:listRuns']['result']>>;
  getRun(attemptId: string): Promise<ReviewRun | null>;
  listFindings(attemptId: string): Promise<ReviewFinding[]>;
}

const rowSchema = z.object({ attempt_id: z.string(), owner: z.string(), name: z.string(), pr_number: z.number(),
  head_sha: z.string(), trigger: z.enum(['automatic', 'manual']), state: z.string(), queued_at: z.number(),
  started_at: z.number().nullable(), ended_at: z.number().nullable(), deadline_at: z.number().nullable(),
  config_snapshot_hash: z.string().nullable(), result_status: z.enum(['succeeded', 'partial', 'failed', 'superseded']).nullable(),
  failure_stage: z.string().nullable().optional(), failure_code: z.string().nullable().optional(), failure_message: z.string().nullable().optional(),
  failure_count: z.number().optional(), next_eligible_at: z.number().nullable().optional() });
const stageSchema = z.object({ stage: z.string(), state: z.string(), outcome: z.string().nullable(), family: z.string().nullable(), scope: z.string().nullable(),
  started_at: z.number().nullable(), ended_at: z.number().nullable(), error_summary: z.string().nullable(), artifact_path: z.string().nullable() });
const findingSchema = z.object({ payload_json: z.string() });
const coverageSchema = z.object({ coverage: z.array(z.string().min(1).max(256)).max(100) });
const checkpointSchema = z.object({ outcome: z.string().nullable() });
const pollRowSchema = z.object({ poll_status: z.enum(['succeeded', 'failed']).nullable(), poll_error: z.string().nullable(),
  last_success_at: z.number().nullable(), last_error_at: z.number().nullable() });
const iso = (value: number): string => new Date(value).toISOString();
const redact = (value: string): string => value
  .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, '[REDACTED]')
  .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, '[REDACTED]')
  .replace(/\b(authorization|x-api-key|api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
const SELECT = `SELECT a.*, r.owner, r.name, h.failure_count, h.next_eligible_at FROM review_attempts a
  JOIN review_repositories r ON r.repo_id = a.repo_id
  LEFT JOIN review_heads h ON h.repo_id = a.repo_id AND h.pr_number = a.pr_number AND h.head_sha = a.head_sha`;

@injectable()
export class ReviewQueryRepository implements IReviewQueryRepository {
  constructor(@inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION) private readonly sqlite: SqliteConnectionService) {}

  private mapRun(raw: unknown): ReviewRun {
    const row = rowSchema.parse(raw);
    const checkpoint = this.sqlite.db.prepare(`SELECT outcome FROM review_stages WHERE attempt_id = ? AND stage = 'checkpoint:context' AND ordinal = 0`)
      .get(row.attempt_id);
    const outcome = checkpoint ? checkpointSchema.parse(checkpoint).outcome : null;
    const coverage = outcome === null ? null : coverageSchema.parse(JSON.parse(outcome)).coverage;
    const stages = this.sqlite.db.prepare(`SELECT stage, state, outcome, family, scope, started_at, ended_at, error_summary, artifact_path
      FROM review_stages WHERE attempt_id = ? AND stage NOT LIKE 'checkpoint:%' ORDER BY started_at, ordinal LIMIT 16`).all(row.attempt_id)
      .map((value) => {
        const stage = stageSchema.parse(value);
        const status = stage.outcome === 'partial' ? 'partial' : stage.state === 'completed' ? 'succeeded' : stage.state === 'cancelled' ? 'superseded' : stage.state;
        const lens = stage.stage.startsWith('lens:') ? stage.stage.slice(5) : null;
        return { name: lens === null ? stage.stage : 'lenses', status, family: stage.family,
          scope: lens ?? stage.scope,
          durationMs: stage.started_at !== null && stage.ended_at !== null ? Math.max(0, stage.ended_at - stage.started_at) : null,
          error: stage.error_summary === null ? null : lens === null ? 'Review stage failed' : stage.error_summary,
          artifactPath: stage.artifact_path ? basename(stage.artifact_path) : null };
      });
    const status = row.result_status ?? (row.state === 'cancelled' ? 'superseded' : row.state);
    if (status === 'completed') throw new Error('Review result status unavailable');
    return ReviewRunSchema.parse({ repo: RepoIdentitySchema.parse({ owner: row.owner, name: row.name }),
      prNumber: row.pr_number, headSha: row.head_sha, attemptId: row.attempt_id,
      trigger: row.trigger === 'automatic' ? 'poll' : 'manual',
      configHash: row.config_snapshot_hash,
      status, createdAt: iso(row.queued_at), startedAt: row.started_at === null ? null : iso(row.started_at),
      failure: row.failure_stage && row.failure_code && row.failure_message ? { stage: row.failure_stage, code: row.failure_code, message: row.failure_message } : null,
      headRetry: row.failure_count === undefined ? null : { failureCount: row.failure_count,
        nextEligibleAt: row.next_eligible_at == null ? null : iso(row.next_eligible_at), automaticRetriesStopped: row.failure_count >= 3 },
      completedAt: row.ended_at === null ? null : iso(row.ended_at),
      deadlineAt: row.deadline_at === null ? null : iso(row.deadline_at),
      coverage: coverage ?? [], stages });
  }

  async listRuns(raw: z.input<typeof ReviewRpcSchemas['review:listRuns']['params']>): Promise<z.output<typeof ReviewRpcSchemas['review:listRuns']['result']>> {
    const input = ReviewRpcSchemas['review:listRuns'].params.parse(raw);
    const cursor = input.cursor ? z.string().regex(/^\d+:[A-Za-z0-9_-]{1,64}$/).parse(input.cursor).split(':') : null;
    const cursorTime = cursor ? Number(cursor[0]) : null;
    if (cursorTime !== null && !Number.isSafeInteger(cursorTime)) throw new Error('Invalid review cursor');
    const storageState = input.state === 'queued' || input.state === 'running' || input.state === 'interrupted' ? input.state : null;
    const rows = this.sqlite.db.prepare(`${SELECT} WHERE (? IS NULL OR (r.owner = ? AND r.name = ?))
      AND (? IS NULL OR a.state = ? OR a.result_status = ?)
      AND (? IS NULL OR a.queued_at < ? OR (a.queued_at = ? AND a.attempt_id < ?))
      ORDER BY a.queued_at DESC, a.attempt_id DESC LIMIT ?`).all(
      input.repo?.owner ?? null, input.repo?.owner ?? null, input.repo?.name ?? null,
      input.state ?? null, storageState, input.state ?? null,
      cursorTime, cursorTime, cursorTime, cursor?.[1] ?? null,
      input.limit + 1);
    const page = rows.slice(0, input.limit);
    const last = page.length ? rowSchema.parse(page[page.length - 1]) : null;
    const pollRaw = this.sqlite.db.prepare(`SELECT r.poll_status, r.poll_error, p.last_success_at, p.last_error_at
      FROM review_repositories r LEFT JOIN review_poll_state p ON p.repo_id = r.repo_id
      WHERE (? IS NULL AND r.enabled = 1) OR (lower(r.owner) = lower(?) AND lower(r.name) = lower(?))
      ORDER BY CASE WHEN r.poll_status = 'failed' THEN 0 ELSE 1 END,
        COALESCE(p.last_error_at, p.last_success_at, r.last_poll_at, 0) DESC LIMIT 1`)
      .get(input.repo?.owner ?? null, input.repo?.owner ?? '', input.repo?.name ?? '');
    const poll = pollRaw ? pollRowSchema.parse(pollRaw) : null;
    return ReviewRpcSchemas['review:listRuns'].result.parse({ runs: page.map((row) => this.mapRun(row)),
      nextCursor: rows.length > input.limit && last ? `${last.queued_at}:${last.attempt_id}` : null,
      poll: { status: poll?.poll_status ?? null, error: poll?.poll_error ?? null,
        lastSuccessAt: poll?.last_success_at == null ? null : iso(poll.last_success_at),
        lastErrorAt: poll?.last_error_at == null ? null : iso(poll.last_error_at) } });
  }

  async getRun(attemptId: string): Promise<ReviewRun | null> {
    const id = ReviewRpcSchemas['review:getRun'].params.parse({ attemptId }).attemptId;
    const row = this.sqlite.db.prepare(`${SELECT} WHERE a.attempt_id = ?`).get(id);
    return row ? this.mapRun(row) : null;
  }

  async listFindings(attemptId: string): Promise<ReviewFinding[]> {
    const id = ReviewRpcSchemas['review:listFindings'].params.parse({ attemptId }).attemptId;
    const rows = this.sqlite.db.prepare(`SELECT f.payload_json FROM review_findings f JOIN review_finding_events e ON e.finding_id = f.finding_id
      WHERE e.attempt_id = ? AND e.kind = 'accepted' ORDER BY f.created_at, f.finding_id LIMIT 101`).all(id);
    if (rows.length > 100) throw new Error('Review finding limit exceeded');
    return rows.map((raw) => {
      const payload = findingSchema.parse(raw).payload_json;
      if (!payload) throw new Error('Review finding payload unavailable');
      return ReviewFindingSchema.parse(JSON.parse(payload, (_key, value: unknown) =>
        typeof value === 'string' ? redact(value) : value));
    });
  }
}
