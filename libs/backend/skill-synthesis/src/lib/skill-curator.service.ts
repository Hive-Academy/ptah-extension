/**
 * SkillCuratorService — scheduler and facade for every curator-hosted skill
 * lifecycle pass (TASK_2026_578).
 *
 * One pass, in order, each step in its own try/catch so one failure never
 * stops the others:
 *  1. retirement — dormancy and retirement of idle promoted skills
 *     ({@link SkillRetirementService});
 *  2. umbrella merge — clusters of candidates, pending suggestions and
 *     promoted skills become umbrella suggestions; singletons; the one-time
 *     backlog purge ({@link SkillUmbrellaMergeService});
 *  3. clone enhancement (unchanged);
 *  4. a markdown report under `~/.ptah/curator-reports/`;
 *  5. the `curator-pass` event carrying the pass stats.
 *
 * Accepting a suggestion promotes it through
 * {@link SkillPromotionService.promoteSuggestion}. Inside that promotion's ONE
 * transaction the `onCommit` callback marks the suggestion accepted (with its
 * promoted candidate) and merges its members: plain-statement writes only
 * (R-f), and no catch inside the callback (R-f2). The fail-soft
 * `{accepted:false}` comes from a catch around the whole promotion call, after
 * rollback. Merged promoted members' directories are removed after commit.
 *
 * `start()` first reconciles suggestions accepted before promotion created a
 * candidate row, adopting the skill their acceptance materialized
 * ({@link SkillCuratorService.reconcileAcceptedSuggestions}).
 *
 * Exempt slugs: the curator builds ONE set — registry `kind='skill'` rows that
 * are `authored` or `diverged` (lowercased, as the retirement sweep compares
 * them) plus the exact names of pinned promoted rows and of promoted rows that
 * match an exempt slug in any letter case. `partitionPool` compares names
 * exactly and the umbrella guard compares lowercased, so both see the same
 * set.
 */
import type { QueryOrigin } from './internal-query.interface';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  type CuratorRateLimitService,
} from '@ptah-extension/agent-sdk';
import { SkillCandidateStore } from './skill-candidate.store';
import {
  SkillRegistryStore,
  type SkillRegistryKind,
} from './skill-registry.store';
import {
  SkillEnhancerService,
  MIN_INVOCATIONS_TO_ENHANCE,
} from './skill-enhancer.service';
import { SkillMdGenerator } from './skill-md-generator';
import { SkillSuggestionStore } from './skill-suggestion.store';
import {
  SUGGESTION_TRAJECTORY_PREFIX,
  type ResidentPromotion,
  type SkillPromotionService,
} from './skill-promotion.service';
import type { SkillRetirementService } from './lifecycle/skill-retirement.service';
import type { SkillUmbrellaMergeService } from './lifecycle/skill-umbrella-merge.service';
import {
  writeCuratorReport,
  type CuratorPassStats,
} from './lifecycle/curator-report';
import {
  findAdoptableSlug,
  slugHolderDecision,
  type AdoptableSlug,
} from './lifecycle/adoptable-slug';
import {
  MERGED_INTO_PREFIX,
  type CandidateId,
  type SkillCandidateRow,
  type SkillSuggestionRow,
  type SkillSynthesisSettings,
} from './types';
import { SKILL_SYNTHESIS_TOKENS } from './di/tokens';

/** Rate-limit bucket key + cap for auto-enhancement passes. */
const ENHANCE_RATE_LIMIT_KEY = 'skill.enhance';
const ENHANCE_MAX_PER_HOUR = 3;
const ENHANCE_MAX_SLUGS_PER_PASS = 3;

export interface AcceptSuggestionResult {
  accepted: boolean;
  filePath: string;
}

export interface DismissSuggestionResult {
  dismissed: boolean;
}

export type { CuratorPassStats } from './lifecycle/curator-report';

export interface CuratorReport {
  reportPath: string;
  /** merged + dormant + retired + purged. */
  changesQueued: number;
  skippedPinned: number;
  suggestionsCreated: number;
  /** Per-step detail of the same pass. */
  lifecycle: CuratorPassStats;
}

export interface SkillCuratorStartOptions {
  readonly onPassComplete?: (timestamp: number) => void;
  readonly onEvent?: (event: {
    kind: 'curator-pass-start' | 'curator-pass';
    timestamp: number;
    stats?: Record<string, number | string | boolean | null>;
  }) => void;
}

/** What an accept or adopt merged inside its transaction. */
interface MemberMerge {
  /** Promoted members rejected `merged-into:`; their directories go after commit. */
  readonly mergedPromoted: SkillCandidateRow[];
  readonly mergedCandidates: number;
  readonly skippedPinned: number;
  /** Promoted members kept because their slug is user-owned (or unknown). */
  readonly skippedExempt: number;
}

/** Outcome counts of one startup reconcile. */
export interface ReconcileResult {
  readonly adopted: number;
  /** No (or no provable) materialized directory; retried next start. */
  readonly missing: number;
  /** More than one provable directory; retried next start. */
  readonly ambiguous: number;
  /** The slug is held by a live candidate or a merged row (UNIQUE on name). */
  readonly blockedByCandidateRow: number;
  /** The adopt call threw (rolled back); retried next start. */
  readonly failed: number;
}

type RetirementStepStats = Pick<
  CuratorPassStats,
  | 'dormant'
  | 'retired'
  | 'skippedPinned'
  | 'skippedUncontained'
  | 'retirementSkippedReason'
>;
type UmbrellaStepStats = Omit<CuratorPassStats, keyof RetirementStepStats>;

const EMPTY_RECONCILE: ReconcileResult = {
  adopted: 0,
  missing: 0,
  ambiguous: 0,
  blockedByCandidateRow: 0,
  failed: 0,
};

/** A step that did not run (it threw, or its input was unavailable). */
const NOT_RUN_RETIREMENT: RetirementStepStats = {
  dormant: 0,
  retired: 0,
  skippedPinned: 0,
  skippedUncontained: 0,
  retirementSkippedReason: 'failed',
};
const NOT_RUN_UMBRELLA: UmbrellaStepStats = {
  suggestionsCreated: 0,
  umbrellasCreated: 0,
  umbrellasRejected: 0,
  judgeRejectedMembers: 0,
  singletonsSurfaced: 0,
  merged: 0,
  suggestionsMerged: 0,
  purged: 0,
  clustersRemaining: 0,
  rateLimited: false,
  purgeSkippedReason: 'failed',
  umbrellaSkippedReason: 'failed',
};
/** The stats of the empty report `runManual` answers before `start`. */
const EMPTY_STATS: CuratorPassStats = {
  ...NOT_RUN_RETIREMENT,
  ...NOT_RUN_UMBRELLA,
  retirementSkippedReason: null,
  umbrellaSkippedReason: null,
  purgeSkippedReason: null,
};

@injectable()
export class SkillCuratorService {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private currentSettings: SkillSynthesisSettings | null = null;
  private onPassComplete: ((timestamp: number) => void) | null = null;
  private onEvent: SkillCuratorStartOptions['onEvent'] | null = null;
  /** The in-flight startup reconcile; a pass waits for it. */
  private reconciliation: Promise<ReconcileResult> | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SkillCandidateStore)
    private readonly store: SkillCandidateStore,
    @inject(SDK_TOKENS.SDK_CURATOR_RATE_LIMIT)
    private readonly rateLimiter: CuratorRateLimitService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE, { isOptional: true })
    private readonly registry: SkillRegistryStore | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_ENHANCER_SERVICE, { isOptional: true })
    private readonly enhancer: SkillEnhancerService | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_SUGGESTION_STORE)
    private readonly suggestionStore: SkillSuggestionStore,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_UMBRELLA_MERGE_SERVICE)
    private readonly umbrella: SkillUmbrellaMergeService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_RETIREMENT_SERVICE)
    private readonly retirement: SkillRetirementService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_PROMOTION_SERVICE)
    private readonly promotion: SkillPromotionService,
    /** Read only for `activeRoot()`: the reconcile's `<activeRoot>/<slug>` rule (A1). */
    @inject(SkillMdGenerator)
    private readonly mdGenerator: SkillMdGenerator,
  ) {}

  start(
    settings: SkillSynthesisSettings,
    options?: SkillCuratorStartOptions,
  ): void {
    this.currentSettings = settings;
    this.onPassComplete = options?.onPassComplete ?? null;
    this.onEvent = options?.onEvent ?? null;
    // Data repair, not curation: it runs even with the curator disabled.
    this.startReconciliation(settings);
    if (!settings.curatorEnabled) {
      this.logger.info('[skill-curator] disabled via settings; not scheduling');
      return;
    }
    const intervalMs = settings.curatorIntervalHours * 3_600_000;
    this.logger.info('[skill-curator] scheduling periodic pass', {
      intervalHours: settings.curatorIntervalHours,
    });
    this.intervalHandle = setInterval(() => {
      const s = this.currentSettings;
      if (!s) return;
      void this.runPass(s).catch((err: unknown) => {
        this.logger.warn('[skill-curator] runPass error', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.onPassComplete = null;
    this.onEvent = null;
  }

  /**
   * One pass now (RPC `skillSynthesis:runCurator`). The RPC handler passes
   * `userInitiated: true`; the interval in {@link start} never does.
   */
  runManual(origin: QueryOrigin = {}): Promise<CuratorReport> {
    if (!this.currentSettings) {
      this.logger.warn(
        '[skill-curator] runManual called before start (no settings); returning empty report',
      );
      return Promise.resolve(this.emptyReport());
    }
    return this.runPass(this.currentSettings, origin);
  }

  private async runPass(
    settings: SkillSynthesisSettings,
    origin: QueryOrigin = {},
  ): Promise<CuratorReport> {
    if (this.reconciliation) await this.reconciliation;
    this.onEvent?.({ kind: 'curator-pass-start', timestamp: Date.now() });

    const retirement = await this.runRetirementStep(origin);
    const umbrella = await this.runUmbrellaStep(settings, origin);
    await this.runEnhancementPass(settings, origin);

    const stats: CuratorPassStats = { ...retirement, ...umbrella };
    const changesQueued =
      stats.merged + stats.dormant + stats.retired + stats.purged;
    const reportPath = this.writeReport(stats, changesQueued);

    this.onEvent?.({
      kind: 'curator-pass',
      timestamp: Date.now(),
      stats: { ...stats, changesQueued },
    });
    try {
      this.onPassComplete?.(Date.now());
    } catch (err: unknown) {
      this.logger.warn('[skill-curator] onPassComplete callback threw', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      reportPath,
      changesQueued,
      skippedPinned: stats.skippedPinned,
      suggestionsCreated: stats.suggestionsCreated,
      lifecycle: stats,
    };
  }

  private async runRetirementStep(
    origin: QueryOrigin,
  ): Promise<RetirementStepStats> {
    let step = NOT_RUN_RETIREMENT;
    try {
      const result = await this.retirement.run(origin);
      step = {
        dormant: result.dormant,
        retired: result.retired,
        skippedPinned: result.skippedPinned,
        skippedUncontained: result.skippedUncontained,
        retirementSkippedReason: result.skippedReason ?? null,
      };
    } catch (err: unknown) {
      this.logger.warn('[skill-curator] retirement pass threw', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return step;
  }

  private async runUmbrellaStep(
    settings: SkillSynthesisSettings,
    origin: QueryOrigin,
  ): Promise<UmbrellaStepStats> {
    // Fail closed: without the user-owned set an umbrella could absorb an
    // authored skill, and accepting it would delete that skill's folder.
    const exempt = this.readExemptSlugs();
    let step: UmbrellaStepStats = exempt
      ? NOT_RUN_UMBRELLA
      : { ...NOT_RUN_UMBRELLA, umbrellaSkippedReason: 'registry-unavailable' };
    if (exempt) {
      try {
        const result = await this.umbrella.runPass(settings, exempt, origin);
        step = {
          suggestionsCreated:
            result.umbrellasCreated + result.singletonsSurfaced,
          umbrellasCreated: result.umbrellasCreated,
          umbrellasRejected: result.umbrellasRejected,
          judgeRejectedMembers: result.judgeRejectedMembers,
          singletonsSurfaced: result.singletonsSurfaced,
          merged: result.candidatesMerged,
          suggestionsMerged: result.suggestionsMerged,
          purged: result.purged,
          purgeSkippedReason: result.purgeSkippedReason,
          clustersRemaining: result.clustersRemaining,
          rateLimited: result.rateLimited,
          umbrellaSkippedReason: null,
        };
      } catch (err: unknown) {
        this.logger.warn('[skill-curator] umbrella pass threw', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return step;
  }

  /**
   * Accept a pending suggestion: promote it as a resident skill, mark it
   * accepted with its promoted candidate, and merge its members — one
   * transaction. Then remove the merged promoted members' directories.
   *
   * `origin`: the `skillSynthesis:acceptSuggestion` click passes
   * `userInitiated: true`, so the re-propagation never waits for the
   * background-work governor (TASK_2026_437 FU-17b).
   */
  async acceptSuggestion(
    id: string,
    settings: SkillSynthesisSettings,
    origin: QueryOrigin = {},
  ): Promise<AcceptSuggestionResult> {
    const suggestion = this.suggestionStore.findById(id);
    if (!suggestion || suggestion.status !== 'pending') {
      return { accepted: false, filePath: '' };
    }
    const exempt = this.readExemptSlugs();
    let promotion: ResidentPromotion<MemberMerge> | null = null;
    try {
      promotion = await this.promotion.promoteSuggestion(
        { suggestion, embedding: this.memberCentroid(suggestion) },
        settings,
        origin,
        (row) => this.commitAccept(suggestion.id, row, suggestion, exempt),
      );
    } catch (err: unknown) {
      // The promotion rolled back and removed its directory; the suggestion is
      // still pending, so the user can retry.
      this.logger.warn(
        '[skill-curator] accept failed; suggestion left pending',
        {
          id,
          errorName: err instanceof Error ? err.name : typeof err,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
    if (!promotion) return { accepted: false, filePath: '' };
    await this.afterMerge(id, promotion.outcome, origin);
    return { accepted: true, filePath: promotion.filePath };
  }

  /**
   * `onCommit` of an accept, INSIDE the promotion transaction: plain
   * statements only, no catch (R-f, R-f2). A suggestion another writer
   * decided first throws, rolling the promotion back.
   */
  private commitAccept(
    id: string,
    row: SkillCandidateRow,
    suggestion: SkillSuggestionRow,
    exempt: ReadonlySet<string> | null,
  ): MemberMerge {
    const accepted = this.suggestionStore.accept(id, row.id);
    if (
      accepted?.status !== 'accepted' ||
      accepted.promotedCandidateId !== row.id
    ) {
      throw new Error(
        `[skill-curator] suggestion ${id} is no longer pending; accept rolled back`,
      );
    }
    return this.mergeMembers(suggestion, row.id, exempt);
  }

  /**
   * Reject every member still `candidate` or `promoted` with
   * `merged-into:<suggestion id>`, compare-and-set. Pinned members are
   * skipped, and so are promoted members whose slug is user-owned or unknown
   * (`exempt === null`). A merged promoted member's `synth` registry row is
   * deleted in the same transaction. Plain statements only, no catch.
   */
  private mergeMembers(
    suggestion: SkillSuggestionRow,
    promotedId: CandidateId,
    exempt: ReadonlySet<string> | null,
  ): MemberMerge {
    const reason = MERGED_INTO_PREFIX + suggestion.id;
    const mergedPromoted: SkillCandidateRow[] = [];
    let mergedCandidates = 0;
    let skippedPinned = 0;
    let skippedExempt = 0;
    for (const memberId of new Set(suggestion.memberCandidateIds)) {
      const member =
        memberId === promotedId
          ? null
          : this.store.findById(memberId as CandidateId);
      if (member?.pinned) {
        skippedPinned++;
      } else if (member?.status === 'candidate') {
        if (this.store.rejectIfStatus(member.id, 'candidate', reason)) {
          mergedCandidates++;
        }
      } else if (member?.status === 'promoted') {
        if (exempt === null || isExempt(exempt, member.name)) {
          skippedExempt++;
        } else if (this.store.rejectIfStatus(member.id, 'promoted', reason)) {
          this.registry?.remove('skill', member.name);
          mergedPromoted.push(member);
        }
      }
    }
    return { mergedPromoted, mergedCandidates, skippedPinned, skippedExempt };
  }

  /** After commit: remove merged promoted members' directories, then log. */
  private async afterMerge(
    suggestionId: string,
    merge: MemberMerge,
    origin: QueryOrigin,
  ): Promise<void> {
    let removed: string[] = [];
    if (merge.mergedPromoted.length > 0) {
      try {
        removed = await this.retirement.removeMaterializations(
          merge.mergedPromoted,
          origin,
        );
      } catch (err: unknown) {
        this.logger.warn(
          '[skill-curator] merged skill directories not removed (the merge is committed)',
          {
            suggestionId,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }
    this.logger.info('[skill-curator] suggestion members merged', {
      suggestionId,
      mergedCandidates: merge.mergedCandidates,
      mergedPromoted: merge.mergedPromoted.map((r) => r.name),
      removedDirectories: removed,
      skippedPinned: merge.skippedPinned,
      skippedExempt: merge.skippedExempt,
    });
  }

  /** Runs one reconcile at a time; never rejects. */
  private startReconciliation(settings: SkillSynthesisSettings): void {
    if (this.reconciliation) return;
    this.reconciliation = this.reconcileAcceptedSuggestions(settings)
      .catch((err: unknown): ReconcileResult => {
        this.logger.warn(
          '[skill-curator] accepted-suggestion reconcile threw',
          {
            error: err instanceof Error ? err.message : String(err),
          },
        );
        return { ...EMPTY_RECONCILE, failed: 1 };
      })
      .finally(() => {
        this.reconciliation = null;
      });
  }

  /**
   * Link suggestions accepted before promotion created a candidate row to the
   * skill their acceptance materialized, through
   * {@link SkillPromotionService.adoptMaterializedSkill}. Idempotent: only
   * rows with no `promoted_candidate_id` are read, and the link is written in
   * the adopt transaction.
   *
   * A directory is adopted only when it is PROVEN to be the suggestion's
   * ({@link findAdoptableSlug}): a `-2`…`-5`-aware slug match plus either a
   * body-equal SKILL.md under an `authored`/`synth` registry row, or any
   * SKILL.md under a `diverged`, non-plugin row (the user edited it; the row
   * stays `diverged`, so retirement keeps exempting it). A name match alone
   * never adopts a hand-written skill.
   *
   * The row already named after the slug (UNIQUE on `name`) decides the path
   * ({@link slugHolderDecision}): a `rejected` one (not merged) is re-promoted
   * in place; a live `candidate` or a `merged-into:` row is skipped with a
   * warn and counted. Missing, ambiguous and failed rows are left for the next
   * start.
   */
  private async reconcileAcceptedSuggestions(
    settings: SkillSynthesisSettings,
  ): Promise<ReconcileResult> {
    const counts: { -readonly [K in keyof ReconcileResult]: number } = {
      ...EMPTY_RECONCILE,
    };
    const rows = this.suggestionStore.listAcceptedWithoutPromotedCandidate();
    if (rows.length === 0) return counts;
    const exempt = this.readExemptSlugs();
    for (const suggestion of rows) {
      const outcome = await this.reconcileOne(suggestion, settings, exempt);
      counts[outcome] += 1;
    }
    this.logger.info('[skill-curator] accepted-suggestion reconcile done', {
      ...counts,
    });
    return counts;
  }

  private async reconcileOne(
    suggestion: SkillSuggestionRow,
    settings: SkillSynthesisSettings,
    exempt: ReadonlySet<string> | null,
  ): Promise<keyof ReconcileResult> {
    const found: AdoptableSlug = this.registry
      ? findAdoptableSlug(
          suggestion,
          this.registry,
          this.mdGenerator.activeRoot(),
          this.logger,
        )
      : { kind: 'missing' };
    if (found.kind !== 'found') {
      this.logger.warn(
        '[skill-curator] accepted suggestion has no provable skill directory; left for next start',
        {
          suggestionId: suggestion.id,
          name: suggestion.name,
          reason: found.kind,
          slugs: found.kind === 'ambiguous' ? found.slugs : [],
        },
      );
      return found.kind;
    }
    const holder = this.store.findByName(found.slug);
    const holderPath = slugHolderDecision(holder);
    if (holder && holderPath === 'blocked') {
      this.logger.warn(
        '[skill-curator] accepted suggestion slug is held by a non-promoted candidate; not adopted',
        {
          suggestionId: suggestion.id,
          slug: found.slug,
          candidateId: holder.id,
          status: holder.status,
        },
      );
      return 'blockedByCandidateRow';
    }
    let adopted: ResidentPromotion<MemberMerge> | null = null;
    try {
      adopted = await this.promotion.adoptMaterializedSkill(
        {
          slug: found.slug,
          filePath: found.filePath,
          description: suggestion.description,
          sourceSessionIds: [...suggestion.memberSessionIds],
          embedding: this.memberCentroid(suggestion),
          trajectoryKey: `${SUGGESTION_TRAJECTORY_PREFIX}${suggestion.id}`,
          repromoteRejectedId:
            holderPath === 'repromote-rejected' ? holder?.id : undefined,
        },
        settings,
        (row) => this.commitReconcile(suggestion, row, exempt),
      );
    } catch (err: unknown) {
      this.logger.warn(
        '[skill-curator] adopting an accepted suggestion failed (rolled back; retried next start)',
        {
          suggestionId: suggestion.id,
          slug: found.slug,
          errorName: err instanceof Error ? err.name : typeof err,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
    if (!adopted) return 'failed';
    this.logger.info('[skill-curator] accepted suggestion adopted', {
      suggestionId: suggestion.id,
      slug: found.slug,
      candidateId: adopted.candidate.id,
      path: holderPath,
      proof: found.proof,
    });
    await this.afterMerge(suggestion.id, adopted.outcome, {});
    return 'adopted';
  }

  /** `onCommit` of an adopt: link the lineage, merge members. No catch. */
  private commitReconcile(
    suggestion: SkillSuggestionRow,
    row: SkillCandidateRow,
    exempt: ReadonlySet<string> | null,
  ): MemberMerge {
    if (!this.suggestionStore.linkPromotedCandidate(suggestion.id, row.id)) {
      throw new Error(
        `[skill-curator] suggestion ${suggestion.id} is no longer accepted-unlinked; adopt rolled back`,
      );
    }
    return this.mergeMembers(suggestion, row.id, exempt);
  }

  /**
   * The mean of the member candidates' embeddings over their most common
   * dimension, or `null` when none has one (sqlite-vec unavailable).
   */
  private memberCentroid(suggestion: SkillSuggestionRow): Float32Array | null {
    const vectors: Float32Array[] = [];
    for (const id of new Set(suggestion.memberCandidateIds)) {
      const rowid = this.store.findById(id as CandidateId)?.embeddingRowid;
      const vec = rowid == null ? null : this.store.getEmbedding(rowid);
      if (vec) vectors.push(vec);
    }
    if (vectors.length === 0) return null;
    const byDimension = new Map<number, Float32Array[]>();
    for (const v of vectors) {
      byDimension.set(v.length, [...(byDimension.get(v.length) ?? []), v]);
    }
    const group = [...byDimension.values()].reduce<Float32Array[]>(
      (a, b) => (b.length > a.length ? b : a),
      [],
    );
    const centroid = new Float32Array(group[0].length);
    for (const v of group) {
      for (let d = 0; d < v.length; d++) centroid[d] += v[d] / group.length;
    }
    return centroid;
  }

  /**
   * The ONE exempt set handed to the umbrella pass and the accept merge (see
   * the file header). `null` (logged) when no registry is bound or it cannot
   * be read: callers then fail closed. Built in a local and published only
   * after both reads succeed, so a throw never yields a partial set.
   */
  private readExemptSlugs(): Set<string> | null {
    if (!this.registry) {
      this.logger.warn(
        '[skill-curator] no skill registry bound; exempt set unknown',
      );
      return null;
    }
    let exempt: Set<string> | null = null;
    try {
      const owned = new Set(
        this.registry
          .listAll()
          .filter(
            (e) =>
              e.kind === 'skill' &&
              (e.cloneStatus === 'authored' || e.cloneStatus === 'diverged'),
          )
          .map((e) => e.slug.toLowerCase()),
      );
      const built = new Set(owned);
      for (const row of this.store.listByStatus('promoted')) {
        if (row.pinned || owned.has(row.name.toLowerCase())) {
          built.add(row.name);
        }
      }
      exempt = built;
    } catch (err: unknown) {
      this.logger.warn('[skill-curator] failed to read the exempt skill set', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return exempt;
  }

  dismissSuggestion(id: string): DismissSuggestionResult {
    const row = this.suggestionStore.dismiss(id);
    return { dismissed: row?.status === 'dismissed' };
  }

  listSuggestions(
    status: SkillSuggestionRow['status'] = 'pending',
  ): SkillSuggestionRow[] {
    return this.suggestionStore.listByStatus(status);
  }

  private async runEnhancementPass(
    settings: SkillSynthesisSettings,
    origin: QueryOrigin,
  ): Promise<void> {
    if (!this.registry || !this.enhancer) {
      return;
    }

    let eligible: Array<{
      slug: string;
      kind: SkillRegistryKind;
      failed: number;
      total: number;
    }>;
    try {
      eligible = this.selectEnhancementCandidates(settings);
    } catch (err: unknown) {
      // degradation-audit: optional-capability - Automatic clone enhancement is
      // an optional curator pass, so selection failure skips only that pass.
      this.logger.warn('[skill-curator] enhancement selection failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let enhancedThisPass = 0;
    for (const candidate of eligible) {
      if (enhancedThisPass >= ENHANCE_MAX_SLUGS_PER_PASS) break;
      const decision = this.rateLimiter.tryAcquire(
        ENHANCE_RATE_LIMIT_KEY,
        ENHANCE_MAX_PER_HOUR,
      );
      if (!decision.allowed) {
        this.logger.info('[skill-curator] enhancement rate-limited', {
          resetAt: decision.resetAt,
        });
        break;
      }
      try {
        // `userInitiated` but NOT `manual`: a manual curator run still honours
        // the auto-enhance cooldown and floor; it only skips the governor.
        const result = await this.enhancer.enhance(candidate.slug, settings, {
          kind: candidate.kind,
          userInitiated: origin.userInitiated,
        });
        if (result.changed) {
          enhancedThisPass += 1;
          this.logger.info('[skill-curator] auto-enhanced clone', {
            slug: candidate.slug,
            judgeScore: result.judgeScore,
          });
        }
      } catch (err: unknown) {
        this.logger.warn('[skill-curator] enhance threw', {
          slug: candidate.slug,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private selectEnhancementCandidates(settings: SkillSynthesisSettings): Array<{
    slug: string;
    kind: SkillRegistryKind;
    failed: number;
    total: number;
  }> {
    if (!this.registry || !this.enhancer) return [];
    const rows = this.registry.listAll();
    const selected: Array<{
      slug: string;
      kind: SkillRegistryKind;
      failed: number;
      total: number;
    }> = [];
    for (const row of rows) {
      const stats = this.store.getInvocationStats(row.slug);
      if (stats.total < MIN_INVOCATIONS_TO_ENHANCE) continue;
      if (!this.enhancer.isEligible(row.slug, settings, row.kind)) continue;
      selected.push({
        slug: row.slug,
        kind: row.kind,
        failed: stats.failed,
        total: stats.total,
      });
    }
    selected.sort((a, b) => b.failed - a.failed || b.total - a.total);
    return selected;
  }

  /** `''` (logged) when the report cannot be written. */
  private writeReport(stats: CuratorPassStats, changesQueued: number): string {
    let reportPath = '';
    try {
      reportPath = writeCuratorReport(stats, changesQueued);
      this.logger.info('[skill-curator] report written', { reportPath });
    } catch (err: unknown) {
      this.logger.warn('[skill-curator] could not write report', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return reportPath;
  }

  private emptyReport(): CuratorReport {
    return {
      reportPath: '',
      changesQueued: 0,
      skippedPinned: 0,
      suggestionsCreated: 0,
      lifecycle: EMPTY_STATS,
    };
  }
}

/** Exact name, or its lowercase form (registry slugs are stored lowercased). */
function isExempt(exempt: ReadonlySet<string>, name: string): boolean {
  return exempt.has(name) || exempt.has(name.toLowerCase());
}
