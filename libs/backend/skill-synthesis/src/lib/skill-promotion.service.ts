/**
 * SkillPromotionService — applies the promotion contract:
 *
 *  1. Threshold:  success_count >= settings.successesToPromote (default 3)
 *  2. Dedup:      cosine similarity to any active skill < dedup threshold
 *                 (default 0.85). If sqlite-vec is unavailable / no embedding
 *                 was stored at registration time, dedup degrades to a no-op
 *                 (architecture §11 Q-fallback).
 *  3. Cap:        active skills <= settings.maxActiveSkills (default 50);
 *                 over-cap → the weakest non-authored resident is DEMOTED to
 *                 dormant (never rejected), ordered by measured win rate
 *                 ascending with NULLS LAST — see {@link orderForDemotion}.
 *
 * Materializes SKILL.md at the active root and updates `body_path` on the row.
 */
import * as fs from 'node:fs';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SkillCandidateStore } from './skill-candidate.store';
import { SkillMdGenerator } from './skill-md-generator';
import { SkillClusterDedupService } from './skill-cluster-dedup.service';
import { SkillJudgeService } from './skill-judge.service';
import { SkillRegistryStore } from './skill-registry.store';
import { SKILL_SYNTHESIS_TOKENS } from './di/tokens';
import { JUDGE_CRITERION_KEYS } from './skill-judge.service';
import type {
  CandidateId,
  SkillCandidateRow,
  SkillSynthesisSettings,
} from './types';

/** Settings section, matching every other reader in this library. */
export const PROMOTION_SETTINGS_SECTION = 'ptah';

/**
 * The replay floor.
 *
 * **`replayValidation`, NOT `replay`** — `skillSynthesis.replay.*` is the replay
 * LANE's eight capability fields, and two guards (`file-settings-keys.spec.ts`
 * and `skills-synthesis-rpc.schema.spec.ts`) reject any key in that sub-tree
 * that `SKILL_LANE_KEYS` does not declare. The B3.4 batch text calls this
 * `minReplayConfidence`; that key does not exist anywhere in the codebase.
 */
export const MIN_REPLAY_CONFIDENCE_KEY =
  'skillSynthesis.replayValidation.minConfidence';

/** Matches `FILE_BASED_SETTINGS_DEFAULTS` in `platform-core`. */
export const MIN_REPLAY_CONFIDENCE_DEFAULT = 0.5;

/**
 * How the trigger criterion was sourced for {@link CandidateRanking}.
 *
 * `'none'` is not "zero" — it is "this candidate has no scorecard to rank at
 * all", and it is why {@link CandidateRanking.score} is nullable.
 */
export type RankingTriggerSource = 'measured' | 'judged' | 'none';

/**
 * A candidate's ranking score: the judge's five criteria, with the MEASURED
 * trigger score substituted for the judged `triggerClarity`.
 *
 * The judged criterion is still persisted — comparing the model's opinion of a
 * description against what retrieval actually did with it is the point of the
 * trigger-eval gate, and a substitution that overwrote the opinion would destroy
 * the only evidence that the two ever differ.
 */
export interface CandidateRanking {
  /** `null` when the candidate has no complete judged scorecard. */
  readonly score: number | null;
  readonly triggerSource: RankingTriggerSource;
}

export interface PromotionDecision {
  promoted: boolean;
  reason:
    | 'promoted'
    | 'below-threshold'
    | 'duplicate'
    | 'cap-rejected'
    | 'already-promoted'
    | 'already-rejected'
    | 'not-found'
    | 'below-judge-score'
    /**
     * The judge could not produce a trustworthy score. NEITHER a pass NOR a
     * block, and deliberately not folded into `below-judge-score`: the
     * candidate is left at `status='candidate'` — not rejected — so the next
     * drain re-judges it. Conflating "we do not know" with "we know it is bad"
     * is the exact class of quietly-wrong verdict phase 1 removes.
     */
    | 'judge-unscored'
    /**
     * A replay ran and the plan it produced matched what the held-out session
     * actually did BELOW `skillSynthesis.replayValidation.minConfidence`.
     *
     * Reachable ONLY from a measured number. A candidate whose
     * `replayConfidence` is `null` was never replayed and can never land here —
     * that is the whole of "replay is an evidence booster, never a hard
     * blocker", and it is why the rule tests `!== null` before it compares.
     *
     * Like `judge-unscored` and UNLIKE `below-judge-score`, this does NOT reject
     * the candidate: the floor is an untuned midpoint against a gate with no
     * measured corpus behind it yet, and the weekly tick re-measures. A terminal
     * rejection on that number would be unrecoverable, and `updateStatus`
     * ('rejected') is terminal.
     */
    | 'below-replay-confidence';
  candidate: SkillCandidateRow | null;
  /** Filled when promotion demoted another skill to dormant via the residency cap. */
  evictedSkillId?: CandidateId;
  /** Cosine similarity of the closest active match (if dedup ran). */
  closestMatchSimilarity?: number;
  /** Absolute path to the materialized SKILL.md (set on success). */
  filePath?: string;
  /**
   * The measured-trigger ranking score, computed for every candidate the gates
   * were reached for. Present even on a rejection — the ranking is a property of
   * the scorecard, not a reward for passing.
   */
  ranking?: CandidateRanking;
}

@injectable()
export class SkillPromotionService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SkillCandidateStore)
    private readonly store: SkillCandidateStore,
    @inject(SkillMdGenerator)
    private readonly mdGenerator: SkillMdGenerator,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CLUSTER_DEDUP_SERVICE, {
      isOptional: true,
    })
    private readonly clusterDedup: SkillClusterDedupService | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_JUDGE_SERVICE, { isOptional: true })
    private readonly judge: SkillJudgeService | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE, { isOptional: true })
    private readonly registry: SkillRegistryStore | null = null,
    /**
     * Read ONLY for `skillSynthesis.replayValidation.minConfidence`.
     *
     * Optional, and last, because `SkillSynthesisSettings` does not carry the
     * key: that projection is built by `SkillSynthesisService.readSettings` and
     * predates the empirical gates, so every gate in phase 3 reads its own
     * switches straight off the workspace exactly as `ReplayValidatorService`
     * and `TriggerEvalService` do. Absent ⇒ the documented default, which is the
     * same number `FILE_BASED_SETTINGS_DEFAULTS` serves.
     */
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER, { isOptional: true })
    private readonly workspace: IWorkspaceProvider | null = null,
  ) {}

  /**
   * Evaluate a candidate and promote it if all rules pass. Idempotent:
   * already-promoted candidates short-circuit with reason='already-promoted'.
   */
  async evaluate(
    candidateId: CandidateId,
    settings: SkillSynthesisSettings,
    nowFn: () => number = () => Date.now(),
  ): Promise<PromotionDecision> {
    const candidate = this.store.findById(candidateId);
    if (!candidate) {
      return { promoted: false, reason: 'not-found', candidate: null };
    }
    if (candidate.status === 'promoted') {
      return { promoted: false, reason: 'already-promoted', candidate };
    }
    if (candidate.status === 'rejected') {
      return { promoted: false, reason: 'already-rejected', candidate };
    }

    const dedupResult = this.checkDuplicate(
      candidate,
      settings.dedupCosineThreshold,
    );
    if (dedupResult.isDuplicate) {
      const updated = this.store.updateStatus(candidate.id, 'rejected', {
        reason: 'duplicate-of-active-skill',
      });
      return {
        promoted: false,
        reason: 'duplicate',
        candidate: updated,
        closestMatchSimilarity: dedupResult.similarity,
      };
    }
    const distinctContexts = this.store.countDistinctContexts(candidate.id);
    const effectiveSuccessThreshold =
      distinctContexts >= settings.generalizationContextThreshold
        ? Math.ceil(settings.successesToPromote / 2)
        : settings.successesToPromote;
    if (candidate.successCount < effectiveSuccessThreshold) {
      return { promoted: false, reason: 'below-threshold', candidate };
    }
    if (this.clusterDedup && candidate.embeddingRowid !== null) {
      const probe = this.store.getEmbedding(candidate.embeddingRowid);
      if (probe && this.clusterDedup.isDuplicate(probe, settings)) {
        const updated = this.store.updateStatus(candidate.id, 'rejected', {
          reason: 'cluster-duplicate',
        });
        return { promoted: false, reason: 'duplicate', candidate: updated };
      }
    }
    let graded = candidate;
    if (this.judge) {
      const judged = await this.applyJudgeGate(candidate, settings);
      if (judged) return { ...judged, ranking: rankingScore(judged.candidate) };
      graded = this.store.findById(candidate.id) ?? candidate;
    }

    const ranking = rankingScore(graded);
    const replay = this.applyReplayGate(graded);
    if (replay) return { ...replay, ranking };

    let evictedSkillId: CandidateId | undefined;
    const activeResident = this.store.listActiveOrderedByDecayScore(
      nowFn(),
      settings.evictionDecayRate,
    );
    if (activeResident.length >= settings.maxActiveSkills) {
      const authoredSlugs = this.authoredSlugs();
      const demotable = activeResident.filter(
        (r) => !authoredSlugs.has(r.name),
      );
      const winRates =
        demotable.length > 0
          ? this.winRatesBySlug()
          : new Map<string, number | null>();
      const weakest = orderForDemotion(demotable, winRates).at(0);
      if (weakest) {
        this.store.setResidency(weakest.id, 'dormant');
        evictedSkillId = weakest.id;
        this.logger.info(
          '[skill-synthesis] residency-cap demotion to dormant',
          {
            demoted: weakest.id,
            demotedName: weakest.name,
            // `null` = never measured; it is why this row sorted LAST among the
            // demotable set and was reached anyway.
            demotedWinRate: winRates.get(weakest.name) ?? null,
            residentCount: activeResident.length,
            cap: settings.maxActiveSkills,
          },
        );
      } else {
        this.logger.info(
          '[skill-synthesis] residency cap reached but all residents are authored — none demoted',
          {
            residentCount: activeResident.length,
            cap: settings.maxActiveSkills,
          },
        );
      }
    }
    const body = this.readCandidateBody(candidate);
    let bodyPath = candidate.bodyPath;
    try {
      const md = this.mdGenerator.promoteToActive(
        {
          slug: candidate.name,
          description: candidate.description,
          body,
        },
        settings.candidatesDir,
      );
      bodyPath = md.filePath;
    } catch (err) {
      this.logger.warn(
        '[skill-synthesis] failed to materialize promoted SKILL.md (continuing with candidate body_path)',
        {
          candidate: candidate.id,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }

    const promoted = this.store.updateStatus(candidate.id, 'promoted', {
      promotedAt: nowFn(),
      bodyPath,
    });
    this.clusterDedup?.invalidate();

    return {
      promoted: true,
      reason: 'promoted',
      candidate: promoted,
      evictedSkillId,
      closestMatchSimilarity: dedupResult.similarity,
      filePath: bodyPath,
      ranking,
    };
  }

  /**
   * The replay gate: the second half of B3.4.2's promotion rule.
   *
   *   promoted requires (judge scored and at/above `minJudgeScore`)
   *            AND (`replayConfidence >= minConfidence` OR `replayConfidence IS NULL`)
   *
   * ## THE NULL-VS-ZERO DISTINCTION IS THE ENTIRE RULE
   *
   *  - `null`  ⇒ NEVER MEASURED ⇒ promotes on the judge score alone. After B3.6
   *              this is the NORMAL case for a cluster sitting on
   *              `suggestionMinClusterSize`, which gets no hold-out by design —
   *              every member fed the draft, so there is nothing to replay
   *              against. Treating those as failures would block the majority of
   *              cluster-synthesized skills on a measurement that could not
   *              exist.
   *  - `0`     ⇒ MEASURED AND MATCHED NOTHING ⇒ blocked, because `0 <
   *              minConfidence`. A genuine zero is evidence AGAINST the
   *              candidate and is the strongest signal this gate produces.
   *
   * The comparison is written `!== null` FIRST and only then `<`, rather than as
   * `!(confidence >= min)`, because the second form sweeps `null` in through
   * `NaN`-style falsiness at the first refactor. SQL agrees with the first form
   * — `NULL < 0.5` is NULL, never true — and `0036`'s spec pins that
   * (`replay_confidence < 0.5` does not select the unmeasured row).
   *
   * Blocking is NOT rejecting; see the `below-replay-confidence` doc on
   * `PromotionDecision`.
   */
  private applyReplayGate(
    candidate: SkillCandidateRow,
  ): PromotionDecision | null {
    const confidence = candidate.replayConfidence;
    if (confidence === null) return null;

    const floor = this.minReplayConfidence();
    if (confidence >= floor) return null;

    this.logger.info(
      '[skill-synthesis] replay confidence below the floor; candidate left pending',
      {
        candidateId: candidate.id,
        confidence,
        minConfidence: floor,
        holdoutSessionId: candidate.replayHoldoutSessionId,
      },
    );
    return {
      promoted: false,
      reason: 'below-replay-confidence',
      candidate,
    };
  }

  /**
   * The replay floor, on the same 0–1 scale as the stored `replay_confidence`.
   *
   * Out-of-range and non-finite values fall back rather than being honoured: the
   * key comes from a JSON file a user can hand-edit, and a floor above 1 would
   * block every candidate the gate ever measured while a negative one would
   * disable the gate silently.
   */
  private minReplayConfidence(): number {
    if (!this.workspace) return MIN_REPLAY_CONFIDENCE_DEFAULT;
    try {
      const raw = this.workspace.getConfiguration<number>(
        PROMOTION_SETTINGS_SECTION,
        MIN_REPLAY_CONFIDENCE_KEY,
        MIN_REPLAY_CONFIDENCE_DEFAULT,
      );
      return typeof raw === 'number' &&
        Number.isFinite(raw) &&
        raw >= 0 &&
        raw <= 1
        ? raw
        : MIN_REPLAY_CONFIDENCE_DEFAULT;
    } catch {
      return MIN_REPLAY_CONFIDENCE_DEFAULT;
    }
  }

  /**
   * Run the judge, PERSIST whatever it said, and answer with a terminal
   * decision — or `null` to mean "carry on promoting".
   *
   * Three statuses, three outcomes, and the middle one is the point of phase 1:
   *
   *  - `scored`   — below `minJudgeScore` rejects; at or above it promotes.
   *  - `unscored` — no trustworthy verdict. The candidate STAYS `candidate`
   *                 (no `updateStatus` call at all) and the next drain retries
   *                 it. Previously this path fabricated `score: 10` and
   *                 promoted.
   *  - `disabled` — no gate is configured, so there is nothing to fail. Promote.
   *
   * The verdict is written through `SkillCandidateStore.recordJudgeVerdict`,
   * which is the single enforcing gate for `judge_status` and already throws on
   * a `scored` verdict with a non-finite score and on any non-`scored` status
   * carrying a number. Nothing here re-validates it and nothing catches it: an
   * `{status:'unscored', score:10}` MUST reach the store and MUST throw, because
   * that shape is the defect this phase exists to make impossible.
   */
  private async applyJudgeGate(
    candidate: SkillCandidateRow,
    settings: SkillSynthesisSettings,
  ): Promise<PromotionDecision | null> {
    if (!this.judge) return null;

    const body = this.readCandidateBody(candidate);
    const decision = await this.judge.judge(candidate, body, settings);
    const judged = this.store.recordJudgeVerdict(candidate.id, {
      status: decision.status,
      score: decision.score,
      reason: decision.reason,
      criteria: decision.criteria ?? undefined,
    });

    if (decision.status === 'unscored') {
      this.logger.info(
        '[skill-synthesis] judge produced no trustworthy score; candidate left pending',
        { candidateId: candidate.id, reason: decision.reason },
      );
      return { promoted: false, reason: 'judge-unscored', candidate: judged };
    }

    if (
      decision.status === 'scored' &&
      decision.score !== null &&
      decision.score < settings.minJudgeScore
    ) {
      this.logger.info('[skill-synthesis] judge rejected candidate', {
        candidateId: candidate.id,
        score: decision.score,
        minScore: settings.minJudgeScore,
      });
      const rejected = this.store.updateStatus(candidate.id, 'rejected', {
        reason: 'below-judge-score',
      });
      return {
        promoted: false,
        reason: 'below-judge-score',
        candidate: rejected,
      };
    }

    return null;
  }

  /**
   * Measured win rate per slug, for the demotion ordering.
   *
   * A missing entry and a stored `null` mean the same thing — never measured —
   * so callers read this map with `?? null` and never with `||`, which would
   * fold a measured `0` into the unmeasured bucket and demote the loser last.
   *
   * Fail-soft in the same shape as {@link authoredSlugs}: an empty map means
   * every resident is unmeasured, the ordering collapses to the decay-score
   * order the store already returned, and the demotion still happens. A cap
   * breach must not be left unresolved because a read failed.
   */
  private winRatesBySlug(): ReadonlyMap<string, number | null> {
    try {
      return new Map(
        this.store.getWinRates().map((rate) => [rate.slug, rate.winRate]),
      );
    } catch (err) {
      this.logger.warn(
        '[skill-synthesis] failed to read win rates (demoting on decay score alone)',
        { error: err instanceof Error ? err.message : String(err) },
      );
      return new Map<string, number | null>();
    }
  }

  private authoredSlugs(): Set<string> {
    if (!this.registry) return new Set<string>();
    try {
      return this.registry.listAuthoredSlugs();
    } catch (err) {
      this.logger.warn(
        '[skill-synthesis] failed to read authored slugs (continuing without exemption)',
        { error: err instanceof Error ? err.message : String(err) },
      );
      return new Set<string>();
    }
  }

  private checkDuplicate(
    candidate: SkillCandidateRow,
    threshold: number,
  ): { isDuplicate: boolean; similarity: number } {
    if (candidate.embeddingRowid === null) {
      return { isDuplicate: false, similarity: 0 };
    }
    const probe = this.store.getEmbedding(candidate.embeddingRowid);
    if (!probe) return { isDuplicate: false, similarity: 0 };
    const matches = this.store.searchActiveByEmbedding(probe, 1);
    if (matches.length === 0) return { isDuplicate: false, similarity: 0 };
    const top = matches[0];
    return {
      isDuplicate: top.similarity >= threshold,
      similarity: top.similarity,
    };
  }

  private readCandidateBody(candidate: SkillCandidateRow): string {
    return readCandidateBodyOf(candidate, this.logger);
  }
}

/**
 * Order the demotable residents worst-first: **win rate ASCENDING, NULLS LAST.**
 *
 * ## NULLS LAST IS THE WHOLE RULE
 *
 * `null` is "nobody has measured this skill"; `0` is "measured, and it lost
 * every time". Demotion touches the head of this list, so an unmeasured skill
 * must sort AFTER a measured loser — it is the one we know least about, and
 * demoting it ahead of a skill we have watched fail throws away the only
 * candidate that might still be good. Sorting nulls first (which is what any
 * `winRate ?? 0`, `winRate || 0` or a bare `a - b` over nullables produces)
 * inverts exactly that and reads as the ordering working.
 *
 * The comparator tests `=== null` explicitly rather than leaning on falsiness,
 * for the same reason `applyReplayGate` writes `!== null` before it compares:
 * `0` is falsy and is a real measurement, so any truthiness test here silently
 * promotes the worst skill in the library out of the demotion queue.
 *
 * The sort is STABLE (ES2019+), and the input arrives already ordered by decay
 * score weakest-first — so the activity ordering survives intact as the
 * tiebreaker, and a library where nothing is measured yet demotes exactly what
 * it demoted before this rule existed.
 *
 * A slug absent from `winRates` is unmeasured, read with `??` so a stored `null`
 * and a missing key resolve identically.
 */
export function orderForDemotion(
  residents: readonly SkillCandidateRow[],
  winRates: ReadonlyMap<string, number | null>,
): SkillCandidateRow[] {
  return [...residents].sort((a, b) =>
    compareWinRateAscNullsLast(
      winRates.get(a.name) ?? null,
      winRates.get(b.name) ?? null,
    ),
  );
}

/** Ascending, with `null` (never measured) sorting after every number. */
function compareWinRateAscNullsLast(
  a: number | null,
  b: number | null,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/**
 * How many points on the judge's 1–10 scale one point of `trigger_score` is
 * worth. `trigger_score` is F1 on 0–1 (`gates/trigger-eval.service.ts`); the
 * judged `triggerClarity` it replaces is 1–10. Substituting without this factor
 * would silently cap the criterion at 1/10 and drag every measured candidate's
 * ranking below every unmeasured one — a scale bug that reads as the gate
 * working and disliking everything.
 */
export const TRIGGER_SCORE_TO_JUDGE_SCALE = 10;

/**
 * A candidate's ranking score: the five judged criteria with the MEASURED
 * trigger score substituted for the judged `triggerClarity`.
 *
 * This is deliberately NOT what `minJudgeScore` is compared against. The gate
 * compares `judgeScore` — the number the judge actually awarded and the store
 * actually persisted — because a threshold applied to a derived figure would
 * mean the recorded verdict and the decision it drove no longer match. The
 * ranking is for ORDERING candidates against each other, which is where a
 * measured number beats an opinion.
 *
 * Three outcomes, and the difference between the last two is the point:
 *
 *  - no complete judged scorecard ⇒ `{score: null, triggerSource: 'none'}`.
 *  - `triggerScore` measured ⇒ substituted, `'measured'`.
 *  - `triggerScore` `null` (never evaluated) ⇒ the judged `triggerClarity`
 *    stands, `'judged'`. NOT zero: an unmeasured description is not a
 *    description that retrieved nothing, and scoring it as one would rank every
 *    candidate the weekly gate has not reached yet below every candidate it has.
 */
export function rankingScore(
  candidate: SkillCandidateRow | null,
): CandidateRanking {
  if (!candidate) return { score: null, triggerSource: 'none' };
  const criteria = candidate.judgeCriteria;
  const values: number[] = [];
  for (const key of JUDGE_CRITERION_KEYS) {
    const value = criteria[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { score: null, triggerSource: 'none' };
    }
    values.push(value);
  }

  const measured = candidate.triggerScore;
  if (measured === null || !Number.isFinite(measured)) {
    return { score: mean(values), triggerSource: 'judged' };
  }

  // Substituted BY KEY, not by index. `triggerClarity` happens to be last in
  // `JUDGE_CRITERION_KEYS` today, and an index would keep compiling — and keep
  // ranking — the day someone reorders the rubric.
  const index = JUDGE_CRITERION_KEYS.indexOf('triggerClarity');
  values[index] = measured * TRIGGER_SCORE_TO_JUDGE_SCALE;
  return { score: mean(values), triggerSource: 'measured' };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function readCandidateBodyOf(
  candidate: SkillCandidateRow,
  logger: Logger,
): string {
  try {
    if (fs.existsSync(candidate.bodyPath)) {
      const raw = fs.readFileSync(candidate.bodyPath, 'utf8');
      const stripped = raw.replace(/^---[\s\S]*?---\s*/, '');
      return stripped.trim();
    }
  } catch (err) {
    logger.debug('[skill-synthesis] could not read candidate body', {
      bodyPath: candidate.bodyPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return `# ${candidate.name}\n\n${candidate.description}\n`;
}
