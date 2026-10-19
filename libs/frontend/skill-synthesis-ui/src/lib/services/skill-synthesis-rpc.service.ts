import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  AgentScorecard,
  CloneSummary,
  ProviderListModelsResult,
  SkillCloneKind,
  SkillSynthesisGetScorecardDetailResult,
  SkillSynthesisApplyProposalResult,
  SkillSynthesisGetCloneResult,
  SkillSynthesisGetHistoryBodyResult,
  SkillSynthesisPreviewEnhancementResult,
  SkillSynthesisKeepCloneResult,
  SkillSynthesisRebaseCloneResult,
  SkillSynthesisRevertEnhancementResult,
  SkillSynthesisSaveCloneBodyResult,
  SkillSynthesisSpecSummary,
  SkillSynthesisHarvestSpecsResult,
  SkillSynthesisClearStaleSpecsResult,
  SkillSynthesisListQuarantinedAgentsResult,
  SkillSynthesisRestoreQuarantinedAgentResult,
  AgentOutcomeSignalsResult,
  AgentListCliModelsResult,
  AgentOrchestrationConfig,
  RpcUserErrorCode,
  SkillSynthesisGetAgentModelsResult,
  SkillSynthesisSetAgentModelParams,
  SkillSynthesisSetAgentModelResult,
} from '@ptah-extension/shared';

/**
 * A `setAgentModel` answer. A refusal is data, not a throw, because the caller
 * acts on its code: `MODEL_NOT_AVAILABLE` asks for confirmation,
 * `UNAUTHORIZED_WORKSPACE` reloads the models, the rest show `message`.
 */
export type AgentModelSaveOutcome =
  | { readonly ok: true; readonly result: SkillSynthesisSetAgentModelResult }
  | {
      readonly ok: false;
      readonly code: RpcUserErrorCode | null;
      readonly message: string;
    };

/**
 * The host refused a manual run because the Skills switch is paused
 * (`RpcUserErrorCode` `'PAUSED'`). Thrown as its own type so callers can show a
 * paused notice instead of a failure.
 */
export class SkillsPausedError extends Error {
  public constructor(message = 'Skill synthesis is paused') {
    super(message);
    this.name = 'SkillsPausedError';
  }
}

/** Throw {@link SkillsPausedError} when a failed result is a `PAUSED` refusal. */
export function throwIfSkillsPaused(result: {
  readonly errorCode?: RpcUserErrorCode;
  readonly error?: string;
}): void {
  if (result.errorCode === 'PAUSED') {
    throw new SkillsPausedError(result.error || undefined);
  }
}

/**
 * Per-method RPC timeout budget for the skill-synthesis surface.
 *
 * - LIST_MS: Library list/get reads.
 * - SHORT_MS: short Library writes.
 * - PROMOTE_MS: Library writes that can touch disk.
 * - SETTINGS_MS: agent lane config read.
 * - CURATOR_MS: spec harvest reconciliation.
 * - ENHANCE_MS: manual enhancement preview.
 */
const SKILL_RPC_TIMEOUTS = {
  LIST_MS: 10_000,
  SHORT_MS: 8_000,
  PROMOTE_MS: 20_000,
  SETTINGS_MS: 8_000,
  // getAgentModels/setAgentModel may await the server's 15 s model-list budget
  // (skills-synthesis-rpc.handlers.ts); leave 5 s for transport and saving.
  AGENT_MODELS_MS: 20_000,
  CURATOR_MS: 90_000,
  ENHANCE_MS: 90_000,
} as const;

/**
 * SkillSynthesisRpcService
 *
 * Thin facade over the retained Library, model, and scorecard RPC methods.
 * Delegates to {@link ClaudeRpcService} for the
 * underlying message-bus call and normalises the result shape (throws on error,
 * returns typed result on success). Pattern matches `WizardRpcService`. Each
 * public method maps 1:1 to one RPC method.
 */
@Injectable({
  providedIn: 'root',
})
export class SkillSynthesisRpcService {
  private readonly rpcService = inject(ClaudeRpcService);

  /**
   * Model catalogue for one provider, or for the host's active provider when
   * `providerId` is omitted.
   *
   * This is the `ProviderModelsLoader` port `ProviderModelPickerComponent`
   * injects — the Skills tab's own transport for the shared picker, which is
   * why it lives on this service rather than being reached across a lib
   * boundary. `provider:listModels` is deliberately generic: no provider id is
   * ever hardcoded here, and an absent id means "whatever the host settled on".
   */
  public async listModels(
    providerId?: string,
  ): Promise<ProviderListModelsResult> {
    const result = await this.rpcService.call(
      'provider:listModels',
      {
        toolUseOnly: false,
        ...(providerId ? { providerId } : {}),
      },
      { timeout: SKILL_RPC_TIMEOUTS.LIST_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'provider:listModels failed');
  }

  /** Run the Curator pass and return the report. */
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
  /**
   * Dry-run an enhancement: generate + judge a candidate rewrite WITHOUT
   * writing it. The returned `proposalId` is the handle
   * {@link applyProposal} commits, so Apply never re-runs the model and never
   * writes a body the user did not see in the diff.
   */
  public async previewEnhancement(
    kind: SkillCloneKind,
    slug: string,
  ): Promise<SkillSynthesisPreviewEnhancementResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:previewEnhancement',
      { kind, slug },
      { timeout: SKILL_RPC_TIMEOUTS.ENHANCE_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throwIfSkillsPaused(result);
    throw new Error(result.error || 'Failed to preview enhancement');
  }

  /** Commit a previewed proposal to disk. */
  public async applyProposal(
    kind: SkillCloneKind,
    slug: string,
    proposalId: string,
  ): Promise<SkillSynthesisApplyProposalResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:applyProposal',
      { kind, slug, proposalId },
      { timeout: SKILL_RPC_TIMEOUTS.PROMOTE_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to apply enhancement proposal');
  }

  /** Fetch one history snapshot's body so it can be diffed before reverting. */
  public async getHistoryBody(
    kind: SkillCloneKind,
    slug: string,
    ts: string,
  ): Promise<SkillSynthesisGetHistoryBodyResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:getHistoryBody',
      { kind, slug, ts },
      { timeout: SKILL_RPC_TIMEOUTS.LIST_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to load history snapshot');
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

  /**
   * Replace a clone's body with user-edited text.
   *
   * The backend snapshots the previous body to `.history/` before overwriting
   * and updates exactly one sidecar field, so a save never resolves a pending
   * divergence on the user's behalf. `PROMOTE_MS` matches the other write
   * wrappers: this hashes a file or a small tree on the far side.
   */
  public async saveCloneBody(
    kind: SkillCloneKind,
    slug: string,
    body: string,
    expectedSourceHash?: string,
    origin?: 'enhancement',
  ): Promise<SkillSynthesisSaveCloneBodyResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:saveCloneBody',
      {
        kind,
        slug,
        body,
        ...(expectedSourceHash ? { expectedSourceHash } : {}),
        ...(origin ? { origin } : {}),
      },
      { timeout: SKILL_RPC_TIMEOUTS.PROMOTE_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to save clone body');
  }

  /** Fetch per-kind telemetry counts and task grades. */
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
   * Batched outcome signals for the Agents tab (Req 9). One call for every
   * agent-kind slug. A slug absent from `signals` has no records in the
   * window — the UI treats that as "no data yet". `windowDays` is the
   * window the handler computed over; `persistent` is false while the
   * durable store behind the figures is not readable. A failure throws;
   * the state service then shows "no data yet" rather than a rate.
   */
  public async getAgentOutcomeSignals(
    slugs: string[],
  ): Promise<AgentOutcomeSignalsResult> {
    const result = await this.rpcService.call(
      'agent:outcomeSignals',
      { slugs },
      { timeout: SKILL_RPC_TIMEOUTS.LIST_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to load outcome signals');
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

  /**
   * Agents the seed quarantine moved out of this workspace, plus the kept
   * clones Ptah does not own.
   *
   * `workspaceRoot: null` is the backend's "no folder open" answer and is
   * returned as-is: it is NOT the same as an empty quarantine, and the caller
   * must tell the two apart. Handler failures (e.g. `PERSISTENCE_UNAVAILABLE`)
   * throw; they never come back as an empty listing.
   */
  public async listQuarantinedAgents(): Promise<SkillSynthesisListQuarantinedAgentsResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:listQuarantinedAgents',
      {},
      { timeout: SKILL_RPC_TIMEOUTS.LIST_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to list quarantined agents');
  }

  /**
   * Copy a quarantined agent's snapshot back to `.claude/agents/<slug>.md`.
   *
   * Every outcome the handler returns (`restored`, `conflict`, `copy-failed`,
   * …) is data for the caller to present. An RPC error (`INVALID_PARAMS` for a
   * bad slug or no open folder, `PERSISTENCE_UNAVAILABLE`) throws, so a refused
   * restore is never mistaken for one that ran. The handler never turns agent
   * sync on; `agentSync` only reports it.
   */
  public async restoreQuarantinedAgent(
    slug: string,
  ): Promise<SkillSynthesisRestoreQuarantinedAgentResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:restoreQuarantinedAgent',
      { slug },
      { timeout: SKILL_RPC_TIMEOUTS.PROMOTE_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to restore quarantined agent');
  }

  /**
   * Both per-agent model layers, the server's classification of every stored
   * value, its classification lists and the providers that cannot carry a
   * model. `workspaceRoot` is what {@link setAgentModel} must send back.
   */
  public async getAgentModels(): Promise<SkillSynthesisGetAgentModelsResult> {
    const result = await this.rpcService.call(
      'skillSynthesis:getAgentModels',
      {},
      { timeout: SKILL_RPC_TIMEOUTS.AGENT_MODELS_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to read agent models');
  }

  /** Save or clear one agent's model for one provider in one scope. */
  public async setAgentModel(
    params: SkillSynthesisSetAgentModelParams,
  ): Promise<AgentModelSaveOutcome> {
    const result = await this.rpcService.call(
      'skillSynthesis:setAgentModel',
      params,
      { timeout: SKILL_RPC_TIMEOUTS.AGENT_MODELS_MS },
    );
    if (result.isSuccess() && result.data) {
      return { ok: true, result: result.data };
    }
    return {
      ok: false,
      code: result.errorCode ?? null,
      message: result.error || 'Failed to save the agent model',
    };
  }

  /**
   * The CLI model lists (`agent:listCliModels`). Suggestions for the model
   * input only: classification comes from {@link getAgentModels}.
   */
  public async listCliModels(): Promise<AgentListCliModelsResult> {
    const result = await this.rpcService.call(
      'agent:listCliModels',
      undefined,
      {
        timeout: SKILL_RPC_TIMEOUTS.LIST_MS,
      },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to list CLI models');
  }

  /** Agent lane settings (`agent:getConfig`), for each lane's default model. */
  public async getAgentLaneConfig(): Promise<AgentOrchestrationConfig> {
    const result = await this.rpcService.call('agent:getConfig', undefined, {
      timeout: SKILL_RPC_TIMEOUTS.SETTINGS_MS,
    });
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to read agent lane settings');
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
