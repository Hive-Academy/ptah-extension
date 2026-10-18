import { inject, injectable } from 'tsyringe';
import type {
  SkillTelemetrySeam,
  SubagentRunTelemetry,
} from '@ptah-extension/lane-outcomes';

import {
  SkillInvocationEventStore,
  type SubagentRunRow,
} from '../skill-invocation-event.store';
import { SessionVerdictStore } from '../archaeology/session-verdict.store';

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
    @inject(SkillInvocationEventStore)
    private readonly events: Pick<
      SkillInvocationEventStore,
      'findSubagentRuns' | 'listSkillsForScopes'
    >,
    @inject(SessionVerdictStore)
    private readonly verdicts: SessionVerdictStore,
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
    const rows = this.events.findSubagentRuns(agentIds);
    const grouped = new Map<string, SubagentRunRow[]>();
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
    const eligible = scopes.filter(
      (scope) => !scope.runId.startsWith('subagent:'),
    );
    const skills = this.events.listSkillsForScopes(eligible);
    for (const scope of scopes) {
      // Nested subagent Skill hooks do not carry a proven session join (PB-3).
      if (scope.runId.startsWith('subagent:')) {
        result.set(scope.runId, null);
        continue;
      }
      result.set(scope.runId, skills.get(scope.runId) ?? []);
    }
    return result;
  }

  async sessionEvidence(
    sessionIds: readonly string[],
  ): Promise<ReadonlyMap<string, string | null>> {
    const result = new Map<string, string | null>();
    if (sessionIds.length === 0) return result;
    const ids = [...new Set(sessionIds)];
    for (const [
      sessionId,
      evidenceClass,
    ] of this.verdicts.evidenceClassForSessions(ids)) {
      result.set(sessionId, evidenceClass);
    }
    return result;
  }
}
