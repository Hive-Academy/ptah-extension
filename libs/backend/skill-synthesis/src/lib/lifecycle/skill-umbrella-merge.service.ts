/**
 * SkillUmbrellaMergeService — consolidates the skill pool (TASK_2026_578).
 *
 * One pass, called by the curator:
 * 1. Partition the pool (candidates, pending suggestions, non-exempt promoted
 *    skills) into clusters and orphans.
 * 2. For the largest clusters (at most {@link SUGGESTION_MAX_CLUSTERS_PER_PASS},
 *    each paid from the shared `skill.analyze` bucket), synthesize ONE umbrella
 *    skill and judge it:
 *    - at or above `minJudgeScore`: a `pending` umbrella suggestion; candidate
 *      members are rejected `merged-into:<umbrellaId>`, pending-suggestion
 *      members are dismissed with `merged_into`, promoted members are left
 *      alone until the umbrella is accepted (R2, R3);
 *    - below it: a `dismissed` umbrella, and every candidate member is
 *      rejected `below-judge-score:umbrella:<umbrellaId>` (R7);
 *    - `unscored` / `disabled`: nothing is written; the next pass retries.
 * 3. Surface judge-passed orphan candidates as singleton suggestions (R1).
 * 4. Run the one-time backlog purge when its marker is absent, sqlite-vec is
 *    available and the pool was not truncated (R5, R6).
 *
 * TRANSACTIONS (R-f, R-f2). Every write unit is ONE `inImmediateTransaction`
 * holding only plain-statement store methods, with no catch inside the
 * callback. The per-unit try/catch wraps the whole transaction call, so a
 * throw has already rolled the unit back when it is logged.
 *
 * The service never throws into its caller.
 */
import * as fsBody from 'node:fs';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  type CuratorRateLimitService,
} from '@ptah-extension/agent-sdk';
import type { QueryOrigin } from '../internal-query.interface';
import { SkillCandidateStore } from '../skill-candidate.store';
import type { SkillSuggestionStore } from '../skill-suggestion.store';
import type {
  PoolMember,
  PoolPartition,
  SkillClusteringService,
} from '../skill-clustering.service';
import type {
  SkillSynthesizerService,
  UmbrellaMemberInput,
  UmbrellaSkill,
} from '../skill-synthesizer.service';
import type { SkillJudgeService } from '../skill-judge.service';
import {
  planClusterDraft,
  type ClusterDraftPlan,
} from '../gates/cluster-holdout';
import { orderByCentroidDistance } from './centroid-order';
import type { SkillBacklogPurgeStateStore } from './skill-backlog-purge-state.store';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import {
  BACKLOG_PURGE_REASON,
  MERGED_INTO_PREFIX,
  type CandidateId,
  type NewSuggestionInput,
  type SkillCandidateRow,
  type SkillSuggestionRow,
  type SkillSynthesisSettings,
} from '../types';

/** Shared analyze rate-limit bucket — umbrella synthesis is an LLM cost too. */
const ANALYZE_RATE_LIMIT_KEY = 'skill.analyze';
const ANALYZE_MAX_PER_HOUR = 6;
export const SUGGESTION_MAX_CLUSTERS_PER_PASS = 3;
/** Judge-passed orphans surfaced as suggestions per pass (R1). */
export const SINGLETON_MAX_PER_PASS = 5;
/** Only candidates older than this are in scope for the backlog purge. */
export const BACKLOG_PURGE_MIN_AGE_DAYS = 30;
/** Prefix of the reason a judge-rejected umbrella writes on its members (R7). */
export const BELOW_JUDGE_SCORE_UMBRELLA_PREFIX = 'below-judge-score:umbrella:';

const DAY_MS = 86_400_000;

export type PurgeSkippedReason =
  | 'already-complete'
  | 'no-vec'
  | 'pool-truncated'
  /** The pool could not be read, or the purge transaction rolled back. */
  | 'failed';

export interface UmbrellaPassResult {
  /** Pending umbrella suggestions written this pass. */
  readonly umbrellasCreated: number;
  /** Judge-rejected umbrellas recorded `dismissed` this pass (R7). */
  readonly umbrellasRejected: number;
  /** Candidate members rejected by a judge-rejected umbrella (R7). */
  readonly judgeRejectedMembers: number;
  readonly singletonsSurfaced: number;
  /** Candidates rejected `merged-into:<umbrellaId>` (= `mergedIds.length`). */
  readonly candidatesMerged: number;
  /** Pending suggestions dismissed into an umbrella. */
  readonly suggestionsMerged: number;
  /** Candidates rejected by the backlog purge (= `purgedIds.length`). */
  readonly purged: number;
  /** `null` when the purge ran this pass. */
  readonly purgeSkippedReason: PurgeSkippedReason | null;
  /** Clusters the loop did not reach this pass (cap or rate limit). */
  readonly clustersRemaining: number;
  /** True when the `skill.analyze` bucket stopped the cluster loop. */
  readonly rateLimited: boolean;
  readonly mergedIds: readonly string[];
  readonly purgedIds: readonly string[];
}

/** Everything one cluster's merge needs, decided before any LLM call. */
interface ClusterPlan {
  /** Members closest to the cluster centroid first. */
  readonly ordered: readonly PoolMember[];
  readonly candidates: readonly SkillCandidateRow[];
  readonly promoted: readonly SkillCandidateRow[];
  readonly draft: ClusterDraftPlan<SkillCandidateRow>;
  /** Unique pending-suggestion member ids; `markMerged` must change all. */
  readonly suggestionIds: readonly string[];
  /** Candidate ids rejected `merged-into:` (members + suggestion members). */
  readonly mergeCandidateIds: readonly string[];
  /** The umbrella's `memberCandidateIds`: every candidate id in the cluster. */
  readonly memberCandidateIds: readonly string[];
  readonly memberSessionIds: readonly string[];
  /** The row handed to the judge; `null` when no member resolves to one. */
  readonly judgeAnchor: SkillCandidateRow | null;
}

type ClusterCommit =
  | { kind: 'aborted' }
  | {
      kind: 'created';
      umbrellaId: string;
      mergedIds: string[];
      suggestionsMerged: number;
      lost: number;
    }
  | {
      kind: 'rejected';
      umbrellaId: string;
      rejectedIds: string[];
      lost: number;
    };

type PurgeCommit =
  { kind: 'already-complete' } | { kind: 'purged'; purgedIds: string[] };

/** The result under construction; the two counts derive from the id lists. */
type PassTally = {
  -readonly [
    K in keyof Omit<
      UmbrellaPassResult,
      'candidatesMerged' | 'purged' | 'mergedIds' | 'purgedIds'
    >
  ]: UmbrellaPassResult[K];
} & { mergedIds: string[]; purgedIds: string[] };

@injectable()
export class SkillUmbrellaMergeService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SkillCandidateStore)
    private readonly store: SkillCandidateStore,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_SUGGESTION_STORE)
    private readonly suggestions: SkillSuggestionStore,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CLUSTERING_SERVICE)
    private readonly clustering: SkillClusteringService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIZER_SERVICE)
    private readonly synthesizer: SkillSynthesizerService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_JUDGE_SERVICE)
    private readonly judge: SkillJudgeService,
    @inject(SDK_TOKENS.SDK_CURATOR_RATE_LIMIT)
    private readonly rateLimiter: CuratorRateLimitService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_BACKLOG_PURGE_STATE_STORE)
    private readonly purgeState: SkillBacklogPurgeStateStore,
  ) {}

  /**
   * One umbrella pass. `exemptSlugs` are the promoted slugs the user owns
   * (registry `authored` / `diverged`); the caller reads them. Never throws:
   * every failure is logged and reflected in the result.
   */
  async runPass(
    settings: SkillSynthesisSettings,
    exemptSlugs: ReadonlySet<string>,
    origin: QueryOrigin = {},
    now: number = Date.now(),
  ): Promise<UmbrellaPassResult> {
    const tally: PassTally = {
      umbrellasCreated: 0,
      umbrellasRejected: 0,
      judgeRejectedMembers: 0,
      singletonsSurfaced: 0,
      suggestionsMerged: 0,
      purgeSkippedReason: 'failed',
      clustersRemaining: 0,
      rateLimited: false,
      mergedIds: [],
      purgedIds: [],
    };

    const partition = this.readPartition(settings, exemptSlugs);
    if (partition) {
      const clusters = [...partition.clusters].sort(
        (a, b) => b.length - a.length,
      );
      // Case-insensitive, like the retirement sweep: case-insensitive
      // filesystems map `My-Skill` and `my-skill` to one directory.
      const exemptLower = new Set(
        [...exemptSlugs].map((slug) => slug.toLowerCase()),
      );
      await this.mergeClusters(
        clusters,
        settings,
        exemptLower,
        origin,
        now,
        tally,
      );
      this.surfaceSingletons(partition.orphans, settings, tally);
      this.runPurge(partition, clusters, settings, now, tally);
    }

    return {
      ...tally,
      candidatesMerged: tally.mergedIds.length,
      purged: tally.purgedIds.length,
    };
  }

  /** The pool partition, or `null` (logged) when it cannot be read. */
  private readPartition(
    settings: SkillSynthesisSettings,
    exemptSlugs: ReadonlySet<string>,
  ): PoolPartition | null {
    let partition: PoolPartition | null = null;
    try {
      partition = this.clustering.partitionPool(settings, {
        suggestionMemberIds: this.suggestions.listMemberCandidateIds(),
        exemptSlugs,
      });
    } catch (err: unknown) {
      this.logger.warn(
        '[skill-synthesis] umbrella pass: pool partition failed; pass skipped',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
    return partition;
  }

  /**
   * Largest clusters first. Each cluster's planning and merge are wrapped
   * separately, so one failure never stops the loop; the rate limit and the
   * per-pass cap do.
   */
  private async mergeClusters(
    clusters: readonly PoolMember[][],
    settings: SkillSynthesisSettings,
    exemptLower: ReadonlySet<string>,
    origin: QueryOrigin,
    now: number,
    tally: PassTally,
  ): Promise<void> {
    let visited = 0;
    let processed = 0;
    for (const cluster of clusters) {
      if (processed >= SUGGESTION_MAX_CLUSTERS_PER_PASS) break;
      const plan = this.planCluster(cluster, settings, exemptLower);
      if (plan) {
        const decision = this.rateLimiter.tryAcquire(
          ANALYZE_RATE_LIMIT_KEY,
          ANALYZE_MAX_PER_HOUR,
        );
        if (!decision.allowed) {
          tally.rateLimited = true;
          this.logger.info('[skill-synthesis] umbrella pass rate-limited', {
            resetAt: decision.resetAt,
          });
          break;
        }
        processed += 1;
        try {
          await this.mergeCluster(plan, settings, origin, now, tally);
        } catch (err: unknown) {
          // Wraps the whole unit, including its `inImmediateTransaction` call,
          // so a write failure has already rolled back (R-f2). Retried next pass.
          this.logger.warn(
            '[skill-synthesis] umbrella merge failed for one cluster (rolled back; retried next pass)',
            {
              clusterSize: cluster.length,
              error: err instanceof Error ? err.message : String(err),
            },
          );
        }
      }
      visited += 1;
    }
    tally.clustersRemaining = clusters.length - visited;
  }

  /**
   * Order, draft and guard one cluster. Members whose embedding dimension
   * differs from the cluster's are dropped entirely (not synthesized from, not
   * judged against, not merged). `null` when too few members remain, when an
   * authored or diverged skill dominates its sessions (`exemptLower` is
   * lowercased), or when planning failed (logged).
   */
  private planCluster(
    cluster: readonly PoolMember[],
    settings: SkillSynthesisSettings,
    exemptLower: ReadonlySet<string>,
  ): ClusterPlan | null {
    let plan: ClusterPlan | null = null;
    try {
      const { ordered, mismatched } = orderByCentroidDistance(cluster);
      if (mismatched > 0) {
        this.logger.warn(
          '[skill-synthesis] umbrella cluster members with a different embedding dimension excluded',
          { clusterSize: cluster.length, excluded: mismatched },
        );
      }
      const candidate =
        ordered.length >= settings.suggestionMinClusterSize
          ? this.buildPlan(ordered, settings)
          : null;
      // The authored-skill guard is a fact about the CLUSTER, not about the
      // draft: a hold-out does not make an authored skill's territory any less
      // its own.
      const dominant =
        candidate && exemptLower.size > 0
          ? this.store.getDominantSkillSlugForSessions([
              ...candidate.draft.clusterSessionIds,
            ])
          : null;
      if (!candidate) {
        this.logger.info(
          '[skill-synthesis] skipping cluster — below the minimum size after exclusions',
          { remaining: ordered.length, excluded: mismatched },
        );
      } else if (dominant && exemptLower.has(dominant.toLowerCase())) {
        this.logger.info(
          '[skill-synthesis] skipping cluster — dominated by an authored skill',
          { dominant },
        );
      } else {
        plan = candidate;
      }
    } catch (err: unknown) {
      this.logger.warn('[skill-synthesis] umbrella cluster planning failed', {
        clusterSize: cluster.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return plan;
  }

  /** `ordered`: the comparable members, closest to the centroid first. */
  private buildPlan(
    ordered: readonly PoolMember[],
    settings: SkillSynthesisSettings,
  ): ClusterPlan {
    const candidates: SkillCandidateRow[] = [];
    const promoted: SkillCandidateRow[] = [];
    const rows: SkillCandidateRow[] = [];
    const suggestionRows: SkillSuggestionRow[] = [];
    const suggestionMemberIds: string[] = [];
    for (const member of ordered) {
      if (member.kind === 'suggestion') {
        suggestionRows.push(member.row);
        suggestionMemberIds.push(...member.memberIds);
      } else {
        rows.push(member.row);
        (member.kind === 'candidate' ? candidates : promoted).push(member.row);
      }
    }
    // B3.6: the hold-out is reserved over the candidate and promoted members
    // only; pending suggestions are always drafted.
    const draft = planClusterDraft(rows, settings.suggestionMinClusterSize);
    const promotedIds = new Set<string>(promoted.map((r) => r.id));
    const candidateIds = candidates.map((r) => r.id as string);

    return {
      ordered,
      candidates,
      promoted,
      draft,
      suggestionIds: unique(suggestionRows.map((r) => r.id)),
      mergeCandidateIds: unique([
        ...candidateIds,
        ...suggestionMemberIds,
      ]).filter((id) => !promotedIds.has(id)),
      memberCandidateIds: unique([
        ...candidateIds,
        ...promotedIds,
        ...suggestionMemberIds,
      ]),
      // The umbrella body consumed the suggestion members' bodies too, so
      // their drafted sessions are part of what it was written from.
      memberSessionIds: unique([
        ...draft.draftedSessionIds,
        ...suggestionRows.flatMap((r) => r.memberSessionIds),
      ]),
      judgeAnchor: this.judgeAnchor(draft.drafted, suggestionMemberIds),
    };
  }

  /**
   * The row the judge reads its candidate context from: the drafted member
   * closest to the centroid, else the first resolvable member of a merged
   * suggestion.
   */
  private judgeAnchor(
    drafted: readonly SkillCandidateRow[],
    suggestionMemberIds: readonly string[],
  ): SkillCandidateRow | null {
    if (drafted.length > 0) return drafted[0];
    for (const id of suggestionMemberIds) {
      const row = this.store.findById(id as CandidateId);
      if (row) return row;
    }
    return null;
  }

  /** Synthesize, judge and commit one cluster. Throws on a failed commit. */
  private async mergeCluster(
    plan: ClusterPlan,
    settings: SkillSynthesisSettings,
    origin: QueryOrigin,
    now: number,
    tally: PassTally,
  ): Promise<void> {
    if (!plan.judgeAnchor) {
      this.logger.info(
        '[skill-synthesis] umbrella skipped — no member row to judge against',
        { clusterSize: plan.ordered.length },
      );
      return;
    }
    const umbrella = await this.synthesizer.synthesizeUmbrella(
      this.umbrellaInputs(plan),
      origin,
    );
    if (!umbrella) {
      this.logger.info('[skill-synthesis] umbrella synthesis gave nothing', {
        clusterSize: plan.ordered.length,
      });
      return;
    }
    const verdict = await this.judge.judge(
      {
        ...plan.judgeAnchor,
        name: umbrella.name,
        description: umbrella.description,
      },
      umbrella.body,
      settings,
      undefined,
      undefined,
      origin,
    );
    // Only a genuine `scored` verdict may write a row: `judge_score` is a
    // number, and `unscored` / `disabled` are "we do not know". The next pass
    // re-clusters and retries.
    if (verdict.status !== 'scored' || verdict.score === null) {
      this.logger.info(
        '[skill-synthesis] umbrella skipped — no trustworthy judge score',
        { status: verdict.status, reason: verdict.reason },
      );
      return;
    }

    const input = this.umbrellaSuggestionInput(plan, umbrella, verdict.score);
    const commit =
      verdict.score < settings.minJudgeScore
        ? this.commitRejectedUmbrella(plan, input, now)
        : this.commitUmbrella(plan, input, now);
    this.recordCommit(commit, plan, verdict.score, tally);
  }

  /**
   * Members closest to the centroid first, so the synthesizer's
   * `UMBRELLA_MAX_MEMBERS` cut drops the farthest. The held-out member's body
   * never reaches the synthesizer.
   */
  private umbrellaInputs(plan: ClusterPlan): UmbrellaMemberInput[] {
    const drafted = new Set<string>(plan.draft.drafted.map((r) => r.id));
    const inputs: UmbrellaMemberInput[] = [];
    for (const member of plan.ordered) {
      if (member.kind === 'suggestion') {
        inputs.push({
          kind: 'suggestion',
          description: member.row.description,
          body: member.row.body,
        });
      } else if (drafted.has(member.row.id)) {
        inputs.push({
          kind: member.kind,
          description: member.row.description,
          body: this.readCandidateBody(member.row),
        });
      }
    }
    return inputs;
  }

  private umbrellaSuggestionInput(
    plan: ClusterPlan,
    umbrella: UmbrellaSkill,
    judgeScore: number,
  ): NewSuggestionInput {
    return {
      name: umbrella.name,
      description: umbrella.description,
      body: umbrella.body,
      references: umbrella.references,
      memberSessionIds: [...plan.memberSessionIds],
      memberCandidateIds: [...plan.memberCandidateIds],
      clusterSize: plan.ordered.length,
      technologyFingerprint: this.technologyFingerprint([
        ...plan.candidates,
        ...plan.promoted,
      ]),
      judgeScore,
    };
  }

  /**
   * Scored at or above the threshold: ONE transaction of plain statements
   * (R-f), no catch inside (R-f2).
   *
   * Members are re-read first; a candidate member that is no longer
   * `candidate`, or a suggestion member that is no longer `pending`, means
   * another writer got there first and the cluster is abandoned with nothing
   * written. `markMerged` never receives the umbrella id, and a count short of
   * the suggestion members throws, rolling the whole cluster back (R-n).
   */
  private commitUmbrella(
    plan: ClusterPlan,
    input: NewSuggestionInput,
    now: number,
  ): ClusterCommit {
    return this.store.inImmediateTransaction((): ClusterCommit => {
      if (!this.membersUnchanged(plan)) return { kind: 'aborted' };
      const umbrella = this.suggestions.insert(input, 'pending');
      const suggestionIds = plan.suggestionIds.filter(
        (id) => id !== umbrella.id,
      );
      const suggestionsMerged = this.suggestions.markMerged(
        suggestionIds,
        umbrella.id,
      );
      if (suggestionsMerged !== suggestionIds.length) {
        throw new Error(
          `[skill-synthesis] umbrella ${umbrella.id}: merged ${suggestionsMerged} of ${suggestionIds.length} pending suggestions; cluster rolled back`,
        );
      }
      const merged = this.rejectCandidates(
        plan.mergeCandidateIds,
        MERGED_INTO_PREFIX + umbrella.id,
        now,
      );
      return {
        kind: 'created',
        umbrellaId: umbrella.id,
        mergedIds: merged.rejectedIds,
        suggestionsMerged,
        lost: merged.lost,
      };
    });
  }

  /**
   * Scored below the threshold (R7): ONE transaction recording the umbrella
   * `dismissed` and rejecting every candidate member that is still
   * `candidate`. Promoted and pending-suggestion members are untouched.
   */
  private commitRejectedUmbrella(
    plan: ClusterPlan,
    input: NewSuggestionInput,
    now: number,
  ): ClusterCommit {
    return this.store.inImmediateTransaction((): ClusterCommit => {
      const umbrella = this.suggestions.insert(input, 'dismissed');
      const rejected = this.rejectCandidates(
        plan.candidates.map((r) => r.id),
        BELOW_JUDGE_SCORE_UMBRELLA_PREFIX + umbrella.id,
        now,
      );
      return { kind: 'rejected', umbrellaId: umbrella.id, ...rejected };
    });
  }

  /**
   * Compare-and-set rejection of every id still `candidate`. A `false` means
   * another writer decided the row first: skipped, counted only as `lost`.
   */
  private rejectCandidates(
    ids: readonly string[],
    reason: string,
    now: number,
  ): { rejectedIds: string[]; lost: number } {
    const rejectedIds = ids.filter((id) =>
      this.store.rejectIfStatus(id as CandidateId, 'candidate', reason, now),
    );
    return { rejectedIds, lost: ids.length - rejectedIds.length };
  }

  /** Fresh reads inside the transaction; plain statements only. */
  private membersUnchanged(plan: ClusterPlan): boolean {
    return (
      plan.candidates.every(
        (r) => this.store.findById(r.id)?.status === 'candidate',
      ) &&
      plan.suggestionIds.every(
        (id) => this.suggestions.findById(id)?.status === 'pending',
      )
    );
  }

  private recordCommit(
    commit: ClusterCommit,
    plan: ClusterPlan,
    judgeScore: number,
    tally: PassTally,
  ): void {
    if (commit.kind === 'aborted') {
      this.logger.info(
        '[skill-synthesis] umbrella aborted — a member changed since the pool was read (retried next pass)',
        { clusterSize: plan.ordered.length },
      );
      return;
    }
    if (commit.lost > 0) {
      this.logger.info(
        '[skill-synthesis] umbrella members already decided by another writer; skipped',
        { umbrellaId: commit.umbrellaId, skipped: commit.lost },
      );
    }
    if (commit.kind === 'created') {
      tally.umbrellasCreated += 1;
      tally.suggestionsMerged += commit.suggestionsMerged;
      tally.mergedIds.push(...commit.mergedIds);
      this.logger.info('[skill-synthesis] umbrella suggestion proposed', {
        umbrellaId: commit.umbrellaId,
        clusterSize: plan.ordered.length,
        candidatesMerged: commit.mergedIds.length,
        suggestionsMerged: commit.suggestionsMerged,
        promotedMembers: plan.promoted.length,
        holdoutSessionId: plan.draft.holdoutSessionId,
        holdoutReason: plan.draft.reason,
        judgeScore,
      });
    } else {
      tally.umbrellasRejected += 1;
      tally.judgeRejectedMembers += commit.rejectedIds.length;
      this.logger.info('[skill-synthesis] umbrella judged below score', {
        umbrellaId: commit.umbrellaId,
        judgeScore,
        rejectedMembers: commit.rejectedIds.length,
      });
    }
  }

  /**
   * R1: judge-passed orphan candidates become `pending` suggestions with no
   * LLM call. Each one is its own transaction that first re-checks the row is
   * still a `candidate` in no suggestion, so a second host cannot surface it
   * twice. The SKILL.md read happens before the transaction, so no file I/O
   * runs while the write lock is held.
   */
  private surfaceSingletons(
    orphans: readonly PoolMember[],
    settings: SkillSynthesisSettings,
    tally: PassTally,
  ): void {
    const eligible = orphans
      .filter(
        (m): m is Extract<PoolMember, { kind: 'candidate' }> =>
          m.kind === 'candidate' && isJudgePassed(m.row, settings),
      )
      .slice(0, SINGLETON_MAX_PER_PASS);
    for (const { row } of eligible) {
      try {
        const input: NewSuggestionInput = {
          name: row.name,
          description: row.description,
          body: this.readCandidateBody(row),
          memberSessionIds: [...row.sourceSessionIds],
          memberCandidateIds: [row.id],
          clusterSize: 1,
          technologyFingerprint: this.technologyFingerprint([row]),
          judgeScore: row.judgeScore ?? 0,
        };
        const surfaced = this.store.inImmediateTransaction(() => {
          const current = this.store.findById(row.id);
          if (current?.status !== 'candidate') return false;
          if (this.suggestions.listMemberCandidateIds().has(row.id))
            return false;
          this.suggestions.insert(input, 'pending');
          return true;
        });
        if (surfaced) tally.singletonsSurfaced += 1;
      } catch (err: unknown) {
        this.logger.warn(
          '[skill-synthesis] singleton suggestion failed (rolled back; retried next pass)',
          {
            candidateId: row.id,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }
  }

  /**
   * The one-time backlog purge (scope 5, R5). Runs only when the marker is
   * absent, sqlite-vec is available and the pool was not truncated. One
   * transaction re-checks the marker, rejects every eligible candidate and
   * writes the marker; any throw rolls all of it back and the next pass
   * retries.
   */
  private runPurge(
    partition: PoolPartition,
    clusters: readonly PoolMember[][],
    settings: SkillSynthesisSettings,
    now: number,
    tally: PassTally,
  ): void {
    const skipped = this.purgePrecondition(partition);
    tally.purgeSkippedReason = skipped;
    if (skipped !== null) return;

    const clustered = new Set<string>();
    for (const cluster of clusters) {
      for (const member of cluster) {
        if (member.kind === 'candidate') clustered.add(member.row.id);
      }
    }
    try {
      const commit = this.store.inImmediateTransaction((): PurgeCommit =>
        this.purgeInTransaction(clustered, settings, now),
      );
      if (commit.kind === 'already-complete') {
        tally.purgeSkippedReason = 'already-complete';
      } else {
        tally.purgedIds.push(...commit.purgedIds);
        this.logger.info('[skill-synthesis] backlog purge complete', {
          purged: commit.purgedIds.length,
        });
      }
    } catch (err: unknown) {
      tally.purgeSkippedReason = 'failed';
      this.logger.warn(
        '[skill-synthesis] backlog purge failed (rolled back; no marker written, retried next pass)',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  private purgePrecondition(
    partition: PoolPartition,
  ): PurgeSkippedReason | null {
    if (this.purgeState.read() !== null) return 'already-complete';
    if (!partition.vecAvailable) return 'no-vec';
    if (partition.truncated) return 'pool-truncated';
    return null;
  }

  /**
   * The purge's transaction body: plain statements only (R-f), no catch
   * (R-f2). A candidate is rejected when it is older than the cutoff, in no
   * cluster this pass, not a member of a pending or accepted suggestion
   * (counting the ones written earlier this pass), has an embedding, and is
   * not judge-passed.
   */
  private purgeInTransaction(
    clustered: ReadonlySet<string>,
    settings: SkillSynthesisSettings,
    now: number,
  ): PurgeCommit {
    if (this.purgeState.read() !== null) return { kind: 'already-complete' };
    const cutoff = now - BACKLOG_PURGE_MIN_AGE_DAYS * DAY_MS;
    const kept = this.suggestions.listMemberCandidateIds({
      statuses: ['pending', 'accepted'],
    });
    const eligible = this.store
      .listByStatus('candidate')
      .filter(
        (row) =>
          row.createdAt < cutoff &&
          !clustered.has(row.id) &&
          !kept.has(row.id) &&
          !isJudgePassed(row, settings) &&
          row.embeddingRowid !== null &&
          this.store.getEmbedding(row.embeddingRowid) !== null,
      )
      .map((row) => row.id as string);
    const { rejectedIds: purgedIds } = this.rejectCandidates(
      eligible,
      BACKLOG_PURGE_REASON,
      now,
    );
    const written = this.purgeState.markComplete({
      cutoffCreatedAt: cutoff,
      completedAt: now,
      rejected: purgedIds.length,
    });
    if (!written) {
      throw new Error(
        '[skill-synthesis] backlog purge marker already written by another writer; purge rolled back',
      );
    }
    return { kind: 'purged', purgedIds };
  }

  private technologyFingerprint(members: SkillCandidateRow[]): string {
    const counts = new Map<string, number>();
    for (const m of members) {
      const body = this.readCandidateBody(m);
      const tools = body.match(/\[tool:([A-Za-z][\w-]*)/g) ?? [];
      for (const raw of tools) {
        const token = raw.replace('[tool:', '').toLowerCase();
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([token]) => token);
    return top.length > 0 ? top.join(',') : 'general';
  }

  private readCandidateBody(candidate: SkillCandidateRow): string {
    try {
      if (candidate.bodyPath && fsBody.existsSync(candidate.bodyPath)) {
        const raw = fsBody.readFileSync(candidate.bodyPath, 'utf8');
        return raw.replace(/^---[\s\S]*?---\s*/, '').trim();
      }
    } catch (err: unknown) {
      this.logger.debug('[skill-synthesis] could not read candidate body', {
        candidateId: candidate.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return `${candidate.name}\n\n${candidate.description}`;
  }
}

function isJudgePassed(
  row: SkillCandidateRow,
  settings: SkillSynthesisSettings,
): boolean {
  return (
    row.judgeStatus === 'scored' &&
    row.judgeScore !== null &&
    row.judgeScore >= settings.minJudgeScore
  );
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
