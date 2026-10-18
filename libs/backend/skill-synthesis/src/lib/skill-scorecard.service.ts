/**
 * Composes invocation counts and metrics with task-grade verdicts for Library
 * scorecards. Only skill_task_grades supplies rates and recent verdicts.
 *
 * Findings are loaded on demand for the expanded detail view.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  AgentScorecard,
  ScorecardInvocationRow,
  SkillSynthesisGetScorecardDetailResult,
} from '@ptah-extension/shared';
import { SKILL_SYNTHESIS_TOKENS } from './di/tokens';
import {
  SkillCandidateStore,
  type SkillWinRate,
} from './skill-candidate.store';
import { SkillTaskGradeStore, type SkillTaskGradeAggregate } from './skill-task-grade.store';
import {
  SPEC_FINDINGS_TOKEN,
  type SpecFindingsPort,
} from './spec-findings.port';
import type { ScorecardAggregate } from './types';

/** Recent-verdict cap surfaced on each card (D9). */
const MAX_RECENT_VERDICTS = 5;
/** Default and hard cap on graded rows returned by the detail view. */
const DEFAULT_DETAIL_LIMIT = 20;
const MAX_DETAIL_LIMIT = 100;
/** Findings excerpt cap — mirrors the harvester's MAX_FINDINGS_CHARS (R8.3). */
const MAX_FINDINGS_CHARS = 4000;

@injectable()
export class SkillScorecardService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE)
    private readonly store: SkillCandidateStore,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_TASK_GRADE_STORE)
    private readonly grades: SkillTaskGradeStore,
    @inject(SPEC_FINDINGS_TOKEN, { isOptional: true })
    private readonly findings: SpecFindingsPort | null,
  ) {}

  /**
   * Batched scorecards for every visible agent-clone slug. One aggregate pass;
   * a slug is only hit with a verdict query when it has graded events.
   */
  getScorecards(slugs: readonly string[]): Record<string, AgentScorecard> {
    const scorecards: Record<string, AgentScorecard> = {};
    if (slugs.length === 0) return scorecards;
    try {
      const aggregates = this.store.getScorecardAggregates(slugs);
      const grades = this.grades.getAggregates('agent', slugs);
      for (const [slug, aggregate] of aggregates) {
        const grade = grades.get(slug) ?? { graded: 0, passed: 0, successRate: null };
        const recentVerdicts =
          grade.graded > 0 ? this.buildRecentVerdicts(slug) : [];
        scorecards[slug] = this.toScorecard(aggregate, grade, recentVerdicts);
      }
      return scorecards;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('[skill-synthesis] getScorecards failed', {
        error: message,
        slugCount: slugs.length,
      });
      // Degrade to typed empty scorecards rather than throwing.
      for (const slug of slugs) {
        scorecards[slug] = this.emptyScorecard(slug);
      }
      return scorecards;
    }
  }

  /**
   * Per-slug task-grade rate. Null means no grade; zero means graded failure.
   * Invocation counts still come from telemetry. Store failure returns unmeasured.
   */
  getWinRates(slugs: readonly string[]): Record<string, SkillWinRate> {
    const rates: Record<string, SkillWinRate> = {};
    if (slugs.length === 0) return rates;
    for (const slug of slugs) {
      rates[slug] = unmeasuredWinRate(slug);
    }
    try {
      const grades = this.grades.getAggregates('agent', slugs);
      const aggregates = this.store.getScorecardAggregates(slugs);
      for (const slug of slugs) {
        const grade = grades.get(slug);
        const total = aggregates.get(slug)?.total ?? 0;
        rates[slug] = {
          slug,
          invocations: total,
          wins: grade?.passed ?? 0,
          unknown: Math.max(0, total - (grade?.graded ?? 0)),
          winRate: grade?.successRate ?? null,
        };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('[skill-synthesis] getWinRates failed', {
        error: message,
        slugCount: slugs.length,
      });
    }
    return rates;
  }

  /**
   * Lazy detail for a single expanded card: recent graded rows plus a truncated
   * findings excerpt (detail-only, re-read from disk).
   */
  async getScorecardDetail(
    slug: string,
    limit?: number,
  ): Promise<SkillSynthesisGetScorecardDetailResult> {
    if (!slug) {
      return { slug, rows: [], findingsExcerpt: null };
    }
    const effectiveLimit = this.clampDetailLimit(limit);
    let rows: ScorecardInvocationRow[] = [];
    try {
      rows = this.grades.listRecent('agent', slug, effectiveLimit)
        .map((r) => this.toInvocationRow(r));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('[skill-synthesis] scorecard detail rows failed', {
        error: message,
        slug,
      });
      rows = [];
    }

    const findingsExcerpt = await this.readFindings(slug);
    return { slug, rows, findingsExcerpt };
  }

  private buildRecentVerdicts(slug: string): AgentScorecard['recentVerdicts'] {
    return this.grades
      .listRecent('agent', slug, MAX_RECENT_VERDICTS)
      .map((r) => ({
        taskId: r.taskId,
        succeeded: r.verdict === 'pass',
        reconciledAt: r.gradedAt,
      }));
  }

  private toScorecard(
    aggregate: ScorecardAggregate,
    grade: SkillTaskGradeAggregate,
    recentVerdicts: AgentScorecard['recentVerdicts'],
  ): AgentScorecard {
    return {
      slug: aggregate.slug,
      totalInvocations: aggregate.total,
      gradedCount: grade.graded,
      gradedSuccessRate: grade.successRate,
      avgInputTokens: aggregate.avgInputTokens,
      avgOutputTokens: aggregate.avgOutputTokens,
      avgCacheReadTokens: aggregate.avgCacheReadTokens,
      totalInputTokens: aggregate.totalInputTokens,
      totalOutputTokens: aggregate.totalOutputTokens,
      avgCostUsd: aggregate.avgCostUsd,
      avgDurationMs: aggregate.avgDurationMs,
      avgToolCount: aggregate.avgToolCount,
      recentVerdicts,
    };
  }

  private emptyScorecard(slug: string): AgentScorecard {
    return {
      slug,
      totalInvocations: 0,
      gradedCount: 0,
      gradedSuccessRate: null,
      avgInputTokens: null,
      avgOutputTokens: null,
      avgCacheReadTokens: null,
      totalInputTokens: null,
      totalOutputTokens: null,
      avgCostUsd: null,
      avgDurationMs: null,
      avgToolCount: null,
      recentVerdicts: [],
    };
  }

  private toInvocationRow(row: import('./skill-task-grade.store').SkillTaskGrade): ScorecardInvocationRow {
    return {
      taskId: row.taskId,
      succeeded: row.verdict === 'pass',
      exactAttribution: row.runId !== null || row.evidenceSource.startsWith('spec:'),
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      durationMs: null,
      invokedAt: row.gradedAt,
      reconciledAt: row.gradedAt,
    };
  }

  private async readFindings(slug: string): Promise<string | null> {
    if (!this.findings) return null;
    try {
      const excerpt = await this.findings.getRecentFindings(slug);
      if (!excerpt) return null;
      return excerpt.slice(0, MAX_FINDINGS_CHARS);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - review findings are optional
      // scorecard enrichment behind an injected-provider check; null is the
      // same "no excerpt" answer the empty-result branch above returns, and the
      // read failure is already logged at warn.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('[skill-synthesis] scorecard findings read failed', {
        error: message,
        slug,
      });
      return null;
    }
  }

  private clampDetailLimit(limit?: number): number {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
      return DEFAULT_DETAIL_LIMIT;
    }
    return Math.min(Math.floor(limit), MAX_DETAIL_LIMIT);
  }
}

/**
 * The row for a slug the win-rate join returned nothing for.
 *
 * `winRate: null` — never `0`. Zero invocations cannot produce a rate, and a
 * zeroed rate is a claim about performance nobody has made.
 */
function unmeasuredWinRate(slug: string): SkillWinRate {
  return { slug, invocations: 0, wins: 0, unknown: 0, winRate: null };
}
