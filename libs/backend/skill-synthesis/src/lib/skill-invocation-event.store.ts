import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import { z } from 'zod';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import type { SubagentRunMetrics } from './types';

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
}
