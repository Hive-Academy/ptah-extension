import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import { z } from 'zod';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import type { SubagentRunMetrics, ScorecardAggregate } from './types';

const EventIdRowSchema = z.object({ id: z.string() });

const ScorecardAggregateRowSchema = z.object({
  slug: z.string(),
  total: z.number().nullable(),
  graded: z.number().nullable(),
  graded_succeeded: z.number().nullable(),
  avg_input: z.number().nullable(),
  sum_input: z.number().nullable(),
  avg_output: z.number().nullable(),
  sum_output: z.number().nullable(),
  avg_cache_read: z.number().nullable(),
  avg_cost: z.number().nullable(),
  avg_duration: z.number().nullable(),
  avg_tools: z.number().nullable(),
});

const SubagentRunRowSchema = z.object({
  run_id: z.string(),
  input_tokens: z.number().nullable(),
  output_tokens: z.number().nullable(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().nullable(),
  task_id: z.string().nullable(),
  is_error: z.union([z.literal(0), z.literal(1)]),
  verdict_source: z.string().nullable(),
});

export type SubagentRunRow = z.infer<typeof SubagentRunRowSchema>;

const SkillScopeRowSchema = z.object({
  session_id: z.string(),
  invoked_at: z.number(),
  skill_slug: z.string(),
});

const SkillUsageStatsRowSchema = z.object({
  invocationCount: z.number(),
  distinctContexts: z.number(),
});

export interface NewSkillInvocationEvent {
  skillSlug: string;
  sessionId: string;
  workspaceRoot?: string | null;
  contextId: string | null;
  source: string;
  succeeded?: boolean | null;
  isError: boolean;
  invokedAt: number;
  metrics?: SubagentRunMetrics | null;
  taskId?: string | null;
  runId?: string | null;
}

@injectable()
export class SkillInvocationEventStore {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  recordSkillEvent(input: NewSkillInvocationEvent): void {
    const metrics = input.metrics ?? null;
    this.db.prepare(
      `INSERT INTO skill_invocation_events
         (id, skill_slug, session_id, context_id, source, succeeded, is_error, invoked_at,
          input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
          cost_usd, duration_ms, tool_count, task_id, workspace_root, run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ulid(), input.skillSlug, input.sessionId, input.contextId, input.source,
      input.succeeded == null ? null : input.succeeded ? 1 : 0,
      input.isError ? 1 : 0, input.invokedAt,
      metrics?.inputTokens ?? null, metrics?.outputTokens ?? null,
      metrics?.cacheReadTokens ?? null, metrics?.cacheCreationTokens ?? null,
      metrics?.costUsd ?? null, metrics?.durationMs ?? null,
      metrics?.toolCount ?? null, input.taskId ?? null,
      input.workspaceRoot ?? null, input.runId ?? null,
    );
  }

  getUsageStats(slug: string): { invocationCount: number; distinctContexts: number } {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS invocationCount,
              COUNT(DISTINCT context_id) AS distinctContexts
       FROM skill_invocation_events WHERE skill_slug = ?`,
    ).get(slug);
    return SkillUsageStatsRowSchema.parse(row);
  }

  findSubagentRuns(agentIds: readonly string[]): SubagentRunRow[] {
    if (agentIds.length === 0) return [];
    const rows = this.db.prepare(
      `SELECT run_id, input_tokens, output_tokens, cost_usd, duration_ms, task_id,
              is_error, verdict_source FROM skill_invocation_events
       WHERE source = 'subagent' AND run_id IN (${agentIds.map(() => '?').join(',')})`,
    ).all(...agentIds);
    const valid: SubagentRunRow[] = [];
    for (const row of rows) {
      const parsed = SubagentRunRowSchema.safeParse(row);
      if (parsed.success) valid.push(parsed.data);
      else this.logger.warn('[skill-synthesis] invalid subagent invocation row');
    }
    return valid;
  }

  listSkillsForScopes(scopes: readonly {
    runId: string;
    sessionId: string;
    fromMs: number;
    toMs: number;
  }[]): ReadonlyMap<string, readonly string[]> {
    const skills = new Map<string, Set<string>>(
      scopes.map((scope) => [scope.runId, new Set<string>()]),
    );
    for (let start = 0; start < scopes.length; start += 100) {
      const batch = scopes.slice(start, start + 100);
      const conditions = batch.map(() => '(session_id = ? AND invoked_at BETWEEN ? AND ?)').join(' OR ');
      const params = batch.flatMap((scope) => [scope.sessionId, scope.fromMs, scope.toMs]);
      const rows = this.db.prepare(
        `SELECT DISTINCT session_id, invoked_at, skill_slug FROM skill_invocation_events
         WHERE source IN ('tool-use', 'prompt-expansion', 'slash-command') AND (${conditions})`,
      ).all(...params);
      for (const row of rows) {
        const parsed = SkillScopeRowSchema.safeParse(row);
        if (!parsed.success) {
          this.logger.warn('[skill-synthesis] invalid skill invocation row');
          continue;
        }
        const { session_id, invoked_at, skill_slug } = parsed.data;
        for (const scope of batch) {
          if (scope.sessionId === session_id && invoked_at >= scope.fromMs && invoked_at <= scope.toMs) {
            skills.get(scope.runId)?.add(skill_slug);
          }
        }
      }
    }
    return new Map([...skills].map(([runId, slugs]) => [runId, [...slugs].sort()]));
  }

  getDominantSkillSlugForSessions(sessionIds: readonly string[]): string | null {
    if (sessionIds.length === 0) return null;
    const placeholders = sessionIds.map(() => '?').join(', ');
    const row = this.db.prepare(
      `SELECT skill_slug, COUNT(*) AS c FROM skill_invocation_events
       WHERE session_id IN (${placeholders}) GROUP BY skill_slug ORDER BY c DESC LIMIT 1`,
    ).get(...sessionIds) as { skill_slug: string; c: number } | undefined;
    return row?.skill_slug || null;
  }

  getRecentSessionsForSlug(slug: string, limit = 5): string[] {
    const rows = this.db.prepare(
      `SELECT session_id, MAX(invoked_at) AS last_at FROM skill_invocation_events
       WHERE skill_slug = ? GROUP BY session_id ORDER BY last_at DESC LIMIT ?`,
    ).all(slug, limit) as Array<{ session_id: string }>;
    return rows.map((row) => row.session_id).filter((id) => id.length > 0);
  }

  /**
   * Reconcile a single un-reconciled subagent invocation event for a slug
   * against a graded verdict harvested from `.ptah/specs`. One batch verdict
   * flips at most one row (cardinality parity), using two ordered passes:
   *
   *  1. **Exact pass** — the newest un-reconciled `source='subagent'` row whose
   *     `task_id` equals the spec's task id, IGNORING the time window. Uses
   *     `idx_skill_inv_events_task` (no full-table scan). Provenance is the
   *     caller-supplied `verdictSource` (base `spec:TASK_X`). This is the
   *     precise attribution that survives concurrent same-slug runs.
   *  2. **Window fallback** — only when the exact pass matched nothing: the
   *     newest un-reconciled row inside [windowStart, windowEnd] that has NO
   *     `task_id` (`task_id IS NULL`), so a stamped concurrent event is never
   *     stolen by another task's window. Provenance is rewritten to
   *     `spec-window:TASK_X` so the heuristic attribution is auditable.
   *
   * Idempotent: the `reconciled_at IS NULL` guard means re-running a harvest
   * never double-flips a row. Returns true when a row was updated, false when
   * no eligible event existed (e.g. telemetry never recorded the run).
   */
  reconcileSubagentEvent(input: {
    slug: string;
    taskId: string;
    succeeded: boolean;
    isError?: boolean;
    windowStart: number;
    windowEnd: number;
    verdictSource: string;
    reconciledAt: number;
  }): boolean {
    const exact = EventIdRowSchema.safeParse(this.db
      .prepare(
        `SELECT id FROM skill_invocation_events
         WHERE skill_slug = ?
           AND source = 'subagent'
           AND task_id = ?
           AND reconciled_at IS NULL
         ORDER BY invoked_at DESC
         LIMIT 1`,
      )
      .get(input.slug, input.taskId));
    if (exact.success) {
      this.applyReconciliation(exact.data.id, input, input.verdictSource);
      return true;
    }

    const fallback = EventIdRowSchema.safeParse(this.db
      .prepare(
        `SELECT id FROM skill_invocation_events
         WHERE skill_slug = ?
           AND source = 'subagent'
           AND task_id IS NULL
           AND reconciled_at IS NULL
           AND invoked_at BETWEEN ? AND ?
         ORDER BY invoked_at DESC
         LIMIT 1`,
      )
      .get(input.slug, input.windowStart, input.windowEnd));
    if (!fallback.success) return false;

    this.applyReconciliation(
      fallback.data.id,
      input,
      this.toWindowVerdictSource(input.verdictSource),
    );
    return true;
  }

  private applyReconciliation(
    eventId: string,
    input: { succeeded: boolean; isError?: boolean; reconciledAt: number },
    verdictSource: string,
  ): void {
    if (input.isError === undefined) {
      this.db
        .prepare(
          `UPDATE skill_invocation_events
           SET succeeded = ?, reconciled_at = ?, verdict_source = ?
           WHERE id = ?`,
        )
        .run(input.succeeded ? 1 : 0, input.reconciledAt, verdictSource, eventId);
      return;
    }
    this.db
      .prepare(
        `UPDATE skill_invocation_events
         SET succeeded = ?, is_error = ?, reconciled_at = ?, verdict_source = ?
         WHERE id = ?`,
      )
      .run(
        input.succeeded ? 1 : 0,
        input.isError ? 1 : 0,
        input.reconciledAt,
        verdictSource,
        eventId,
      );
  }

  /** Rewrite a base `spec:TASK_X` provenance to the heuristic `spec-window:` form. */
  private toWindowVerdictSource(verdictSource: string): string {
    return verdictSource.startsWith('spec:')
      ? `spec-window:${verdictSource.slice('spec:'.length)}`
      : verdictSource;
  }


  /**
   * Batched scorecard aggregation for the Library view. ONE `GROUP BY
   * skill_slug` pass over `source='subagent'` rows for the requested slugs.
   * Returns a Map keyed by EVERY requested slug: slugs with no rows get a
   * typed zero/null aggregate (never omitted, never an error). Token/cost/
   * duration/tool averages and sums are NULL-excluding by SQL semantics — a
   * usage-less provider's all-null row is ignored, not counted as zero (R1.2).
   * Empty slug list → empty Map.
   */
  getScorecardAggregates(
    slugs: readonly string[],
  ): Map<string, ScorecardAggregate> {
    const result = new Map<string, ScorecardAggregate>();
    if (slugs.length === 0) return result;
    // Seed every requested slug with a zero aggregate so no-data slugs are
    // always present and well-typed.
    for (const slug of slugs) {
      result.set(slug, this.emptyScorecardAggregate(slug));
    }
    const placeholders = slugs.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT skill_slug AS slug,
                COUNT(*)                                                   AS total,
                SUM(CASE WHEN reconciled_at IS NOT NULL THEN 1 ELSE 0 END) AS graded,
                SUM(CASE WHEN reconciled_at IS NOT NULL AND succeeded = 1
                         THEN 1 ELSE 0 END)                               AS graded_succeeded,
                AVG(input_tokens)       AS avg_input,
                SUM(input_tokens)       AS sum_input,
                AVG(output_tokens)      AS avg_output,
                SUM(output_tokens)      AS sum_output,
                AVG(cache_read_tokens)  AS avg_cache_read,
                AVG(cost_usd)           AS avg_cost,
                AVG(duration_ms)        AS avg_duration,
                AVG(tool_count)         AS avg_tools
         FROM skill_invocation_events
         WHERE source = 'subagent' AND skill_slug IN (${placeholders})
         GROUP BY skill_slug`,
      )
      .all(...slugs).map((row) => ScorecardAggregateRowSchema.parse(row));
    for (const r of rows) {
      result.set(r.slug, {
        slug: r.slug,
        total: r.total ?? 0,
        graded: r.graded ?? 0,
        gradedSucceeded: r.graded_succeeded ?? 0,
        avgInputTokens: r.avg_input,
        avgOutputTokens: r.avg_output,
        avgCacheReadTokens: r.avg_cache_read,
        totalInputTokens: r.sum_input,
        totalOutputTokens: r.sum_output,
        avgCostUsd: r.avg_cost,
        avgDurationMs: r.avg_duration,
        avgToolCount: r.avg_tools,
      });
    }
    return result;
  }


  private emptyScorecardAggregate(slug: string): ScorecardAggregate {
    return {
      slug,
      total: 0,
      graded: 0,
      gradedSucceeded: 0,
      avgInputTokens: null,
      avgOutputTokens: null,
      avgCacheReadTokens: null,
      totalInputTokens: null,
      totalOutputTokens: null,
      avgCostUsd: null,
      avgDurationMs: null,
      avgToolCount: null,
    };
  }

}
