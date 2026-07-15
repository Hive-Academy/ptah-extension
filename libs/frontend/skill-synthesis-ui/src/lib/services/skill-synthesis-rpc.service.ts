import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  AgentScorecard,
  CloneSummary,
  SkillCloneInvocationStats,
  SkillCloneKind,
  SkillSynthesisGetScorecardDetailResult,
  SkillSuggestionDetail,
  SkillSuggestionSummary,
  SkillSynthesisCandidateDetail,
  SkillSynthesisCandidateSummary,
  SkillSynthesisEnhanceNowResult,
  SkillSynthesisGetCloneResult,
  SkillSynthesisInvocationEntry,
  SkillSynthesisKeepCloneResult,
  SkillSynthesisListCandidatesParams,
  SkillSynthesisPromoteBulkResult,
  SkillSynthesisPromoteResult,
  SkillSynthesisRebaseCloneResult,
  SkillSynthesisRejectByPatternResult,
  SkillSynthesisRevertEnhancementResult,
  SkillSynthesisRunCuratorResult,
  SkillSynthesisSettingsDto,
  SkillSynthesisStatsResult,
  SkillSynthesisUpdateSuggestionResult,
  SkillSynthesisSpecSummary,
  SkillSynthesisHarvestSpecsResult,
  SkillSynthesisClearStaleSpecsResult,
} from '@ptah-extension/shared';

export interface SkillAcceptSuggestionResult {
  readonly accepted: boolean;
  readonly filePath: string;
}

/**
 * Per-method RPC timeout budget for the skill-synthesis surface.
 *
 * - LIST_MS: list/get/stats reads — fast directory + DB queries.
 * - SHORT_MS: short writes (reject) and small reads (invocations).
 * - PROMOTE_MS: promotion involves writing SKILL.md to disk and may
 *   trigger reindex on the backend, so we allow more headroom.
 * - SETTINGS_MS: settings read/write — fast file I/O.
 * - CURATOR_MS: Curator LLM pass can take up to 60s; allow 90s total.
 */
const SKILL_RPC_TIMEOUTS = {
  LIST_MS: 10_000,
  SHORT_MS: 8_000,
  PROMOTE_MS: 20_000,
  SETTINGS_MS: 8_000,
  CURATOR_MS: 90_000,
  ENHANCE_MS: 90_000,
} as const;

/**
 * SkillSynthesisRpcService
 *
 * Thin facade over the `skillSynthesis:*` RPC methods (candidates, suggestions,
 * clones, settings, stats). Delegates to {@link ClaudeRpcService} for the
 * underlying message-bus call and normalises the result shape (throws on error,
 * returns typed result on success). Pattern matches `WizardRpcService`. Each
 * public method maps 1:1 to one RPC method.
 */
@Injectable({
  providedIn: 'root',
})
export class SkillSynthesisRpcService {
  private readonly rpcService = inject(ClaudeRpcService);

  /** List skill candidates filtered by status. */
  public async listCandidates(
    params: SkillSynthesisListCandidatesParams = {},
  ): Promise<SkillSynthesisCandidateSummary[]> {
    const result = await this.rpcService.call(
      'skillSynthesis:listCandidates',
      params,
      { timeout: SKILL_RPC_TIMEOUTS.LIST_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data.candidates;
    }
    throw new Error(result.error || 'Failed to list skill candidates');
  }

  /** Fetch a single candidate detail (with body + trajectory hash). */
  public async getCandidate(
    id: string,
  ): Promise<SkillSynthesisCandidateDetail | null> {
    const result = await this.rpcService.call(
      'skillSynthesis:getCandidate',
      { id },
      { timeout: SKILL_RPC_TIMEOUTS.LIST_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data.candidate;
    }
    throw new Error(result.error || 'Failed to get skill candidate');
  }

  /**
   * Promote a candidate to an active skill (writes SKILL.md to disk).
   * The optional `reason` is recorded as the promotion note.
   */
  public async promote(id: string): Promise<SkillSynthesisPromoteResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:promote',
      { id },
      { timeout: SKILL_RPC_TIMEOUTS.PROMOTE_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to promote skill candidate');
  }

  /** Reject a candidate, optionally persisting a rejection reason. */
  public async reject(id: string, reason?: string): Promise<boolean> {
    const result = await this.rpcService.call(
      'skillSynthesis:reject',
      reason ? { id, reason } : { id },
      { timeout: SKILL_RPC_TIMEOUTS.SHORT_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data.rejected;
    }
    throw new Error(result.error || 'Failed to reject skill candidate');
  }

  /**
   * Reject many candidates by id in one pass. Returns the number actually
   * rejected (already-rejected ids are skipped by the backend).
   */
  public async rejectBulk(ids: string[], reason?: string): Promise<number> {
    const result = await this.rpcService.call(
      'skillSynthesis:rejectBulk',
      reason ? { ids, reason } : { ids },
      { timeout: SKILL_RPC_TIMEOUTS.SHORT_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data.rejected;
    }
    throw new Error(result.error || 'Failed to reject skill candidates');
  }

  /**
   * Promote many candidates by id. Each candidate runs through the same
   * gate as single promotion, so the result carries a per-id decision list
   * alongside the count actually promoted.
   */
  public async promoteBulk(
    ids: string[],
  ): Promise<SkillSynthesisPromoteBulkResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:promoteBulk',
      { ids },
      { timeout: SKILL_RPC_TIMEOUTS.PROMOTE_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to promote skill candidates');
  }

  /**
   * Reject every pending candidate whose name matches the given glob-style
   * pattern (supports `*`). Returns how many matched and how many were
   * rejected.
   */
  public async rejectByPattern(
    pattern: string,
    reason?: string,
  ): Promise<SkillSynthesisRejectByPatternResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:rejectByPattern',
      reason ? { pattern, reason } : { pattern },
      { timeout: SKILL_RPC_TIMEOUTS.SHORT_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to reject skills by pattern');
  }

  /** Fetch invocation history for a single skill / candidate id. */
  public async invocations(
    skillId: string,
    limit?: number,
  ): Promise<SkillSynthesisInvocationEntry[]> {
    const result = await this.rpcService.call(
      'skillSynthesis:invocations',
      limit !== undefined ? { skillId, limit } : { skillId },
      { timeout: SKILL_RPC_TIMEOUTS.SHORT_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data.invocations;
    }
    throw new Error(result.error || 'Failed to load invocations');
  }

  /** Aggregate stats across all skill candidates and invocations. */
  public async stats(): Promise<SkillSynthesisStatsResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:stats',
      {},
      { timeout: SKILL_RPC_TIMEOUTS.LIST_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to load skill stats');
  }

  /** Fetch the full settings object from the backend. */
  public async getSettings(): Promise<SkillSynthesisSettingsDto> {
    const result = await this.rpcService.call(
      'skillSynthesis:getSettings',
      {},
      { timeout: SKILL_RPC_TIMEOUTS.SETTINGS_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data.settings;
    }
    throw new Error(result.error || 'Failed to load skill synthesis settings');
  }

  /** Persist a partial settings update. */
  public async updateSettings(
    settings: Partial<SkillSynthesisSettingsDto>,
  ): Promise<void> {
    const result = await this.rpcService.call(
      'skillSynthesis:updateSettings',
      { settings },
      { timeout: SKILL_RPC_TIMEOUTS.SETTINGS_MS },
    );
    if (!result.isSuccess()) {
      throw new Error(
        result.error || 'Failed to update skill synthesis settings',
      );
    }
  }

  /** Pin a promoted skill. Returns the new pinned state (true). */
  public async pin(id: string): Promise<boolean> {
    const result = await this.rpcService.call(
      'skillSynthesis:pin',
      { id },
      { timeout: SKILL_RPC_TIMEOUTS.SHORT_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data.pinned;
    }
    throw new Error(result.error || 'Failed to pin skill');
  }

  /** Unpin a promoted skill. Returns the new pinned state (false). */
  public async unpin(id: string): Promise<boolean> {
    const result = await this.rpcService.call(
      'skillSynthesis:unpin',
      { id },
      { timeout: SKILL_RPC_TIMEOUTS.SHORT_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data.pinned;
    }
    throw new Error(result.error || 'Failed to unpin skill');
  }

  /** Run the Curator pass and return the report. */
  public async runCurator(): Promise<SkillSynthesisRunCuratorResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:runCurator',
      {},
      { timeout: SKILL_RPC_TIMEOUTS.CURATOR_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to run curator');
  }

  /** List clone-layer entries (clone / authored / synth / diverged). */
  public async listClones(): Promise<CloneSummary[]> {
    const result = await this.rpcService.call(
      'skillSynthesis:listClones',
      {},
      { timeout: SKILL_RPC_TIMEOUTS.LIST_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data.clones;
    }
    throw new Error(result.error || 'Failed to list clones');
  }

  /** Fetch a single clone's detail (body + history list). */
  public async getClone(
    slug: string,
    kind: SkillCloneKind,
  ): Promise<SkillSynthesisGetCloneResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:getClone',
      { slug, kind },
      { timeout: SKILL_RPC_TIMEOUTS.LIST_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to get clone');
  }

  /** Manually trigger an enhancement pass for a clone (judge-gated). */
  public async enhanceNow(
    kind: SkillCloneKind,
    slug: string,
  ): Promise<SkillSynthesisEnhanceNowResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:enhanceNow',
      { kind, slug },
      { timeout: SKILL_RPC_TIMEOUTS.ENHANCE_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to enhance clone');
  }

  /** Revert an enhancement to a prior history snapshot. */
  public async revertEnhancement(
    kind: SkillCloneKind,
    slug: string,
    historyTs: string,
  ): Promise<SkillSynthesisRevertEnhancementResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:revertEnhancement',
      { kind, slug, historyTs },
      { timeout: SKILL_RPC_TIMEOUTS.PROMOTE_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to revert enhancement');
  }

  /** Rebase a diverged clone onto the immutable upstream source. */
  public async rebaseClone(
    kind: SkillCloneKind,
    slug: string,
  ): Promise<SkillSynthesisRebaseCloneResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:rebaseClone',
      { kind, slug },
      { timeout: SKILL_RPC_TIMEOUTS.PROMOTE_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to rebase clone');
  }

  /** Keep the local clone for a diverged entry (adopt pending source hash). */
  public async keepClone(
    kind: SkillCloneKind,
    slug: string,
  ): Promise<SkillSynthesisKeepCloneResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:keepClone',
      { kind, slug },
      { timeout: SKILL_RPC_TIMEOUTS.SHORT_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to keep clone');
  }

  /** Fetch slug-keyed invocation stats from the events table. */
  public async invocationStats(
    slug: string,
  ): Promise<SkillCloneInvocationStats> {
    const result = await this.rpcService.call(
      'skillSynthesis:invocationStats',
      { slug },
      { timeout: SKILL_RPC_TIMEOUTS.SHORT_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data.stats;
    }
    throw new Error(result.error || 'Failed to load invocation stats');
  }

  /**
   * Batched per-subagent scorecards for the given agent-kind slugs. One RPC
   * call powers every visible agent clone card (R6/NFR perf). Slugs absent
   * from the result have no graded/usage data yet — the UI treats a missing
   * entry as "no data yet".
   */
  public async getScorecards(
    slugs: string[],
  ): Promise<Record<string, AgentScorecard>> {
    const result = await this.rpcService.call(
      'skillSynthesis:getScorecards',
      { slugs },
      { timeout: SKILL_RPC_TIMEOUTS.LIST_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data.scorecards;
    }
    throw new Error(result.error || 'Failed to load scorecards');
  }

  /**
   * Lazily-loaded scorecard detail (recent graded invocation rows + a bounded
   * findings excerpt) for a single agent slug — fetched only on card
   * expansion, never during the Library list render (R7/NFR perf).
   */
  public async getScorecardDetail(
    slug: string,
    limit?: number,
  ): Promise<SkillSynthesisGetScorecardDetailResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:getScorecardDetail',
      limit !== undefined ? { slug, limit } : { slug },
      { timeout: SKILL_RPC_TIMEOUTS.LIST_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to load scorecard detail');
  }

  /** List cluster-derived skill suggestions awaiting human decision. */
  public async listSuggestions(): Promise<SkillSuggestionSummary[]> {
    const result = await this.rpcService.call(
      'skillSynthesis:listSuggestions',
      {},
      { timeout: SKILL_RPC_TIMEOUTS.LIST_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data.suggestions;
    }
    throw new Error(result.error || 'Failed to list skill suggestions');
  }

  /** Accept a suggestion, materializing a promoted SKILL.md on disk. */
  public async acceptSuggestion(
    id: string,
  ): Promise<SkillAcceptSuggestionResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:acceptSuggestion',
      { id },
      { timeout: SKILL_RPC_TIMEOUTS.PROMOTE_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to accept skill suggestion');
  }

  /** Fetch a single suggestion's full detail (includes the SKILL.md body). */
  public async getSuggestion(
    id: string,
  ): Promise<SkillSuggestionDetail | null> {
    const result = await this.rpcService.call(
      'skillSynthesis:getSuggestion',
      { id },
      { timeout: SKILL_RPC_TIMEOUTS.LIST_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data.suggestion;
    }
    throw new Error(result.error || 'Failed to get skill suggestion');
  }

  /**
   * Edit a still-pending suggestion's name/description/body before accepting.
   * Returns the updated detail (or null when the suggestion no longer exists).
   */
  public async updateSuggestion(
    id: string,
    fields: { name?: string; description?: string; body?: string },
  ): Promise<SkillSynthesisUpdateSuggestionResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:updateSuggestion',
      { id, ...fields },
      { timeout: SKILL_RPC_TIMEOUTS.SHORT_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to update skill suggestion');
  }

  /** Dismiss a suggestion, optionally persisting a dismissal reason. */
  public async dismissSuggestion(
    id: string,
    reason?: string,
  ): Promise<boolean> {
    const result = await this.rpcService.call(
      'skillSynthesis:dismissSuggestion',
      reason ? { id, reason } : { id },
      { timeout: SKILL_RPC_TIMEOUTS.SHORT_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data.dismissed;
    }
    throw new Error(result.error || 'Failed to dismiss skill suggestion');
  }

  /** List orchestration specs under `.ptah/specs`, classified for cleanup. */
  public async listSpecs(): Promise<SkillSynthesisSpecSummary[]> {
    const result = await this.rpcService.call(
      'skillSynthesis:listSpecs',
      {},
      { timeout: SKILL_RPC_TIMEOUTS.LIST_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data.specs;
    }
    throw new Error(result.error || 'Failed to list specs');
  }

  /** Reconcile completed specs into skill telemetry now. */
  public async harvestSpecs(): Promise<SkillSynthesisHarvestSpecsResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:harvestSpecs',
      {},
      { timeout: SKILL_RPC_TIMEOUTS.CURATOR_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to harvest specs');
  }

  /** Archive (or delete) completed + harvested specs older than retention. */
  public async clearStaleSpecs(
    options: { retentionDays?: number; mode?: 'archive' | 'delete' } = {},
  ): Promise<SkillSynthesisClearStaleSpecsResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:clearStaleSpecs',
      options,
      { timeout: SKILL_RPC_TIMEOUTS.PROMOTE_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to clear stale specs');
  }
}
