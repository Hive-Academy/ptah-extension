export interface SubagentRunTelemetry {
  readonly match: 'matched' | 'unmatched' | 'ambiguous';
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsd: number | null;
  readonly durationMs: number | null;
  readonly taskId: string | null;
  readonly isError: boolean | null;
  readonly specVerdictSource: string | null;
}

export interface SkillTelemetrySeam {
  subagentRuns(
    runIds: readonly string[],
  ): Promise<ReadonlyMap<string, SubagentRunTelemetry>>;
  skillsLoaded(
    scopes: readonly {
      runId: string;
      sessionId: string;
      fromMs: number;
      toMs: number;
    }[],
  ): Promise<ReadonlyMap<string, readonly string[] | null>>;
  sessionEvidence(
    sessionIds: readonly string[],
  ): Promise<ReadonlyMap<string, string | null>>;
}
