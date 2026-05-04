import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  SkillSynthesisCandidateDetail,
  SkillSynthesisCandidateSummary,
  SkillSynthesisInvocationEntry,
  SkillSynthesisListCandidatesParams,
  SkillSynthesisPromoteResult,
  SkillSynthesisStatsResult,
} from '@ptah-extension/shared';

/**
 * Per-method RPC timeout budget for the skill-synthesis surface.
 *
 * - LIST_MS: list/get/stats reads — fast directory + DB queries.
 * - SHORT_MS: short writes (reject) and small reads (invocations).
 * - PROMOTE_MS: promotion involves writing SKILL.md to disk and may
 *   trigger reindex on the backend, so we allow more headroom.
 */
const SKILL_RPC_TIMEOUTS = {
  LIST_MS: 10_000,
  SHORT_MS: 8_000,
  PROMOTE_MS: 20_000,
} as const;

/**
 * SkillSynthesisRpcService
 *
 * Thin facade for the six skill-synthesis RPC methods. Delegates to
 * {@link ClaudeRpcService} for the underlying message-bus call and
 * normalises the result shape (throws on error, returns typed result
 * on success). Pattern matches `WizardRpcService`.
 *
 * Supported RPC methods:
 * - `skillSynthesis:listCandidates`
 * - `skillSynthesis:getCandidate`
 * - `skillSynthesis:promote`
 * - `skillSynthesis:reject`
 * - `skillSynthesis:invocations`
 * - `skillSynthesis:stats`
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
}
