import type {
  AgentOutcomeSignals,
  LaneOutcomeReader as LaneOutcomeReaderPort,
  LaneOutcomeRecord,
  LaneOutcomeSummary,
} from '@ptah-extension/shared';
import { computeAgentSignals } from './agent-signals';
import type { LaneOutcomeLogger } from './lane-outcome-logger';
import type {
  SkillTelemetrySeam,
  SubagentRunTelemetry,
} from './skill-telemetry-seam.port';
import type {
  LaneOutcomeRow,
  LaneOutcomeStore,
} from './store/lane-outcome.store';
import { applySubagentJoin } from './subagent-join';

const READ_LIMIT = 2000;

export interface LaneOutcomeQueries extends LaneOutcomeReaderPort {
  agentSignals(
    slugs: readonly string[],
    windowDays: number,
  ): Promise<Record<string, AgentOutcomeSignals>>;
  get(runId: string): Promise<LaneOutcomeRecord | null>;
}

export class LaneOutcomeReader implements LaneOutcomeQueries {
  constructor(
    private readonly store: LaneOutcomeStore,
    private readonly logger: LaneOutcomeLogger,
    private readonly seam?: SkillTelemetrySeam,
  ) {}

  isPersistent(): boolean {
    return this.store.isPersistent();
  }

  async recentOutcomes(
    laneId: string,
    window: { readonly sinceMs: number },
  ): Promise<readonly LaneOutcomeSummary[]> {
    try {
      const rows = await this.store.listByLane(laneId, window.sinceMs);
      if (rows.length > READ_LIMIT)
        this.logger.warn('Outcome read capped', { laneId, count: rows.length });
      return (await this.join(rows.slice(0, READ_LIMIT))).sort(
        (a, b) => b.endedAt - a.endedAt,
      );
    } catch (error: unknown) {
      // degradation-audit: reported - the routing read port requires a resolved empty result after a logged store failure.
      this.logger.warn('Outcome read failed', {
        laneId,
        code: error instanceof Error ? error.name : 'UNKNOWN',
      });
      return [];
    }
  }

  async agentSignals(
    slugs: readonly string[],
    windowDays: number,
  ): Promise<Record<string, AgentOutcomeSignals>> {
    if (!Number.isFinite(windowDays) || windowDays <= 0)
      throw new Error('Invalid outcome window');
    const unique = [...new Set(slugs)];
    const rows = await this.store.listByRoles(
      unique,
      Date.now() - windowDays * 86400000,
    );
    if (rows.length > READ_LIMIT)
      this.logger.warn('Outcome signals capped', { count: rows.length });
    const signals = computeAgentSignals(
      await this.join(rows.slice(0, READ_LIMIT)),
      windowDays,
    );
    for (const slug of unique) {
      signals[slug] ??= {
        slug,
        windowDays,
        runCount: 0,
        delivered: { numerator: 0, denominator: 0 },
        reviewPass: { numerator: 0, denominator: 0 },
        avgReviseRounds: null,
        topFailureClass: null,
      };
    }
    return signals;
  }

  async get(runId: string): Promise<LaneOutcomeRecord | null> {
    const row = await this.store.get(runId);
    return row ? ((await this.join([row]))[0] ?? null) : null;
  }

  private async join(
    rows: readonly LaneOutcomeRow[],
  ): Promise<LaneOutcomeRecord[]> {
    const subagents = rows.filter((row) => row.executorKind === 'subagent');
    if (!subagents.length) return [...rows];
    if (!this.seam)
      return rows.map((row) =>
        row.executorKind === 'subagent'
          ? applySubagentJoin(row, null, false)
          : row,
      );
    let telemetry: ReadonlyMap<string, SubagentRunTelemetry>;
    let skills: ReadonlyMap<string, readonly string[] | null>;
    let evidence: ReadonlyMap<string, string | null>;
    try {
      [telemetry, skills, evidence] = await Promise.all([
        this.seam.subagentRuns(subagents.map((row) => row.runId)),
        this.seam.skillsLoaded(
          subagents.flatMap((row) =>
            row.subagentSessionId
              ? [
                  {
                    runId: row.runId,
                    sessionId: row.subagentSessionId,
                    fromMs: row.startedAt ?? 0,
                    toMs: row.endedAt,
                  },
                ]
              : [],
          ),
        ),
        this.seam.sessionEvidence(
          subagents.flatMap((row) =>
            row.subagentSessionId ? [row.subagentSessionId] : [],
          ),
        ),
      ]);
    } catch (error: unknown) {
      this.logger.warn('Outcome telemetry join failed', {
        code: error instanceof Error ? error.name : 'UNKNOWN',
      });
      return rows.map((row) =>
        row.executorKind === 'subagent'
          ? applySubagentJoin(row, null, false)
          : row,
      );
    }
    return rows.map((row) =>
      row.executorKind === 'subagent'
        ? {
            ...applySubagentJoin(row, telemetry.get(row.runId) ?? null),
            skillsLoaded: skills.get(row.runId) ?? null,
            sessionEvidenceClass: row.subagentSessionId
              ? (evidence.get(row.subagentSessionId) ?? null)
              : null,
          }
        : row,
    );
  }
}
