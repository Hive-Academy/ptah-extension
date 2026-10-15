import { inject, injectable } from 'tsyringe';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import type {
  SkillTelemetrySeam,
  SubagentRunTelemetry,
} from '@ptah-extension/lane-outcomes';

interface RunRow {
  run_id: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  task_id: string | null;
  is_error: number;
  verdict_source: string | null;
}

const UNMATCHED: SubagentRunTelemetry = {
  match: 'unmatched',
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  durationMs: null,
  taskId: null,
  isError: null,
  specVerdictSource: null,
};

@injectable()
export class SkillTelemetrySeamAdapter implements SkillTelemetrySeam {
  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  async subagentRuns(
    runIds: readonly string[],
  ): Promise<ReadonlyMap<string, SubagentRunTelemetry>> {
    const result = new Map<string, SubagentRunTelemetry>();
    if (runIds.length === 0) return result;
    const ids = [...new Set(runIds)];
    const agentIds = ids.map((id) =>
      id.startsWith('subagent:') ? id.slice('subagent:'.length) : id,
    );
    const placeholders = agentIds.map(() => '?').join(',');
    const rows = this.connection.db
      .prepare(
        `SELECT run_id, input_tokens, output_tokens, cost_usd, duration_ms, task_id,
              is_error, verdict_source FROM skill_invocation_events
       WHERE source = 'subagent' AND run_id IN (${placeholders})`,
      )
      .all(...agentIds) as RunRow[];
    const grouped = new Map<string, RunRow[]>();
    for (const row of rows)
      grouped.set(row.run_id, [...(grouped.get(row.run_id) ?? []), row]);
    for (let i = 0; i < ids.length; i++) {
      const matches = grouped.get(agentIds[i]) ?? [];
      result.set(
        ids[i],
        matches.length === 1
          ? {
              match: 'matched',
              inputTokens: matches[0].input_tokens,
              outputTokens: matches[0].output_tokens,
              costUsd: matches[0].cost_usd,
              durationMs: matches[0].duration_ms,
              taskId: matches[0].task_id,
              isError: matches[0].is_error === 1,
              specVerdictSource: matches[0].verdict_source,
            }
          : {
              ...UNMATCHED,
              match: matches.length > 1 ? 'ambiguous' : 'unmatched',
            },
      );
    }
    return result;
  }

  async skillsLoaded(
    scopes: readonly {
      runId: string;
      sessionId: string;
      fromMs: number;
      toMs: number;
    }[],
  ): Promise<ReadonlyMap<string, readonly string[] | null>> {
    const result = new Map<string, readonly string[] | null>();
    for (const scope of scopes) {
      // Nested subagent Skill hooks do not carry a proven session join (PB-3).
      if (scope.runId.startsWith('subagent:')) {
        result.set(scope.runId, null);
        continue;
      }
      const rows = this.connection.db
        .prepare(
          `SELECT DISTINCT skill_slug FROM skill_invocation_events
         WHERE source IN ('tool-use', 'prompt-expansion') AND session_id = ?
           AND invoked_at BETWEEN ? AND ? ORDER BY skill_slug`,
        )
        .all(scope.sessionId, scope.fromMs, scope.toMs) as Array<{
        skill_slug: string;
      }>;
      result.set(
        scope.runId,
        rows.map((row) => row.skill_slug),
      );
    }
    return result;
  }

  async sessionEvidence(
    sessionIds: readonly string[],
  ): Promise<ReadonlyMap<string, string | null>> {
    const result = new Map<string, string | null>();
    if (sessionIds.length === 0) return result;
    const ids = [...new Set(sessionIds)];
    const rows = this.connection.db
      .prepare(
        `SELECT session_id, evidence_class FROM skill_session_verdicts
       WHERE session_id IN (${ids.map(() => '?').join(',')})`,
      )
      .all(...ids) as Array<{
      session_id: string;
      evidence_class: string | null;
    }>;
    for (const row of rows) result.set(row.session_id, row.evidence_class);
    return result;
  }
}
