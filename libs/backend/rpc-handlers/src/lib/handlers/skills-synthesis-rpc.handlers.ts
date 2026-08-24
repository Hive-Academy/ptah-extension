/**
 * Skill Synthesis RPC Handlers.
 *
 * Bridges the frontend Skill Synthesis UI to the backend stores/services
 * (candidates, suggestions, clones/registry, diagnostics, settings). The full
 * method set is the `static METHODS` tuple below, compile-asserted to equal the
 * `skillSynthesis:*` slice of `RpcMethodName`.
 *
 * Class is named `SkillsSynthesisRpcHandlers` (plural) to avoid colliding
 * with the existing `SkillsShRpcHandlers` (shell skills).
 */
import * as fs from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  FILE_BASED_SETTINGS_DEFAULTS,
  type IWorkspaceProvider,
  type ContentDownloadService,
} from '@ptah-extension/platform-core';
import {
  SKILL_SYNTHESIS_TOKENS,
  USER_LAYER_MIRROR_SERVICE_TOKEN,
  MIN_INVOCATIONS_TO_ENHANCE,
  ENHANCE_COOLDOWN_MS,
  ProposalNotFoundError,
  flattenSkillTriggers,
  readSkillTriggers,
  flattenSkillLanes,
  readSkillLanes,
  resolveSkillsRoot,
  type JudgeCriterionScores,
  type SkillCandidateStore,
  type SkillSynthesisDiagnosticsService,
  type SkillSynthesisService,
  type SkillSynthesisSettings,
  type CandidateId,
  type SkillStatus,
  type SkillCandidateRow,
  type SkillInvocationRow,
  type SkillEnhancerService,
  type SkillRegistryStore,
  type SkillRegistryRow,
  type SkillRegistryKind,
  type SkillSuggestionStore,
  type SkillSuggestionRow,
  type SpecHarvesterService,
  type SkillScorecardService,
  type SkillQueueStore,
  type SkillQueueRow,
  type SkillBudgetStore,
  type SkillBudgetStageDay,
  type SkillGapCuratorService,
  type DigestItem,
} from '@ptah-extension/skill-synthesis';
import {
  CRON_TOKENS,
  type CronScheduler,
  type JobRun,
} from '@ptah-extension/cron-scheduler';
import type { UserLayerMirrorService } from '@ptah-extension/agent-generation';
import type {
  RpcMethodName,
  SkillAnalyzeNowParams,
  SkillAnalyzeNowResult,
  SkillDiagnosticsParams,
  SkillDiagnosticsResult,
  SkillGetTriggersParams,
  SkillGetTriggersResult,
  SkillSetTriggersParams,
  SkillSetTriggersResult,
  SkillGetLanesParams,
  SkillGetLanesResult,
  SkillSetLanesParams,
  SkillSetLanesResult,
  SkillJudgeCriteriaDto,
  SkillJudgePanelRationaleDto,
  SkillJudgePanelRoleDto,
  SkillJudgeStatusDto,
  SkillSynthesisCandidateDetail,
  SkillSynthesisCandidateSummary,
  SkillSynthesisGetCandidateParams,
  SkillSynthesisGetCandidateResult,
  SkillSynthesisGetSettingsParams,
  SkillSynthesisGetSettingsResult,
  SkillSynthesisInvocationEntry,
  SkillSynthesisInvocationsParams,
  SkillSynthesisInvocationsResult,
  SkillSynthesisCandidateScope,
  SkillSynthesisListCandidatesParams,
  SkillSynthesisListCandidatesResult,
  SkillSynthesisPinParams,
  SkillSynthesisPinResult,
  SkillSynthesisPromoteParams,
  SkillSynthesisPromoteResult,
  SkillSynthesisRejectParams,
  SkillSynthesisRejectResult,
  SkillSynthesisRunCuratorParams,
  SkillSynthesisRunCuratorResult,
  SkillSynthesisSettingsDto,
  SkillSynthesisStatsParams,
  SkillSynthesisStatsResult,
  SkillSynthesisUnpinParams,
  SkillSynthesisUnpinResult,
  SkillSynthesisUpdateSettingsParams,
  SkillSynthesisUpdateSettingsResult,
  SkillSynthesisListClonesParams,
  SkillSynthesisListClonesResult,
  SkillSynthesisGetCloneParams,
  SkillSynthesisGetCloneResult,
  SkillSynthesisEnhanceNowParams,
  SkillSynthesisEnhanceNowResult,
  SkillSynthesisPreviewEnhancementParams,
  SkillSynthesisPreviewEnhancementResult,
  SkillSynthesisApplyProposalParams,
  SkillSynthesisApplyProposalResult,
  SkillSynthesisGetHistoryBodyParams,
  SkillSynthesisGetHistoryBodyResult,
  SkillSynthesisRevertEnhancementParams,
  SkillSynthesisRevertEnhancementResult,
  SkillSynthesisRebaseCloneParams,
  SkillSynthesisRebaseCloneResult,
  SkillSynthesisKeepCloneParams,
  SkillSynthesisKeepCloneResult,
  SkillSynthesisInvocationStatsParams,
  SkillSynthesisInvocationStatsResult,
  SkillSynthesisGetScorecardsParams,
  SkillSynthesisGetScorecardsResult,
  SkillSynthesisGetScorecardDetailParams,
  SkillSynthesisGetScorecardDetailResult,
  SkillSynthesisListSuggestionsParams,
  SkillSynthesisListSuggestionsResult,
  SkillSynthesisAcceptSuggestionParams,
  SkillSynthesisAcceptSuggestionResult,
  SkillSynthesisDismissSuggestionParams,
  SkillSynthesisDismissSuggestionResult,
  SkillSynthesisGetSuggestionParams,
  SkillSynthesisGetSuggestionResult,
  SkillSynthesisUpdateSuggestionParams,
  SkillSynthesisUpdateSuggestionResult,
  SkillSynthesisRejectBulkParams,
  SkillSynthesisRejectBulkResult,
  SkillSynthesisPromoteBulkParams,
  SkillSynthesisPromoteBulkResult,
  SkillSynthesisRejectByPatternParams,
  SkillSynthesisRejectByPatternResult,
  SkillSynthesisListSpecsParams,
  SkillSynthesisListSpecsResult,
  SkillSynthesisHarvestSpecsParams,
  SkillSynthesisHarvestSpecsResult,
  SkillSynthesisClearStaleSpecsParams,
  SkillSynthesisClearStaleSpecsResult,
  SkillSynthesisQueueParams,
  SkillSynthesisQueueResult,
  SkillSynthesisQueueItem,
  SkillSynthesisDigestParams,
  SkillSynthesisDigestResult,
  SkillDigestItem,
  SkillSynthesisStageSpend,
  SkillSynthesisDrainRun,
  SkillDrainTier,
  JobId,
  SkillSuggestionSummary,
  SkillSuggestionDetail,
  CloneSummary,
  SkillCloneKind,
  AgentScorecard,
} from '@ptah-extension/shared';
import { SKILL_DRAIN_JOB_IDS, SKILL_DRAIN_TIERS } from '@ptah-extension/shared';
import { RpcUserError } from '@ptah-extension/vscode-core';
import { z } from 'zod';
import {
  PinSkillParamsSchema,
  RunCuratorParamsSchema,
  SkillAnalyzeNowParamsSchema,
  SkillDiagnosticsParamsSchema,
  SkillGetTriggersParamsSchema,
  SkillSetTriggersParamsSchema,
  SkillGetLanesParamsSchema,
  SkillSetLanesParamsSchema,
  SkillSynthesisSettingsSchema,
  UnpinSkillParamsSchema,
  UpdateSkillSynthesisSettingsParamsSchema,
  SkillGetCloneParamsSchema,
  SkillEnhanceNowParamsSchema,
  SkillPreviewEnhancementParamsSchema,
  SkillApplyProposalParamsSchema,
  SkillGetHistoryBodyParamsSchema,
  SkillRevertEnhancementParamsSchema,
  SkillRebaseCloneParamsSchema,
  SkillKeepCloneParamsSchema,
  SkillInvocationStatsParamsSchema,
  SkillListSuggestionsParamsSchema,
  SkillAcceptSuggestionParamsSchema,
  SkillDismissSuggestionParamsSchema,
  SkillGetSuggestionParamsSchema,
  SkillUpdateSuggestionParamsSchema,
  RejectBulkParamsSchema,
  PromoteBulkParamsSchema,
  RejectByPatternParamsSchema,
  ClearStaleSpecsParamsSchema,
  SkillQueueParamsSchema,
  SkillDigestParamsSchema,
  SkillDigestItemsSchema,
  getScorecardsParamsSchema,
  getScorecardDetailParamsSchema,
} from './skills-synthesis-rpc.schema';

/** Queue rows returned when the caller does not ask for a specific count. */
const DEFAULT_QUEUE_ITEM_LIMIT = 50;

/** Drain runs returned per tier, and after merging, when unspecified. */
const DEFAULT_DRAIN_RUN_LIMIT = 20;

interface ICuratorService {
  runManual(): Promise<{
    reportPath: string;
    changesQueued: number;
    skippedPinned: number;
    suggestionsCreated: number;
  }>;
  start(settings: SkillSynthesisSettings): void;
  stop(): void;
  acceptSuggestion(
    id: string,
    settings: SkillSynthesisSettings,
  ): { accepted: boolean; filePath: string };
  dismissSuggestion(id: string): { dismissed: boolean };
}

@injectable()
export class SkillsSynthesisRpcHandlers {
  static readonly METHODS = [
    'skillSynthesis:listCandidates',
    'skillSynthesis:getCandidate',
    'skillSynthesis:promote',
    'skillSynthesis:reject',
    'skillSynthesis:invocations',
    'skillSynthesis:stats',
    'skillSynthesis:getSettings',
    'skillSynthesis:updateSettings',
    'skillSynthesis:pin',
    'skillSynthesis:unpin',
    'skillSynthesis:runCurator',
    'skillSynthesis:diagnostics',
    'skillSynthesis:analyzeNow',
    'skillSynthesis:setTriggers',
    'skillSynthesis:getTriggers',
    'skillSynthesis:setLanes',
    'skillSynthesis:getLanes',
    'skillSynthesis:listClones',
    'skillSynthesis:getClone',
    'skillSynthesis:enhanceNow',
    'skillSynthesis:previewEnhancement',
    'skillSynthesis:applyProposal',
    'skillSynthesis:getHistoryBody',
    'skillSynthesis:revertEnhancement',
    'skillSynthesis:rebaseClone',
    'skillSynthesis:keepClone',
    'skillSynthesis:invocationStats',
    'skillSynthesis:getScorecards',
    'skillSynthesis:getScorecardDetail',
    'skillSynthesis:listSuggestions',
    'skillSynthesis:acceptSuggestion',
    'skillSynthesis:dismissSuggestion',
    'skillSynthesis:getSuggestion',
    'skillSynthesis:updateSuggestion',
    'skillSynthesis:rejectBulk',
    'skillSynthesis:promoteBulk',
    'skillSynthesis:rejectByPattern',
    'skillSynthesis:listSpecs',
    'skillSynthesis:harvestSpecs',
    'skillSynthesis:clearStaleSpecs',
    'skillSynthesis:queue',
    'skillSynthesis:digest',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE)
    private readonly synthesis: SkillSynthesisService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE)
    private readonly store: SkillCandidateStore,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_DIAGNOSTICS_SERVICE)
    private readonly diagnostics: SkillSynthesisDiagnosticsService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CURATOR_SERVICE, { isOptional: true })
    private readonly curator: ICuratorService | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_ENHANCER_SERVICE, { isOptional: true })
    private readonly enhancer: SkillEnhancerService | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE, { isOptional: true })
    private readonly registry: SkillRegistryStore | null,
    @inject(USER_LAYER_MIRROR_SERVICE_TOKEN, { isOptional: true })
    private readonly mirror: UserLayerMirrorService | null,
    @inject(PLATFORM_TOKENS.CONTENT_DOWNLOAD, { isOptional: true })
    private readonly contentDownload: ContentDownloadService | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_SUGGESTION_STORE, { isOptional: true })
    private readonly suggestionStore: SkillSuggestionStore | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SPEC_HARVESTER_SERVICE, { isOptional: true })
    private readonly specHarvester: SpecHarvesterService | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_SCORECARD_SERVICE, {
      isOptional: true,
    })
    private readonly scorecard: SkillScorecardService | null,
    // Not optional: the queue store is registered by the same
    // `registerSkillSynthesisServices` call that registers the candidate store
    // above, so a host that can serve this class can always serve the queue.
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_QUEUE_STORE)
    private readonly queue: SkillQueueStore,
    // Not optional for the same reason as the queue store above: both are
    // registered by the one `registerSkillSynthesisServices` call. The ledger
    // is the ONLY place tokens are recorded, so an optional binding here would
    // silently degrade the Activity cost strip back to a dispatch counter in
    // whichever host forgot it.
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_BUDGET_STORE)
    private readonly budget: SkillBudgetStore,
    // Optional: `startThothCron` catches its own failures and leaves the
    // scheduler unregistered, and the CLI tier may run without cron at all.
    // No scheduler simply means no run history to show — not an error.
    @inject(CRON_TOKENS.CRON_SCHEDULER, { isOptional: true })
    private readonly cron: CronScheduler | null,
    // Optional on purpose, and the reason is not symmetry with the scorecard
    // above. The gap curator reads three stores (candidates, verdicts,
    // suggestions) plus an optional memory reader, so a host that registered
    // only part of the skill-synthesis surface can resolve this class without
    // it — and an optional binding is also what keeps the FIVE existing
    // container-construction sites across `skills-synthesis-rpc.handlers.spec`
    // and `.queue.spec` compiling untouched: tsyringe returns `undefined` for
    // an unregistered symbol token under `isOptional`, where a required
    // injection would throw in every one of them.
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_GAP_CURATOR_SERVICE, {
      isOptional: true,
    })
    private readonly gapCurator: SkillGapCuratorService | null,
  ) {}

  register(): void {
    this.registerListCandidates();
    this.registerGetCandidate();
    this.registerPromote();
    this.registerReject();
    this.registerInvocations();
    this.registerStats();
    this.registerGetSettings();
    this.registerUpdateSettings();
    this.registerPin();
    this.registerUnpin();
    this.registerRunCurator();
    this.registerDiagnostics();
    this.registerAnalyzeNow();
    this.registerSetTriggers();
    this.registerGetTriggers();
    this.registerSetLanes();
    this.registerGetLanes();
    this.registerListClones();
    this.registerGetClone();
    this.registerEnhanceNow();
    this.registerPreviewEnhancement();
    this.registerApplyProposal();
    this.registerGetHistoryBody();
    this.registerRevertEnhancement();
    this.registerRebaseClone();
    this.registerKeepClone();
    this.registerInvocationStats();
    this.registerGetScorecards();
    this.registerGetScorecardDetail();
    this.registerListSuggestions();
    this.registerAcceptSuggestion();
    this.registerDismissSuggestion();
    this.registerGetSuggestion();
    this.registerUpdateSuggestion();
    this.registerRejectBulk();
    this.registerPromoteBulk();
    this.registerRejectByPattern();
    this.registerListSpecs();
    this.registerHarvestSpecs();
    this.registerClearStaleSpecs();
    this.registerQueue();
    this.registerDigest();

    this.logger.debug('Skill Synthesis RPC handlers registered', {
      methods: SkillsSynthesisRpcHandlers.METHODS as unknown as string[],
    });
  }

  private registerListCandidates(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisListCandidatesParams,
      SkillSynthesisListCandidatesResult
    >('skillSynthesis:listCandidates', async (params) => {
      try {
        const filter = params?.status ?? 'candidate';
        const limit = clampLimit(params?.limit, 100);
        const rows = this.collectByStatus(
          filter,
          this.listScope(params?.scope),
        );
        const candidates = rows.slice(0, limit).map((r) => toSummary(r));
        return { candidates };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerListCandidates');
        throw error;
      }
    });
  }

  private registerGetCandidate(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisGetCandidateParams,
      SkillSynthesisGetCandidateResult
    >('skillSynthesis:getCandidate', async (params) => {
      try {
        const id = (params?.id ?? '') as CandidateId;
        if (!id) return { candidate: null };
        const row = this.store.findById(id);
        if (!row) return { candidate: null };
        return { candidate: toDetail(row) };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerGetCandidate');
        throw error;
      }
    });
  }

  private registerPromote(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisPromoteParams,
      SkillSynthesisPromoteResult
    >('skillSynthesis:promote', async (params) => {
      try {
        const id = (params?.id ?? '') as CandidateId;
        if (!id) {
          return { promoted: false, reason: 'missing-id', filePath: null };
        }
        const decision = await this.synthesis.promote(id);
        return {
          promoted: decision.promoted,
          reason: decision.reason ?? null,
          filePath: decision.filePath ?? null,
        };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerPromote');
        throw error;
      }
    });
  }

  private registerReject(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisRejectParams,
      SkillSynthesisRejectResult
    >('skillSynthesis:reject', async (params) => {
      try {
        const id = (params?.id ?? '') as CandidateId;
        if (!id) return { rejected: false };
        this.synthesis.reject(id, params?.reason);
        return { rejected: true };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerReject');
        throw error;
      }
    });
  }

  private registerInvocations(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisInvocationsParams,
      SkillSynthesisInvocationsResult
    >('skillSynthesis:invocations', async (params) => {
      try {
        const skillId = (params?.skillId ?? '') as CandidateId;
        if (!skillId) return { invocations: [] };
        const limit = clampLimit(params?.limit, 200);
        const rows = this.store.listInvocations(skillId, limit);
        return { invocations: rows.map(toInvocation) };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerInvocations');
        throw error;
      }
    });
  }

  private registerStats(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisStatsParams,
      SkillSynthesisStatsResult
    >('skillSynthesis:stats', async () => {
      try {
        const s = this.store.getStats();
        return {
          totalCandidates: s.candidates,
          totalPromoted: s.promoted,
          totalRejected: s.rejected,
          totalInvocations: s.invocations,
          activeSkills: s.promoted,
        };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerStats');
        throw error;
      }
    });
  }

  private registerGetSettings(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisGetSettingsParams,
      SkillSynthesisGetSettingsResult
    >('skillSynthesis:getSettings', async () => {
      try {
        const raw: Record<string, unknown> = {};
        for (const key of Object.keys(SkillSynthesisSettingsSchema.shape)) {
          const configKey = `skillSynthesis.${key}`;
          const defaultValue = FILE_BASED_SETTINGS_DEFAULTS[configKey];
          try {
            const value = this.workspaceProvider.getConfiguration<unknown>(
              'ptah',
              configKey,
              defaultValue,
            );
            raw[key] =
              value === undefined || value === null ? defaultValue : value;
          } catch {
            raw[key] = defaultValue;
          }
        }
        const settings = SkillSynthesisSettingsSchema.parse(
          raw,
        ) as SkillSynthesisSettingsDto;
        return { settings };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerGetSettings');
        throw error;
      }
    });
  }

  private registerUpdateSettings(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisUpdateSettingsParams,
      SkillSynthesisUpdateSettingsResult
    >('skillSynthesis:updateSettings', async (params) => {
      try {
        const parsed = UpdateSkillSynthesisSettingsParamsSchema.parse(params);
        const entries = Object.entries(parsed.settings) as Array<
          [keyof SkillSynthesisSettingsDto, unknown]
        >;
        const curatorAffected =
          'curatorEnabled' in parsed.settings ||
          'curatorIntervalHours' in parsed.settings;

        for (const [key, value] of entries) {
          await this.workspaceProvider.setConfiguration(
            'ptah',
            `skillSynthesis.${key}`,
            value,
          );
        }
        if (curatorAffected && this.curator) {
          const newSettings = this.synthesis.readSettings();
          this.curator.stop();
          this.curator.start(newSettings);
          this.logger.debug(
            '[skill-synthesis] curator restarted after settings update',
            {
              curatorEnabled: newSettings.curatorEnabled,
              curatorIntervalHours: newSettings.curatorIntervalHours,
            },
          );
        }

        return { updated: true };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerUpdateSettings');
        throw error;
      }
    });
  }

  private registerPin(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisPinParams,
      SkillSynthesisPinResult
    >('skillSynthesis:pin', async (params) => {
      try {
        const parsed = PinSkillParamsSchema.parse(params);
        const maxPinnedSkills = this.workspaceProvider.getConfiguration<number>(
          'ptah',
          'skillSynthesis.maxPinnedSkills',
          FILE_BASED_SETTINGS_DEFAULTS[
            'skillSynthesis.maxPinnedSkills'
          ] as number,
        );
        this.store.setPin(
          parsed.id as CandidateId,
          true,
          maxPinnedSkills ??
            (FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.maxPinnedSkills'
            ] as number),
        );
        return { pinned: true };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerPin');
        throw error;
      }
    });
  }

  private registerUnpin(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisUnpinParams,
      SkillSynthesisUnpinResult
    >('skillSynthesis:unpin', async (params) => {
      try {
        const parsed = UnpinSkillParamsSchema.parse(params);
        this.store.setPin(parsed.id as CandidateId, false, 0);
        return { pinned: false };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerUnpin');
        throw error;
      }
    });
  }

  private registerRunCurator(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisRunCuratorParams,
      SkillSynthesisRunCuratorResult
    >('skillSynthesis:runCurator', async () => {
      try {
        RunCuratorParamsSchema.parse({});
        if (!this.curator) {
          return {
            reportPath: '',
            changesQueued: 0,
            skippedPinned: 0,
            suggestionsCreated: 0,
          };
        }
        const result = await this.curator.runManual();
        return {
          reportPath: result.reportPath,
          changesQueued: result.changesQueued,
          skippedPinned: result.skippedPinned,
          suggestionsCreated: result.suggestionsCreated,
        };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerRunCurator');
        throw error;
      }
    });
  }

  private registerDiagnostics(): void {
    this.rpcHandler.registerMethod<
      SkillDiagnosticsParams,
      SkillDiagnosticsResult
    >('skillSynthesis:diagnostics', async (params) => {
      let validated: z.infer<typeof SkillDiagnosticsParamsSchema>;
      try {
        validated = SkillDiagnosticsParamsSchema.parse(params ?? {});
      } catch (err: unknown) {
        this.logger.warn('[skill-synthesis] diagnostics — invalid params', {
          err: String(err),
        });
        throw new RpcUserError(
          'Invalid parameters for skillSynthesis:diagnostics',
          'INVALID_PARAMS',
        );
      }
      try {
        const snapshot = await this.diagnostics.getSnapshot(
          validated.workspaceRoot ?? undefined,
          validated.eventLimit,
        );
        const stats = this.store.getStats();
        return {
          lastAnalyzeRunAt: snapshot.lastAnalyzeRunAt,
          lastCuratorPassAt: snapshot.lastCuratorPassAt,
          totalCandidates: stats.candidates,
          totalPromoted: stats.promoted,
          totalRejected: stats.rejected,
          totalInvocations: stats.invocations,
          activeSkills: stats.promoted,
          eligibilityHistogram: {
            prefilterTooThin: snapshot.eligibilityHistogram.prefilterTooThin,
            prefilterRejected: snapshot.eligibilityHistogram.prefilterRejected,
            accepted: snapshot.eligibilityHistogram.accepted,
          },
          recentEvents: snapshot.recentEvents.map((e) => ({
            kind: e.kind,
            timestamp: e.timestamp,
            sessionId: e.sessionId,
            stats: e.stats,
            error: e.error,
          })),
          triggers: {
            sessionEnd: snapshot.triggers.sessionEnd,
            idleMs: snapshot.triggers.idleMs,
            bootScan: snapshot.triggers.bootScan,
            subagentStop: { enabled: snapshot.triggers.subagentStop.enabled },
            postToolUse: {
              enabled: snapshot.triggers.postToolUse.enabled,
              minEditCount: snapshot.triggers.postToolUse.minEditCount,
            },
            turnComplete: { enabled: snapshot.triggers.turnComplete.enabled },
            maxAnalyzesPerHour: snapshot.triggers.maxAnalyzesPerHour,
          },
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerDiagnostics');
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error('[skill-synthesis] diagnostics failed', {
          error: message,
        });
        throw new RpcUserError(
          'skillSynthesis:diagnostics failed; please try again.',
          'PERSISTENCE_UNAVAILABLE',
        );
      }
    });
  }

  private registerAnalyzeNow(): void {
    this.rpcHandler.registerMethod<
      SkillAnalyzeNowParams,
      SkillAnalyzeNowResult
    >('skillSynthesis:analyzeNow', async (params) => {
      let validated: z.infer<typeof SkillAnalyzeNowParamsSchema>;
      try {
        validated = SkillAnalyzeNowParamsSchema.parse(params);
      } catch (err: unknown) {
        this.logger.warn('[skill-synthesis] analyzeNow — invalid params', {
          err: String(err),
        });
        throw new RpcUserError(
          'Invalid parameters for skillSynthesis:analyzeNow',
          'INVALID_PARAMS',
        );
      }
      const startedAt = Date.now();
      try {
        const result = await this.synthesis.analyzeSession(
          validated.sessionId,
          validated.workspaceRoot,
          { force: validated.force === true },
        );
        const completedAt = Date.now();
        if (!result) {
          return {
            success: false,
            startedAt,
            completedAt,
            candidateId: null,
            reason: 'ineligible',
          };
        }
        return {
          success: true,
          startedAt,
          completedAt,
          candidateId: result.candidate.id as unknown as string,
          reason: result.reused ? 'reused' : null,
        };
      } catch (error: unknown) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerAnalyzeNow');
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          startedAt,
          completedAt: Date.now(),
          candidateId: null,
          reason: null,
          error: message,
        };
      }
    });
  }

  private registerSetTriggers(): void {
    this.rpcHandler.registerMethod<
      SkillSetTriggersParams,
      SkillSetTriggersResult
    >('skillSynthesis:setTriggers', async (params) => {
      let validated: z.infer<typeof SkillSetTriggersParamsSchema>;
      try {
        validated = SkillSetTriggersParamsSchema.parse(params);
      } catch (err: unknown) {
        this.logger.warn('[skill-synthesis] setTriggers — invalid params', {
          err: String(err),
        });
        throw new RpcUserError(
          'Invalid parameters for skillSynthesis:setTriggers',
          'INVALID_PARAMS',
        );
      }
      try {
        for (const [flatKey, flatValue] of flattenSkillTriggers(
          validated.triggers,
        )) {
          await this.workspaceProvider.setConfiguration(
            'ptah',
            flatKey,
            flatValue,
          );
        }
        return { triggers: readSkillTriggers(this.workspaceProvider) };
      } catch (error: unknown) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerSetTriggers');
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error('[skill-synthesis] setTriggers failed', {
          error: message,
        });
        throw new RpcUserError(
          'skillSynthesis:setTriggers failed; please try again.',
          'PERSISTENCE_UNAVAILABLE',
        );
      }
    });
  }

  private registerGetTriggers(): void {
    this.rpcHandler.registerMethod<
      SkillGetTriggersParams,
      SkillGetTriggersResult
    >('skillSynthesis:getTriggers', async (params) => {
      try {
        SkillGetTriggersParamsSchema.parse(params);
      } catch (err: unknown) {
        this.logger.warn('[skill-synthesis] getTriggers — invalid params', {
          err: String(err),
        });
        throw new RpcUserError(
          'Invalid parameters for skillSynthesis:getTriggers',
          'INVALID_PARAMS',
        );
      }
      return { triggers: readSkillTriggers(this.workspaceProvider) };
    });
  }

  /**
   * `skillSynthesis:setLanes` — persist a sparse lane patch.
   *
   * Structurally identical to `setTriggers`: validate, flatten to dotted keys,
   * write each one through `IWorkspaceProvider.setConfiguration`, then return
   * the READ-BACK state rather than echoing the patch. The read-back matters —
   * `readSkillLane` rejects a value it considers unusable and serves the
   * default instead, so echoing the request would tell the UI a write landed
   * that did not.
   *
   * Each key is written individually on purpose. `getConfiguration` /
   * `setConfiguration` route per dotted key (file-based vs. VS Code settings),
   * so a whole-object write would bypass that routing entirely.
   */
  private registerSetLanes(): void {
    this.rpcHandler.registerMethod<SkillSetLanesParams, SkillSetLanesResult>(
      'skillSynthesis:setLanes',
      async (params) => {
        let validated: z.infer<typeof SkillSetLanesParamsSchema>;
        try {
          validated = SkillSetLanesParamsSchema.parse(params);
        } catch (err: unknown) {
          this.logger.warn('[skill-synthesis] setLanes — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for skillSynthesis:setLanes',
            'INVALID_PARAMS',
          );
        }
        try {
          for (const [flatKey, flatValue] of flattenSkillLanes(
            validated.lanes,
          )) {
            await this.workspaceProvider.setConfiguration(
              'ptah',
              flatKey,
              flatValue,
            );
          }
          return { lanes: readSkillLanes(this.workspaceProvider) };
        } catch (error: unknown) {
          this.report(error, 'SkillsSynthesisRpcHandlers.registerSetLanes');
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error('[skill-synthesis] setLanes failed', {
            error: message,
          });
          throw new RpcUserError(
            'skillSynthesis:setLanes failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );
  }

  /** `skillSynthesis:getLanes` — all four lanes, resolved field by field. */
  private registerGetLanes(): void {
    this.rpcHandler.registerMethod<SkillGetLanesParams, SkillGetLanesResult>(
      'skillSynthesis:getLanes',
      async (params) => {
        try {
          SkillGetLanesParamsSchema.parse(params);
        } catch (err: unknown) {
          this.logger.warn('[skill-synthesis] getLanes — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for skillSynthesis:getLanes',
            'INVALID_PARAMS',
          );
        }
        return { lanes: readSkillLanes(this.workspaceProvider) };
      },
    );
  }

  private registerListClones(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisListClonesParams,
      SkillSynthesisListClonesResult
    >('skillSynthesis:listClones', async () => {
      try {
        const registry = this.requireDesktop(this.registry);
        const mirror = this.requireDesktop(this.mirror);
        const rows = registry.listAll();
        const orphanFlags = await this.readOrphanFlags(mirror);
        const clones = await Promise.all(
          rows.map((row) =>
            this.toCloneSummary(
              row,
              mirror,
              orphanFlags.get(`${row.kind}/${row.slug}`) === true,
            ),
          ),
        );
        return { clones };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerListClones');
        throw this.toUserError('skillSynthesis:listClones');
      }
    });
  }

  private registerGetClone(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisGetCloneParams,
      SkillSynthesisGetCloneResult
    >('skillSynthesis:getClone', async (params) => {
      const parsed = this.parseParams(
        SkillGetCloneParamsSchema,
        params,
        'skillSynthesis:getClone',
      );
      try {
        const registry = this.requireDesktop(this.registry);
        const mirror = this.requireDesktop(this.mirror);
        const kind = parsed.kind as SkillRegistryKind;
        const row = registry.getBySlug(kind, parsed.slug);
        if (!row) {
          return { clone: null, body: null, history: [] };
        }
        const body = this.readCloneBody(mirror, kind, parsed.slug);
        const historyEntries = await mirror.listHistory(kind, parsed.slug);
        const history = historyEntries.map((h) => ({
          ts: h.ts,
          hasBody: h.hasSkillMd,
        }));
        const clone = await this.toCloneSummary(
          row,
          mirror,
          await this.readOrphanFlag(mirror, kind, parsed.slug),
        );
        return { clone, body, history };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerGetClone');
        throw this.toUserError('skillSynthesis:getClone');
      }
    });
  }

  private registerEnhanceNow(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisEnhanceNowParams,
      SkillSynthesisEnhanceNowResult
    >('skillSynthesis:enhanceNow', async (params) => {
      const parsed = this.parseParams(
        SkillEnhanceNowParamsSchema,
        params,
        'skillSynthesis:enhanceNow',
      );
      try {
        const enhancer = this.requireDesktop(this.enhancer);
        const registry = this.requireDesktop(this.registry);
        const kind = parsed.kind as SkillRegistryKind;
        const row = registry.getBySlug(kind, parsed.slug);
        if (!row) {
          throw new RpcUserError(
            `No cloned ${parsed.kind} found for slug "${parsed.slug}".`,
            'INVALID_PARAMS',
          );
        }
        const settings = this.synthesis.readSettings();
        const result = await enhancer.enhance(parsed.slug, settings, {
          manual: true,
          kind,
        });
        return {
          changed: result.changed,
          slug: result.slug,
          kind: result.kind as SkillCloneKind,
          judgeScore: result.judgeScore,
          judgeReason: result.judgeReason,
          historyTs: result.historyTs,
          skipReason: result.skipReason ?? null,
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerEnhanceNow');
        throw this.toUserError('skillSynthesis:enhanceNow');
      }
    });
  }

  /**
   * Read-only half of enhancement: generate + judge a candidate and return it
   * for review. Writes nothing. The returned `proposalId` is redeemed by
   * `skillSynthesis:applyProposal`.
   */
  private registerPreviewEnhancement(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisPreviewEnhancementParams,
      SkillSynthesisPreviewEnhancementResult
    >('skillSynthesis:previewEnhancement', async (params) => {
      const parsed = this.parseParams(
        SkillPreviewEnhancementParamsSchema,
        params,
        'skillSynthesis:previewEnhancement',
      );
      try {
        const enhancer = this.requireDesktop(this.enhancer);
        const registry = this.requireDesktop(this.registry);
        const kind = parsed.kind as SkillRegistryKind;
        const row = registry.getBySlug(kind, parsed.slug);
        if (!row) {
          throw new RpcUserError(
            `No cloned ${parsed.kind} found for slug "${parsed.slug}".`,
            'INVALID_PARAMS',
          );
        }
        const settings = this.synthesis.readSettings();
        // manual: a user-initiated preview bypasses the auto-enhance cooldown
        // and invocation floor, matching `enhanceNow`.
        const result = await enhancer.generateProposal(parsed.slug, settings, {
          manual: true,
          kind,
        });
        return {
          proposed: result.proposed,
          skipReason: result.skipReason ?? null,
          currentBody: result.currentBody,
          proposedBody: result.proposedBody,
          judgeScore: result.judgeScore,
          judgeReason: result.judgeReason,
          proposalId: result.proposalId,
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerPreviewEnhancement',
        );
        throw this.toUserError('skillSynthesis:previewEnhancement');
      }
    });
  }

  /**
   * Write half of enhancement: commit the exact body previously returned by
   * `skillSynthesis:previewEnhancement`. An unknown or expired `proposalId`
   * is a clean INVALID_PARAMS — never a silent regeneration.
   */
  private registerApplyProposal(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisApplyProposalParams,
      SkillSynthesisApplyProposalResult
    >('skillSynthesis:applyProposal', async (params) => {
      const parsed = this.parseParams(
        SkillApplyProposalParamsSchema,
        params,
        'skillSynthesis:applyProposal',
      );
      try {
        const enhancer = this.requireDesktop(this.enhancer);
        const kind = parsed.kind as SkillRegistryKind;
        const result = await enhancer.applyProposal(
          kind,
          parsed.slug,
          parsed.proposalId,
        );
        return { applied: result.applied, historyTs: result.historyTs };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        if (error instanceof ProposalNotFoundError) {
          this.logger.warn(
            '[skill-synthesis] applyProposal — proposal unavailable',
            { kind: parsed.kind, slug: parsed.slug, code: error.code },
          );
          throw new RpcUserError(
            'This enhancement preview is no longer available. Preview again, then apply.',
            'INVALID_PARAMS',
          );
        }
        this.report(error, 'SkillsSynthesisRpcHandlers.registerApplyProposal');
        throw this.toUserError('skillSynthesis:applyProposal');
      }
    });
  }

  /**
   * Body of one `.history/<ts>/` snapshot, so a past enhancement can be
   * diffed before reverting.
   *
   * `ts` is never interpolated into a path directly: it must match an entry
   * actually enumerated by `mirror.listHistory`, and the resolved file is
   * re-checked to live under the clone's user-layer root.
   */
  private registerGetHistoryBody(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisGetHistoryBodyParams,
      SkillSynthesisGetHistoryBodyResult
    >('skillSynthesis:getHistoryBody', async (params) => {
      const parsed = this.parseParams(
        SkillGetHistoryBodyParamsSchema,
        params,
        'skillSynthesis:getHistoryBody',
      );
      try {
        const mirror = this.requireDesktop(this.mirror);
        const kind = parsed.kind as SkillRegistryKind;
        const entries = await mirror.listHistory(kind, parsed.slug);
        const entry = entries.find((e) => e.ts === parsed.ts);
        if (!entry || !entry.hasSkillMd) {
          return { body: null, ts: parsed.ts };
        }
        const fileName = kind === 'skill' ? 'SKILL.md' : `${parsed.slug}.md`;
        const filePath = join(entry.path, fileName);
        const roots = mirror.getUserLayerRoots();
        const root =
          kind === 'skill'
            ? roots.skills
            : kind === 'agent'
              ? roots.agents
              : roots.commands;
        if (!this.isUnder(root, filePath)) {
          return { body: null, ts: parsed.ts };
        }
        if (!fs.existsSync(filePath)) {
          return { body: null, ts: parsed.ts };
        }
        return { body: fs.readFileSync(filePath, 'utf8'), ts: parsed.ts };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerGetHistoryBody');
        throw this.toUserError('skillSynthesis:getHistoryBody');
      }
    });
  }

  private registerRevertEnhancement(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisRevertEnhancementParams,
      SkillSynthesisRevertEnhancementResult
    >('skillSynthesis:revertEnhancement', async (params) => {
      const parsed = this.parseParams(
        SkillRevertEnhancementParamsSchema,
        params,
        'skillSynthesis:revertEnhancement',
      );
      try {
        const enhancer = this.requireDesktop(this.enhancer);
        const result = await enhancer.revert(
          parsed.slug,
          parsed.historyTs,
          parsed.kind as SkillRegistryKind,
        );
        return {
          reverted: result.reverted,
          slug: result.slug,
          revertedFrom: result.revertedFrom,
          newHistoryTs: result.newHistoryTs,
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerRevertEnhancement',
        );
        throw this.toUserError('skillSynthesis:revertEnhancement');
      }
    });
  }

  private registerRebaseClone(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisRebaseCloneParams,
      SkillSynthesisRebaseCloneResult
    >('skillSynthesis:rebaseClone', async (params) => {
      const parsed = this.parseParams(
        SkillRebaseCloneParamsSchema,
        params,
        'skillSynthesis:rebaseClone',
      );
      try {
        const registry = this.requireDesktop(this.registry);
        const mirror = this.requireDesktop(this.mirror);
        const kind = parsed.kind as SkillRegistryKind;
        const row = registry.getBySlug(kind, parsed.slug);
        if (!row) {
          throw new RpcUserError(
            `No cloned ${parsed.kind} found for slug "${parsed.slug}".`,
            'INVALID_PARAMS',
          );
        }
        const sourceDir = this.resolveUpstreamSourceDir(kind, parsed.slug, row);
        if (!sourceDir) {
          throw new RpcUserError(
            `Cannot resolve upstream source for "${parsed.slug}"; rebase unavailable.`,
            'PERSISTENCE_UNAVAILABLE',
          );
        }
        const result = await mirror.rebaseClone({
          kind,
          slug: parsed.slug,
          sourceDir,
        });
        if (!result.failed) {
          registry.setDiverged(kind, parsed.slug, false);
          registry.setPending(kind, parsed.slug, null);
        }
        return {
          kind: result.kind as SkillCloneKind,
          slug: result.slug,
          sourceHash: result.sourceHash,
          snapshotPath: result.snapshotPath,
          failed: result.failed ?? false,
          reason: result.reason ?? null,
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerRebaseClone');
        throw this.toUserError('skillSynthesis:rebaseClone');
      }
    });
  }

  private registerKeepClone(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisKeepCloneParams,
      SkillSynthesisKeepCloneResult
    >('skillSynthesis:keepClone', async (params) => {
      const parsed = this.parseParams(
        SkillKeepCloneParamsSchema,
        params,
        'skillSynthesis:keepClone',
      );
      try {
        const registry = this.requireDesktop(this.registry);
        const mirror = this.requireDesktop(this.mirror);
        const kind = parsed.kind as SkillRegistryKind;
        const result = await mirror.keepClone({ kind, slug: parsed.slug });
        registry.setDiverged(kind, parsed.slug, false);
        registry.setPending(kind, parsed.slug, null);
        return {
          kind: result.kind as SkillCloneKind,
          slug: result.slug,
          sourceHash: result.sourceHash,
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerKeepClone');
        throw this.toUserError('skillSynthesis:keepClone');
      }
    });
  }

  private registerInvocationStats(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisInvocationStatsParams,
      SkillSynthesisInvocationStatsResult
    >('skillSynthesis:invocationStats', async (params) => {
      const parsed = this.parseParams(
        SkillInvocationStatsParamsSchema,
        params,
        'skillSynthesis:invocationStats',
      );
      try {
        const stats = this.store.getInvocationStats(parsed.slug);
        return { slug: parsed.slug, stats };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerInvocationStats',
        );
        throw this.toUserError('skillSynthesis:invocationStats');
      }
    });
  }

  private registerGetScorecards(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisGetScorecardsParams,
      SkillSynthesisGetScorecardsResult
    >('skillSynthesis:getScorecards', async (params) => {
      const parsed = this.parseParams(
        getScorecardsParamsSchema,
        params,
        'skillSynthesis:getScorecards',
      );
      try {
        if (!this.scorecard) {
          // Scorecard service unavailable (non-skill-synthesis runtime): return
          // a typed empty map rather than throwing.
          return { scorecards: {} };
        }
        // Two passes on purpose: the aggregate and the win rate answer
        // different questions from different joins, and `getWinRates`' `null`
        // is a value the aggregate query has no room for (B4.3's own header).
        // Merging them here is what makes the number reachable by a UI at all
        // — B4.3 left it as a backend-only signal.
        const scorecards = this.scorecard.getScorecards(parsed.slugs);
        const winRates = this.scorecard.getWinRates(parsed.slugs);
        const merged: Record<string, AgentScorecard> = {};
        for (const [slug, card] of Object.entries(scorecards)) {
          const measured = winRates[slug];
          // Explicit `=== undefined`, not `?.winRate ?? null` and never `||`:
          // an absent ROW ("this slug has no invocation events") and a present
          // row carrying `null` ("invoked, nothing settled") are both
          // unmeasured, but a present row carrying `0` is a measured LOSS and
          // must survive as `0`.
          merged[slug] = {
            ...card,
            winRate: measured === undefined ? null : measured.winRate,
          };
        }
        return { scorecards: merged };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerGetScorecards');
        throw this.toUserError('skillSynthesis:getScorecards');
      }
    });
  }

  private registerGetScorecardDetail(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisGetScorecardDetailParams,
      SkillSynthesisGetScorecardDetailResult
    >('skillSynthesis:getScorecardDetail', async (params) => {
      const parsed = this.parseParams(
        getScorecardDetailParamsSchema,
        params,
        'skillSynthesis:getScorecardDetail',
      );
      try {
        if (!this.scorecard) {
          return { slug: parsed.slug, rows: [], findingsExcerpt: null };
        }
        return await this.scorecard.getScorecardDetail(
          parsed.slug,
          parsed.limit,
        );
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerGetScorecardDetail',
        );
        throw this.toUserError('skillSynthesis:getScorecardDetail');
      }
    });
  }

  private registerListSuggestions(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisListSuggestionsParams,
      SkillSynthesisListSuggestionsResult
    >('skillSynthesis:listSuggestions', async (params) => {
      const parsed = this.parseParams(
        SkillListSuggestionsParamsSchema,
        params,
        'skillSynthesis:listSuggestions',
      );
      try {
        const store = this.requireDesktop(this.suggestionStore);
        const rows = store.listByStatus(parsed?.status ?? 'pending');
        return { suggestions: rows.map(toSuggestionSummary) };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerListSuggestions',
        );
        throw this.toUserError('skillSynthesis:listSuggestions');
      }
    });
  }

  private registerAcceptSuggestion(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisAcceptSuggestionParams,
      SkillSynthesisAcceptSuggestionResult
    >('skillSynthesis:acceptSuggestion', async (params) => {
      const parsed = this.parseParams(
        SkillAcceptSuggestionParamsSchema,
        params,
        'skillSynthesis:acceptSuggestion',
      );
      try {
        this.requireDesktop(this.suggestionStore);
        const curator = this.requireDesktop(this.curator);
        const settings = this.synthesis.readSettings();
        const result = curator.acceptSuggestion(parsed.id, settings);
        return { accepted: result.accepted, filePath: result.filePath };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerAcceptSuggestion',
        );
        throw this.toUserError('skillSynthesis:acceptSuggestion');
      }
    });
  }

  private registerDismissSuggestion(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisDismissSuggestionParams,
      SkillSynthesisDismissSuggestionResult
    >('skillSynthesis:dismissSuggestion', async (params) => {
      const parsed = this.parseParams(
        SkillDismissSuggestionParamsSchema,
        params,
        'skillSynthesis:dismissSuggestion',
      );
      try {
        this.requireDesktop(this.suggestionStore);
        const curator = this.requireDesktop(this.curator);
        const result = curator.dismissSuggestion(parsed.id);
        return { dismissed: result.dismissed };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerDismissSuggestion',
        );
        throw this.toUserError('skillSynthesis:dismissSuggestion');
      }
    });
  }

  private registerGetSuggestion(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisGetSuggestionParams,
      SkillSynthesisGetSuggestionResult
    >('skillSynthesis:getSuggestion', async (params) => {
      const parsed = this.parseParams(
        SkillGetSuggestionParamsSchema,
        params,
        'skillSynthesis:getSuggestion',
      );
      try {
        const store = this.requireDesktop(this.suggestionStore);
        const row = store.findById(parsed.id);
        return { suggestion: row ? toSuggestionDetail(row) : null };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerGetSuggestion');
        throw this.toUserError('skillSynthesis:getSuggestion');
      }
    });
  }

  private registerUpdateSuggestion(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisUpdateSuggestionParams,
      SkillSynthesisUpdateSuggestionResult
    >('skillSynthesis:updateSuggestion', async (params) => {
      const parsed = this.parseParams(
        SkillUpdateSuggestionParamsSchema,
        params,
        'skillSynthesis:updateSuggestion',
      );
      try {
        const store = this.requireDesktop(this.suggestionStore);
        const row = store.updatePending(parsed.id, {
          name: parsed.name,
          description: parsed.description,
          body: parsed.body,
        });
        const updated = row !== null && row.status === 'pending';
        return {
          updated,
          suggestion: row ? toSuggestionDetail(row) : null,
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerUpdateSuggestion',
        );
        throw this.toUserError('skillSynthesis:updateSuggestion');
      }
    });
  }

  private registerRejectBulk(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisRejectBulkParams,
      SkillSynthesisRejectBulkResult
    >('skillSynthesis:rejectBulk', async (params) => {
      const parsed = this.parseParams(
        RejectBulkParamsSchema,
        params,
        'skillSynthesis:rejectBulk',
      );
      try {
        const ids = parsed.ids.map((id) => id as CandidateId);
        const rejected = this.synthesis.rejectBulk(ids, parsed.reason);
        return { rejected };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerRejectBulk');
        throw error;
      }
    });
  }

  private registerPromoteBulk(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisPromoteBulkParams,
      SkillSynthesisPromoteBulkResult
    >('skillSynthesis:promoteBulk', async (params) => {
      const parsed = this.parseParams(
        PromoteBulkParamsSchema,
        params,
        'skillSynthesis:promoteBulk',
      );
      try {
        const ids = parsed.ids.map((id) => id as CandidateId);
        const decisions = await this.synthesis.promoteBulk(ids);
        const promoted = decisions.filter((d) => d.promoted).length;
        return { decisions, promoted };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerPromoteBulk');
        throw error;
      }
    });
  }

  private registerRejectByPattern(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisRejectByPatternParams,
      SkillSynthesisRejectByPatternResult
    >('skillSynthesis:rejectByPattern', async (params) => {
      const parsed = this.parseParams(
        RejectByPatternParamsSchema,
        params,
        'skillSynthesis:rejectByPattern',
      );
      try {
        const result = this.synthesis.rejectByPattern(
          parsed.pattern,
          parsed.reason,
        );
        return { rejected: result.rejected, matched: result.matched };
      } catch (error) {
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerRejectByPattern',
        );
        throw error;
      }
    });
  }

  private registerListSpecs(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisListSpecsParams,
      SkillSynthesisListSpecsResult
    >('skillSynthesis:listSpecs', async () => {
      try {
        const harvester = this.requireDesktop(this.specHarvester);
        const specs = await harvester.listSpecs();
        return { specs };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerListSpecs');
        throw error;
      }
    });
  }

  private registerHarvestSpecs(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisHarvestSpecsParams,
      SkillSynthesisHarvestSpecsResult
    >('skillSynthesis:harvestSpecs', async () => {
      try {
        const harvester = this.requireDesktop(this.specHarvester);
        return await harvester.harvest();
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerHarvestSpecs');
        throw error;
      }
    });
  }

  private registerClearStaleSpecs(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisClearStaleSpecsParams,
      SkillSynthesisClearStaleSpecsResult
    >('skillSynthesis:clearStaleSpecs', async (params) => {
      const parsed = this.parseParams(
        ClearStaleSpecsParamsSchema,
        params,
        'skillSynthesis:clearStaleSpecs',
      );
      try {
        const harvester = this.requireDesktop(this.specHarvester);
        const result = await harvester.clearStaleSpecs(undefined, {
          retentionDays: parsed.retentionDays,
          mode: parsed.mode,
        });
        return {
          cleared: result.cleared,
          mode: result.mode,
          taskIds: [...result.taskIds],
        };
      } catch (error) {
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerClearStaleSpecs',
        );
        throw error;
      }
    });
  }

  /**
   * The Activity surface's read of the drain — criterion P0-7, backend half.
   *
   * Three independent feeds, because they answer different questions and none
   * can be derived from the others:
   *
   *  - `items` is WHAT is waiting, from `skill_synthesis_queue`: the stage, its
   *    status, how many attempts it has cost and the short reason the drain
   *    surfaced for a stall or a skip.
   *  - `recentRuns` is WHETHER THE DRAIN IS RUNNING AT ALL, from `job_runs`.
   *    Those rows already record status, timing and outcome for every cron
   *    slot, so they are read, not re-derived — a second bookkeeping table for
   *    drain history would be a parallel implementation of the cron scheduler's
   *    own.
   *  - `stageSpend` is WHAT IT COST, from `skill_synthesis_budget`. Queue rows
   *    carry dispatches, never tokens; the ledger is the only place a token is
   *    recorded and it is keyed `(UTC day, stage)`, not by row. So this is a
   *    sibling array rather than a field on `items`, and it can name a stage
   *    that has no rows left — a stage that spent, then finished.
   *
   * The pairing is what makes an empty queue legible: no items and no runs is a
   * drain that never fired, while no items and a healthy run feed is simply a
   * queue that is up to date. `stageSpend` is what makes an expensive one
   * legible before anyone tunes the tier cadence or the daily cap (R3).
   */
  private registerQueue(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisQueueParams,
      SkillSynthesisQueueResult
    >('skillSynthesis:queue', async (params) => {
      const parsed = this.parseParams(
        SkillQueueParamsSchema,
        params,
        'skillSynthesis:queue',
      );
      try {
        const items = this.queue
          .listRecent(parsed?.limit ?? DEFAULT_QUEUE_ITEM_LIMIT)
          .map(toQueueItem);
        return {
          items,
          recentRuns: this.readDrainRuns(
            parsed?.runLimit ?? DEFAULT_DRAIN_RUN_LIMIT,
          ),
          // Deliberately NOT limited by `limit`: `limit` bounds how many queue
          // rows cross the bridge, and clipping the ledger to match would make
          // the cost strip disagree with the daily cap the moment the queue
          // grew past one page. The ledger is at most twelve rows a day.
          stageSpend: this.budget.todayStageUsage().map(toStageSpend),
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerQueue');
        throw this.toUserError('skillSynthesis:queue');
      }
    });
  }

  /**
   * `skillSynthesis:digest` — the weekly gap digest, ranked and evidenced
   * (TASK_2026_180 Phase 4, task B4.4.2).
   *
   * A READ, and only a read. The curator promotes, rejects and deletes nothing;
   * this method hands its ranking to the UI so the user can act on it. The
   * items arrive already sorted by `score` DESCENDING and this method NEVER
   * re-sorts them — the tie-break the curator applies (kind order, then title)
   * is what makes two identical runs produce identical digests, and a second
   * sort here would drop that and make the panel untestable.
   *
   * A host without the curator registered gets an empty digest rather than an
   * error: the gap digest is a nudge surface, and "nothing to show" is a true
   * statement on a host that never swept.
   *
   * ### `allowRewrite` is FORWARDED, never defaulted here
   *
   * The sweep's one LLM call runs on the `synthesis` lane with no budget gate
   * underneath it — the `digest` queue stage has no handler and no producer, so
   * this method is the only way `runDigest` is ever reached and the drain's
   * per-item token gate never sees a digest item. The digest is also refreshed
   * automatically by the panel, so "omitted spends nothing" has to hold.
   *
   * It holds because `runDigest` itself treats anything other than an explicit
   * `true` as `false`. This method passes `parsed?.allowRewrite` straight
   * through — including `undefined` — rather than coalescing it, so there is
   * exactly ONE place in the system that decides what an omitted flag means. A
   * `?? false` here would look like belt-and-braces and would actually be a
   * second, competing default that a future non-RPC caller would not inherit.
   */
  private registerDigest(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisDigestParams,
      SkillSynthesisDigestResult
    >('skillSynthesis:digest', async (params) => {
      const parsed = this.parseParams(
        SkillDigestParamsSchema,
        params,
        'skillSynthesis:digest',
      );
      try {
        if (!this.gapCurator) return { items: [] };
        // `??`, never `||`: an explicit `''` is the cross-project feed and is a
        // different request from omitting the field, which asks for this host's
        // workspace. `||` would silently promote the first to the second.
        const workspaceRoot =
          parsed?.workspaceRoot ??
          this.workspaceProvider.getWorkspaceRoot() ??
          '';
        const items = await this.gapCurator.runDigest({
          workspaceRoot,
          limit: parsed?.limit,
          allowRewrite: parsed?.allowRewrite,
        });
        return { items: SkillDigestItemsSchema.parse(items.map(toDigestItem)) };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerDigest');
        throw this.toUserError('skillSynthesis:digest');
      }
    });
  }

  /**
   * Merge the three tiers' run histories into one newest-first feed.
   *
   * Each tier is a separate `scheduled_jobs` row, so there is no single query
   * that spans them; `limit` is applied per tier and again after the merge, so
   * a busy frequent tier cannot crowd the nightly and weekly runs out of the
   * window the user is looking at.
   */
  private readDrainRuns(limit: number): SkillSynthesisDrainRun[] {
    if (!this.cron) return [];
    const runs: SkillSynthesisDrainRun[] = [];
    for (const tier of SKILL_DRAIN_TIERS) {
      // A drain job id is a stable handle, not a ULID, so `JobId.from` — which
      // validates ULID shape — would reject it. These ids are ours and fixed;
      // there is no untrusted input on this path.
      const jobId = SKILL_DRAIN_JOB_IDS[tier] as JobId;
      for (const run of this.cron.listRuns(jobId, { limit })) {
        runs.push(toDrainRun(run, tier));
      }
    }
    runs.sort((a, b) => b.scheduledFor - a.scheduledFor);
    return runs.slice(0, limit);
  }

  private parseParams<T>(
    schema: { parse: (input: unknown) => T },
    params: unknown,
    method: string,
  ): T {
    try {
      return schema.parse(params);
    } catch (err: unknown) {
      this.logger.warn(`[skill-synthesis] ${method} — invalid params`, {
        err: String(err),
      });
      throw new RpcUserError(
        `Invalid parameters for ${method}`,
        'INVALID_PARAMS',
      );
    }
  }

  private requireDesktop<T>(value: T | null): T {
    if (value === null || value === undefined) {
      throw new RpcUserError(
        'This feature is available in the Ptah desktop app only.',
        'PERSISTENCE_UNAVAILABLE',
      );
    }
    return value;
  }

  private toUserError(method: string): RpcUserError {
    return new RpcUserError(
      `${method} failed; please try again.`,
      'PERSISTENCE_UNAVAILABLE',
    );
  }

  private async toCloneSummary(
    row: SkillRegistryRow,
    mirror: UserLayerMirrorService,
    orphaned: boolean,
  ): Promise<CloneSummary> {
    const stats = this.store.getInvocationStats(row.slug);
    const successRate = stats.total > 0 ? stats.succeeded / stats.total : 0;
    let historyCount = 0;
    try {
      const history = await mirror.listHistory(row.kind, row.slug);
      historyCount = history.length;
    } catch {
      historyCount = 0;
    }
    return {
      slug: row.slug,
      kind: row.kind as SkillCloneKind,
      cloneStatus: row.cloneStatus,
      diverged: row.diverged,
      invocationCount: stats.total,
      successRate,
      lastEnhancedAt: row.lastEnhancedAt,
      historyCount,
      pendingSourceHash: row.pendingSourceHash,
      enhanceMinInvocations: MIN_INVOCATIONS_TO_ENHANCE,
      enhanceCooldownUntil:
        row.lastEnhancedAt !== null
          ? row.lastEnhancedAt + ENHANCE_COOLDOWN_MS
          : null,
      orphaned,
    };
  }

  /**
   * `kind/slug` → orphaned, read once from the user-layer sidecars.
   *
   * The registry has no `orphaned` column (that would be a migration for a flag
   * the sidecar already owns), so the list path joins the two. A failure here
   * degrades to "nothing is orphaned" rather than failing the whole listing —
   * an un-flagged clone renders exactly as it did before this field existed.
   */
  private async readOrphanFlags(
    mirror: UserLayerMirrorService,
  ): Promise<ReadonlyMap<string, boolean>> {
    try {
      const entries = await mirror.listClones();
      return new Map(
        entries.map((entry) => [`${entry.kind}/${entry.slug}`, entry.orphaned]),
      );
    } catch (error: unknown) {
      this.logger.warn(
        '[skill-synthesis] could not read clone origin sidecars for orphan flags',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return new Map<string, boolean>();
    }
  }

  private async readOrphanFlag(
    mirror: UserLayerMirrorService,
    kind: SkillRegistryKind,
    slug: string,
  ): Promise<boolean> {
    try {
      const entry = await mirror.readCloneOrigin(kind, slug);
      return entry?.orphaned === true;
    } catch {
      return false;
    }
  }

  private readCloneBody(
    mirror: UserLayerMirrorService,
    kind: SkillRegistryKind,
    slug: string,
  ): string | null {
    try {
      const roots = mirror.getUserLayerRoots();
      const root =
        kind === 'skill'
          ? roots.skills
          : kind === 'agent'
            ? roots.agents
            : roots.commands;
      const filePath =
        kind === 'skill'
          ? join(root, slug, 'SKILL.md')
          : join(root, `${slug}.md`);
      if (!this.isUnder(root, filePath)) return null;
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  private isUnder(rootDir: string, targetPath: string): boolean {
    const root = resolve(rootDir);
    const resolved = resolve(targetPath);
    return resolved === root || resolved.startsWith(root + sep);
  }

  /**
   * Where `rebaseClone` should copy FROM, for every clone kind and both origins.
   *
   * Two things were wrong here before TASK_2026_278:
   *
   *  - A clone with no `originPluginId` returned `null`, so a SYNTH skill and a
   *    workspace-authored AGENT could be flagged diverged and then never
   *    rebased — the UI offered a button that always failed (defect 8). Their
   *    upstreams are `<skillsRoot>/<slug>/` and `{ws}/.claude/agents/<slug>.md`.
   *  - The plugin branch returned the commands/agents DIRECTORY, while
   *    `rebaseFileClone` probes it with `fileExists`. That is always false, so
   *    every plugin command/agent rebase answered `source-missing` regardless of
   *    what was on disk. Both now resolve to the `<slug>.md` FILE.
   *
   * A command with no plugin origin still returns `null`: nothing in the tree
   * writes a plugin-less command clone, so there is no upstream to name and
   * inventing one would rebase from a path that never existed.
   */
  private resolveUpstreamSourceDir(
    kind: SkillRegistryKind,
    slug: string,
    row: SkillRegistryRow,
  ): string | null {
    if (isUnsafePathSegment(slug)) return null;

    if (row.originPluginId) {
      if (!this.contentDownload) return null;
      if (isUnsafePathSegment(row.originPluginId)) return null;
      const pluginsPath = this.contentDownload.getPluginsPath();
      if (kind === 'skill') {
        return join(pluginsPath, row.originPluginId, 'skills', slug);
      }
      if (kind === 'command') {
        return join(pluginsPath, row.originPluginId, 'commands', `${slug}.md`);
      }
      return join(pluginsPath, row.originPluginId, 'agents', `${slug}.md`);
    }

    if (kind === 'skill') {
      return join(resolveSkillsRoot(this.workspaceProvider), slug);
    }
    if (kind === 'agent') {
      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      return workspaceRoot
        ? join(workspaceRoot, '.claude', 'agents', `${slug}.md`)
        : null;
    }
    return null;
  }

  /**
   * Resolve the wire `scope` into the argument `SkillCandidateStore` takes:
   * a workspace root to scope to, or `undefined` for every project.
   *
   * The default is `'workspace'` — the NARROW reading — because the list backs
   * a review queue and a candidate is unreviewed work from one project. It is
   * the only read in the subsystem that narrows; see `listByStatus`'s header
   * for why the other six must not.
   *
   * A host with NO workspace open (the CLI, an unfolded window) resolves to
   * `undefined` and sees everything. There is nothing to scope to there, and
   * scoping to `''` would match only rows explicitly marked cross-project —
   * which the candidate write path never produces — so the list would be
   * permanently empty.
   */
  private listScope(
    scope: SkillSynthesisCandidateScope | undefined,
  ): string | undefined {
    if (scope === 'all') return undefined;
    return this.workspaceProvider.getWorkspaceRoot() ?? undefined;
  }

  private collectByStatus(
    filter: 'candidate' | 'promoted' | 'rejected' | 'all',
    workspaceRoot?: string,
  ): SkillCandidateRow[] {
    if (filter === 'all') {
      return [
        ...this.store.listByStatus('candidate', workspaceRoot),
        ...this.store.listByStatus('promoted', workspaceRoot),
        ...this.store.listByStatus('rejected', workspaceRoot),
      ];
    }
    return this.store.listByStatus(filter as SkillStatus, workspaceRoot);
  }

  private report(error: unknown, errorSource: string): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error(`RPC ${errorSource} failed`, err);

    this.sentryService.captureException(err, { errorSource });
  }
}

/**
 * Reject anything that would let a stored id or slug escape the root it is
 * joined onto. Applied to BOTH halves of the join — the slug reaches here from
 * RPC params and the plugin id from a SQLite row, and either is enough.
 */
function isUnsafePathSegment(segment: string): boolean {
  return (
    segment.length === 0 ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.includes('..')
  );
}

function clampLimit(raw: number | undefined, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(raw), 1000);
}

/**
 * Project the row's five per-criterion scores onto the wire.
 *
 * `null` means "no per-criterion breakdown exists", which is exactly the state
 * `unjudgedVerdictFields()` produces — an object whose five members are all
 * `null`. Forwarding that object instead of `null` would render as a scorecard
 * of five blanks and read as "scored, badly" rather than "not scored".
 */
function toJudgeCriteria(
  criteria: JudgeCriterionScores | null | undefined,
): SkillJudgeCriteriaDto | null {
  if (!criteria) return null;
  const scored =
    criteria.novelty !== null ||
    criteria.actionability !== null ||
    criteria.scope !== null ||
    criteria.generalization !== null ||
    criteria.triggerClarity !== null;
  if (!scored) return null;
  return {
    novelty: criteria.novelty,
    actionability: criteria.actionability,
    scope: criteria.scope,
    generalization: criteria.generalization,
    triggerClarity: criteria.triggerClarity,
  };
}

/**
 * The wire restatement of the two panel vocabularies. `SkillCandidateStore`
 * remains the enforcing gate on the write edge; these arrays exist because the
 * READ edge parses a JSON blob and cannot import the backend constants without
 * dragging them across the projection boundary.
 */
const PANEL_ROLE_VALUES: readonly SkillJudgePanelRoleDto[] = [
  'panellist-a',
  'panellist-b',
  'escalation',
];
const PANEL_STATUS_VALUES: readonly SkillJudgeStatusDto[] = [
  'scored',
  'unscored',
  'disabled',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A panel entry's scorecard, read out of untyped JSON.
 *
 * Each criterion is taken only when it is a finite number; anything else reads
 * as "not scored" (`null`) rather than being coerced. An all-null card
 * collapses to `null` through {@link toJudgeCriteria}, so a panellist who
 * produced no breakdown renders as no scorecard instead of five blanks.
 */
function toPanelCriteria(value: unknown): SkillJudgeCriteriaDto | null {
  if (!isRecord(value)) return null;
  const read = (key: keyof JudgeCriterionScores): number | null => {
    const raw = value[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  };
  return toJudgeCriteria({
    novelty: read('novelty'),
    actionability: read('actionability'),
    scope: read('scope'),
    generalization: read('generalization'),
    triggerClarity: read('triggerClarity'),
  });
}

/**
 * One panel entry, validated against the SAME `status`/`score` contract
 * `SkillCandidateStore.recordJudgePanel` enforces on the way in.
 *
 * Re-checked here rather than trusted because the column is free JSON text: a
 * row written by an older build, hand-edited, or half-flushed can hold
 * `{status:'unscored', score:10}`, and forwarding that would put the exact
 * fabricated verdict Phase 1 removed back on the wire. `null` means "this
 * entry is not a verdict I can vouch for".
 */
function toPanelRationale(entry: unknown): SkillJudgePanelRationaleDto | null {
  if (!isRecord(entry)) return null;

  const role = entry['role'];
  const status = entry['status'];
  if (!PANEL_ROLE_VALUES.includes(role as SkillJudgePanelRoleDto)) return null;
  if (!PANEL_STATUS_VALUES.includes(status as SkillJudgeStatusDto)) return null;

  const rawScore = entry['score'];
  let score: number | null;
  if (status === 'scored') {
    if (typeof rawScore !== 'number' || !Number.isFinite(rawScore)) return null;
    score = rawScore;
  } else {
    // A non-`scored` entry carrying a number is precisely the fabricated score.
    // Drop the entry rather than silently blanking the number: a record that
    // contradicts itself is not one to repair.
    if (rawScore !== null && rawScore !== undefined) return null;
    score = null;
  }

  const reason = entry['reason'];
  const summary = entry['summary'];
  if (typeof reason !== 'string' || typeof summary !== 'string') return null;

  const criteria = entry['criteria'];
  return {
    role: role as SkillJudgePanelRoleDto,
    status: status as SkillJudgeStatusDto,
    score,
    criteria: toPanelCriteria(criteria),
    reason,
    summary,
  };
}

/**
 * Parse `judge_panel_rationales` (stored as JSON TEXT) into wire DTOs.
 *
 * Three things this deliberately does NOT do:
 *
 * 1. It never ships the raw JSON string. A string on the wire would make every
 *    consumer write its own parser, and the TUI's would differ from the
 *    webview's.
 * 2. It never yields `[]`. `recordJudgePanel` refuses to write a panel with no
 *    members ("a panel that produced nothing must write nothing"), so an empty
 *    list is not a state the column can honestly hold; an empty array read back
 *    is corruption, and corruption reads as `null`.
 * 3. It never returns a PARTIAL panel. One panel run is one deliberation — the
 *    store replaces the whole list precisely so entries from different runs
 *    cannot sit together. Dropping one unreadable entry and forwarding the rest
 *    would present a two-member panel where three deliberated, which reads as a
 *    panel that never disagreed. Any bad entry voids the whole record.
 *
 * The cost is that "unreadable" and "never convened" both arrive as `null`.
 * Separating them needs a fourth summary field this phase does not carry, and a
 * `[]`-as-unreadable convention would be read as "a panel with no members" by
 * the first consumer that checks `.length`. `null` is the honest collapse.
 */
function toPanelRationales(
  raw: string | null | undefined,
): SkillJudgePanelRationaleDto[] | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const out: SkillJudgePanelRationaleDto[] = [];
  for (const entry of parsed) {
    const rationale = toPanelRationale(entry);
    if (!rationale) return null;
    out.push(rationale);
  }
  return out;
}

function toSummary(row: SkillCandidateRow): SkillSynthesisCandidateSummary {
  return {
    id: row.id as string,
    name: row.name,
    description: row.description,
    status: row.status,
    successCount: row.successCount,
    failureCount: row.failureCount,
    createdAt: row.createdAt,
    promotedAt: row.promotedAt,
    rejectedAt: row.rejectedAt,
    rejectedReason: row.rejectedReason,
    pinned: row.pinned,
    // `?? null` and NOT `?? ''`. `null` is "we do not know which project this
    // came from"; `''` is the distinct claim "deliberately cross-project".
    workspaceRoot: row.workspaceRoot ?? null,
    displayName: row.displayName ?? null,
    // `?? null` and NOT `?? 0`. `judgeScore: null` IS the `unscored` verdict —
    // "we do not know" — and a zero here would be indistinguishable from a
    // judge that scored the candidate and found it worthless. That distinction
    // is the whole point of the phase.
    judgeScore: row.judgeScore ?? null,
    judgeStatus: row.judgeStatus ?? null,
    judgeReason: row.judgeReason ?? null,
    judgeCriteria: toJudgeCriteria(row.judgeCriteria),
    // `?? null` for the same reason as `judgeScore`, and NOT `?? 0`. These two
    // gates each measure something a skill can genuinely score zero on — a
    // replay that aligned with nothing, a description that retrieved nothing —
    // so a zero here is evidence, and `null` is the absence of evidence. A
    // candidate the gates never reached is still owed a retry; one they scored
    // zero is not. Collapsing them would make those two candidates identical.
    replayConfidence: row.replayConfidence ?? null,
    triggerScore: row.triggerScore ?? null,
    judgePanelRationales: toPanelRationales(row.judgePanelRationales),
  };
}

function toDetail(row: SkillCandidateRow): SkillSynthesisCandidateDetail {
  let body: string | null = null;
  try {
    if (row.bodyPath && fs.existsSync(row.bodyPath)) {
      body = fs.readFileSync(row.bodyPath, 'utf8');
    }
  } catch {
    body = null;
  }
  return {
    ...toSummary(row),
    bodyPath: row.bodyPath,
    body,
    trajectoryHash: row.trajectoryHash,
    sourceSessionIds: row.sourceSessionIds,
  };
}

function toSuggestionSummary(row: SkillSuggestionRow): SkillSuggestionSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    clusterSize: row.clusterSize,
    technologyFingerprint: row.technologyFingerprint,
    judgeScore: row.judgeScore,
    memberSessionIds: row.memberSessionIds,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function toSuggestionDetail(row: SkillSuggestionRow): SkillSuggestionDetail {
  return {
    ...toSuggestionSummary(row),
    body: row.body,
  };
}

/**
 * Queue row → wire item.
 *
 * `lastError` is dropped, not forgotten. It carries whatever a stage threw —
 * a provider payload, an SDK message, a SQLite driver string — and forwarding
 * that to a renderer is precisely the raw-error-message leak the house rule
 * forbids. `reason` is the short line the drain authored for display; the full
 * error is already in the log via `SkillDrainService`.
 *
 * `payload` is dropped for the same class of reason: it is stage scratch space
 * (prompts, truncation markers, verdict fragments), not a display surface.
 *
 * The two assignments below are a compile-time drift guard. `row.stage` and
 * `row.status` are the backend's unions; if migration `0032` gains a member
 * that `SkillSynthesisQueueStage`/`Status` in `libs/shared` does not have, this
 * function stops compiling instead of shipping a value the renderer cannot name.
 */
function toQueueItem(row: SkillQueueRow): SkillSynthesisQueueItem {
  return {
    id: row.id,
    sessionId: row.sessionId,
    workspaceRoot: row.workspaceRoot,
    stage: row.stage,
    status: row.status,
    attemptCount: row.attemptCount,
    enqueuedAt: row.enqueuedAt,
    notBefore: row.notBefore,
    finishedAt: row.finishedAt,
    lane: row.lane,
    reason: row.reason,
    candidateId: row.candidateId,
  };
}

/**
 * Ledger row → wire spend.
 *
 * `updatedAt` is dropped: the strip renders "what today cost", and a per-stage
 * timestamp invites a "last spent" label that would be wrong the moment two
 * stages share a tick. `costUsd` IS carried — it is the store's own figure, not
 * a renderer-side price calculation, and it is the only thing that stays
 * meaningful when two providers price tokens differently.
 *
 * The `stage` assignment is a compile-time drift guard of the same kind
 * {@link toQueueItem} keeps: `SkillBudgetStage` is the backend's union
 * (`SkillQueueStage | ''`) and this stops compiling if `libs/shared` and the
 * store ever disagree about what a stage key is.
 */
function toStageSpend(entry: SkillBudgetStageDay): SkillSynthesisStageSpend {
  return {
    stage: entry.stage,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    totalTokens: entry.totalTokens,
    costUsd: entry.costUsd,
  };
}

/**
 * `job_runs` row → wire run.
 *
 * `errorMessage` is NOT surfaced: it is the verbatim text of whatever the job
 * handler threw. `resultSummary` is the drain's own sentence and is safe.
 * `durationMs` is computed here rather than in the renderer so an in-flight run
 * reads as `null` instead of arithmetic on a missing `endedAt`.
 */
function toDrainRun(run: JobRun, tier: SkillDrainTier): SkillSynthesisDrainRun {
  return {
    id: run.id as string,
    jobId: run.jobId as string,
    tier,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    durationMs:
      run.startedAt !== null && run.endedAt !== null
        ? run.endedAt - run.startedAt
        : null,
    summary: run.resultSummary,
  };
}

/**
 * Curator item → wire item.
 *
 * `winRate` IS COPIED, NEVER COALESCED. `null` means nobody measured this
 * skill; `0` means it was measured and lost every measured session. `0` is
 * falsy, so a `??  0` or a `|| 0` on this one line would retitle every measured
 * failure in the digest as an absent measurement — and because the result would
 * still typecheck and still render, nothing downstream could tell. Pinned by
 * `skills-synthesis-rpc.digest.spec.ts`, which asserts `toBeNull()` rather than
 * `toBeFalsy()` for exactly this reason.
 *
 * The `readonly` arrays are copied into mutable ones because the wire type is
 * mutable and the curator hands the SAME `sessionIds` array to every consumer;
 * handing it straight through would let a renderer that sorted it in place
 * reorder another consumer's evidence.
 */
function toDigestItem(item: DigestItem): SkillDigestItem {
  return {
    kind: item.kind,
    title: item.title,
    rationale: item.rationale,
    score: item.score,
    evidence: {
      sessionIds: [...item.evidence.sessionIds],
      counts: { ...item.evidence.counts },
      winRate: item.evidence.winRate,
    },
  };
}

function toInvocation(row: SkillInvocationRow): SkillSynthesisInvocationEntry {
  return {
    id: row.id,
    skillId: row.skillId as string,
    sessionId: row.sessionId,
    succeeded: row.succeeded,
    invokedAt: row.invokedAt,
    notes: row.notes,
  };
}
