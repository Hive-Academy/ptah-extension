/**
 * Skill Synthesis RPC Handlers.
 *
 * Bridges the frontend Skill Synthesis UI to the backend SkillCandidateStore +
 * SkillSynthesisService. Six methods:
 *   - skillSynthesis:listCandidates  → list candidates filtered by status
 *   - skillSynthesis:getCandidate    → fetch one candidate (incl. body text)
 *   - skillSynthesis:promote         → manual promotion (runs full eval)
 *   - skillSynthesis:reject          → manual reject with reason
 *   - skillSynthesis:invocations     → list invocations for a candidate
 *   - skillSynthesis:stats           → aggregate counts for dashboard
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
  flattenSkillTriggers,
  readSkillTriggers,
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
} from '@ptah-extension/skill-synthesis';
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
  SkillSynthesisCandidateDetail,
  SkillSynthesisCandidateSummary,
  SkillSynthesisGetCandidateParams,
  SkillSynthesisGetCandidateResult,
  SkillSynthesisGetSettingsParams,
  SkillSynthesisGetSettingsResult,
  SkillSynthesisInvocationEntry,
  SkillSynthesisInvocationsParams,
  SkillSynthesisInvocationsResult,
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
  SkillSynthesisRevertEnhancementParams,
  SkillSynthesisRevertEnhancementResult,
  SkillSynthesisRebaseCloneParams,
  SkillSynthesisRebaseCloneResult,
  SkillSynthesisKeepCloneParams,
  SkillSynthesisKeepCloneResult,
  SkillSynthesisInvocationStatsParams,
  SkillSynthesisInvocationStatsResult,
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
  SkillSuggestionSummary,
  SkillSuggestionDetail,
  CloneSummary,
  SkillCloneKind,
} from '@ptah-extension/shared';
import { RpcUserError } from '@ptah-extension/vscode-core';
import { z } from 'zod';
import {
  PinSkillParamsSchema,
  RunCuratorParamsSchema,
  SkillAnalyzeNowParamsSchema,
  SkillDiagnosticsParamsSchema,
  SkillGetTriggersParamsSchema,
  SkillSetTriggersParamsSchema,
  SkillSynthesisSettingsSchema,
  UnpinSkillParamsSchema,
  UpdateSkillSynthesisSettingsParamsSchema,
  SkillGetCloneParamsSchema,
  SkillEnhanceNowParamsSchema,
  SkillRevertEnhancementParamsSchema,
  SkillRebaseCloneParamsSchema,
  SkillKeepCloneParamsSchema,
  SkillInvocationStatsParamsSchema,
  SkillListSuggestionsParamsSchema,
  SkillAcceptSuggestionParamsSchema,
  SkillDismissSuggestionParamsSchema,
  SkillGetSuggestionParamsSchema,
  SkillUpdateSuggestionParamsSchema,
} from './skills-synthesis-rpc.schema';

interface ICuratorService {
  runManual(): Promise<{
    reportPath: string;
    changesQueued: number;
    skippedPinned: number;
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
    'skillSynthesis:listClones',
    'skillSynthesis:getClone',
    'skillSynthesis:enhanceNow',
    'skillSynthesis:revertEnhancement',
    'skillSynthesis:rebaseClone',
    'skillSynthesis:keepClone',
    'skillSynthesis:invocationStats',
    'skillSynthesis:listSuggestions',
    'skillSynthesis:acceptSuggestion',
    'skillSynthesis:dismissSuggestion',
    'skillSynthesis:getSuggestion',
    'skillSynthesis:updateSuggestion',
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
    this.registerListClones();
    this.registerGetClone();
    this.registerEnhanceNow();
    this.registerRevertEnhancement();
    this.registerRebaseClone();
    this.registerKeepClone();
    this.registerInvocationStats();
    this.registerListSuggestions();
    this.registerAcceptSuggestion();
    this.registerDismissSuggestion();
    this.registerGetSuggestion();
    this.registerUpdateSuggestion();

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
        const rows = this.collectByStatus(filter);
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
          return { reportPath: '', changesQueued: 0, skippedPinned: 0 };
        }
        const result = await this.curator.runManual();
        return {
          reportPath: result.reportPath,
          changesQueued: result.changesQueued,
          skippedPinned: result.skippedPinned,
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

  private registerListClones(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisListClonesParams,
      SkillSynthesisListClonesResult
    >('skillSynthesis:listClones', async () => {
      try {
        const registry = this.requireDesktop(this.registry);
        const mirror = this.requireDesktop(this.mirror);
        const rows = registry.listAll();
        const clones = await Promise.all(
          rows.map((row) => this.toCloneSummary(row, mirror)),
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
        const clone = await this.toCloneSummary(row, mirror);
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
        'Skill clones are available on the desktop app only.',
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
    };
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

  private resolveUpstreamSourceDir(
    kind: SkillRegistryKind,
    slug: string,
    row: SkillRegistryRow,
  ): string | null {
    if (!this.contentDownload || !row.originPluginId) return null;
    if (
      row.originPluginId.includes('/') ||
      row.originPluginId.includes('\\') ||
      row.originPluginId.includes('..')
    ) {
      return null;
    }
    const pluginsPath = this.contentDownload.getPluginsPath();
    if (kind === 'skill') {
      return join(pluginsPath, row.originPluginId, 'skills', slug);
    }
    if (kind === 'command') {
      return join(pluginsPath, row.originPluginId, 'commands');
    }
    return join(pluginsPath, row.originPluginId, 'agents');
  }

  private collectByStatus(
    filter: 'candidate' | 'promoted' | 'rejected' | 'all',
  ): SkillCandidateRow[] {
    if (filter === 'all') {
      return [
        ...this.store.listByStatus('candidate'),
        ...this.store.listByStatus('promoted'),
        ...this.store.listByStatus('rejected'),
      ];
    }
    return this.store.listByStatus(filter as SkillStatus);
  }

  private report(error: unknown, errorSource: string): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error(`RPC ${errorSource} failed`, err);

    this.sentryService.captureException(err, { errorSource });
  }
}

function clampLimit(raw: number | undefined, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(raw), 1000);
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
