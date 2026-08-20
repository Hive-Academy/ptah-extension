/**
 * SkillScorecardService — composes persisted subagent telemetry into the
 * Library-tab scorecard DTOs.
 *
 * Two entry points mirror the two RPC methods:
 *  - `getScorecards(slugs)` — the BATCHED path. One `GROUP BY` over
 *    `SkillCandidateStore.getScorecardAggregates` plus a tiny indexed verdict
 *    query per slug that actually has graded events. No disk reads here — the
 *    200-clone Library render must stay to one aggregate pass.
 *  - `getScorecardDetail(slug, limit?)` — the LAZY path, fetched only on card
 *    expansion. Recent graded rows plus a truncated review-findings excerpt
 *    (`SpecFindingsPort.getRecentFindings`, re-read from disk, 4000-char cap).
 *
 * A third read sits ALONGSIDE the aggregates rather than inside them:
 *  - `getWinRates(slugs)` — the per-slug win rate over the invocation →
 *    session-outcome join. It is a separate pass because it answers a different
 *    question from a different join, and because its `null` is a value the
 *    aggregate DTO has no room for (see the method's own header).
 *
 * All empty/partial states are well-typed: a slug with no rows yields a zeroed
 * scorecard (`totalInvocations: 0`, null averages, `gradedSuccessRate: null`),
 * never an error. `catch (error: unknown)` narrowing throughout.
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
import {
  SPEC_FINDINGS_TOKEN,
  type SpecFindingsPort,
} from './spec-findings.port';
import type { GradedInvocationRow, ScorecardAggregate } from './types';

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
      for (const [slug, aggregate] of aggregates) {
        const recentVerdicts =
          aggregate.graded > 0 ? this.buildRecentVerdicts(slug) : [];
        scorecards[slug] = this.toScorecard(aggregate, recentVerdicts);
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
   * Per-slug win rate for the requested clones, alongside the aggregates above.
   *
   * ## `winRate: null` IS A VALUE, AND IT IS NEVER `0`
   *
   * `null` means "no measured session for this slug yet"; `0` means "measured,
   * and it lost every time". This service does not coalesce one into the other
   * in either direction, and no caller may either — a `||` on this field turns a
   * measured zero into "unmeasured" and quietly re-ranks it. Every slug the
   * caller asked for comes back, so a slug with no invocation events at all
   * reads as `{invocations: 0, wins: 0, unknown: 0, winRate: null}` rather than
   * being missing from the record: absent and unmeasured are the same fact, and
   * making the caller re-derive that is where the `0` creeps back in.
   *
   * Deliberately NOT folded into {@link AgentScorecard}: that DTO is the wire
   * contract for the Library cards, and widening a shared wire type is the RPC
   * batch's job, not this one. One store pass serves every requested slug —
   * `getWinRates()` is a single `GROUP BY`, so filtering here is cheaper than
   * asking per slug.
   *
   * Fail-soft, exactly like {@link getScorecards}: a store failure degrades to
   * "nothing is measured", which is the honest answer and the one that changes
   * no ranking, rather than throwing into a card render.
   */
  getWinRates(slugs: readonly string[]): Record<string, SkillWinRate> {
    const rates: Record<string, SkillWinRate> = {};
    if (slugs.length === 0) return rates;
    for (const slug of slugs) {
      rates[slug] = unmeasuredWinRate(slug);
    }
    try {
      for (const measured of this.store.getWinRates()) {
        if (measured.slug in rates) {
          rates[measured.slug] = measured;
        }
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
      rows = this.store
        .listGradedInvocations(slug, effectiveLimit)
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
    return this.store
      .listGradedInvocations(slug, MAX_RECENT_VERDICTS)
      .map((r) => ({
        taskId: r.taskId ?? taskIdFromVerdictSource(r.verdictSource) ?? '',
        succeeded: r.succeeded,
        reconciledAt: r.reconciledAt,
      }));
  }

  private toScorecard(
    aggregate: ScorecardAggregate,
    recentVerdicts: AgentScorecard['recentVerdicts'],
  ): AgentScorecard {
    return {
      slug: aggregate.slug,
      totalInvocations: aggregate.total,
      gradedCount: aggregate.graded,
      gradedSuccessRate:
        aggregate.graded > 0
          ? aggregate.gradedSucceeded / aggregate.graded
          : null,
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

  private toInvocationRow(row: GradedInvocationRow): ScorecardInvocationRow {
    return {
      taskId: row.taskId,
      succeeded: row.succeeded,
      exactAttribution: isExactAttribution(row.verdictSource),
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costUsd: row.costUsd,
      durationMs: row.durationMs,
      invokedAt: row.invokedAt,
      reconciledAt: row.reconciledAt,
    };
  }

  private async readFindings(slug: string): Promise<string | null> {
    if (!this.findings) return null;
    try {
      const excerpt = await this.findings.getRecentFindings(slug);
      if (!excerpt) return null;
      return excerpt.slice(0, MAX_FINDINGS_CHARS);
    } catch (error: unknown) {
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

/** Exact attribution = base `spec:` provenance (not `spec-window:`). */
function isExactAttribution(verdictSource: string | null): boolean {
  return verdictSource !== null && verdictSource.startsWith('spec:');
}

/** Recover the task id from a `spec:TASK_X` / `spec-window:TASK_X` provenance. */
function taskIdFromVerdictSource(verdictSource: string | null): string | null {
  if (!verdictSource) return null;
  const idx = verdictSource.indexOf(':');
  if (idx < 0) return null;
  const tail = verdictSource.slice(idx + 1).trim();
  return tail.length > 0 ? tail : null;
}
