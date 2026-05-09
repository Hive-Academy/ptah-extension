/**
 * Skill Synthesis RPC Handlers (TASK_2026_HERMES Track 2).
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
import { inject, injectable } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  FILE_BASED_SETTINGS_DEFAULTS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  SKILL_SYNTHESIS_TOKENS,
  type SkillCandidateStore,
  type SkillSynthesisService,
  type CandidateId,
  type SkillStatus,
  type SkillCandidateRow,
  type SkillInvocationRow,
} from '@ptah-extension/skill-synthesis';
import type {
  RpcMethodName,
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
} from '@ptah-extension/shared';
import {
  PinSkillParamsSchema,
  RunCuratorParamsSchema,
  UnpinSkillParamsSchema,
  UpdateSkillSynthesisSettingsParamsSchema,
} from './skills-synthesis-rpc.schema';

/** Minimal interface for the extended store operations added in Batch 1. */
interface ExtendedSkillCandidateStore {
  setPin(id: string, pinned: boolean, maxPinnedCap: number): void;
}

/** Minimal interface for the Curator service (registered later in Batch 3). */
interface ICuratorService {
  runManual(): Promise<{
    reportPath: string;
    changesQueued: number;
    skippedPinned: number;
  }>;
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
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CURATOR_SERVICE, { isOptional: true })
    private readonly curator: ICuratorService | null,
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

    this.logger.debug('Skill Synthesis RPC handlers registered', {
      methods: SkillsSynthesisRpcHandlers.METHODS as unknown as string[],
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // listCandidates
  // ─────────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────
  // getCandidate
  // ─────────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────
  // promote
  // ─────────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────
  // reject
  // ─────────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────
  // invocations
  // ─────────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────
  // stats
  // ─────────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────
  // getSettings
  // ─────────────────────────────────────────────────────────────────────

  private registerGetSettings(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisGetSettingsParams,
      SkillSynthesisGetSettingsResult
    >('skillSynthesis:getSettings', async () => {
      try {
        const get = <T>(key: string, fallback: T): T => {
          try {
            const raw = this.workspaceProvider.getConfiguration<T>(
              'ptah',
              key,
              fallback,
            );
            return raw === undefined || raw === null ? fallback : raw;
          } catch {
            return fallback;
          }
        };
        const settings: SkillSynthesisSettingsDto = {
          enabled: get('skillSynthesis.enabled', true),
          successesToPromote: get(
            'skillSynthesis.successesToPromote',
            FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.successesToPromote'
            ] as number,
          ),
          dedupCosineThreshold: get(
            'skillSynthesis.dedupCosineThreshold',
            FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.dedupCosineThreshold'
            ] as number,
          ),
          maxActiveSkills: get(
            'skillSynthesis.maxActiveSkills',
            FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.maxActiveSkills'
            ] as number,
          ),
          candidatesDir: get(
            'skillSynthesis.candidatesDir',
            FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.candidatesDir'
            ] as string,
          ),
          eligibilityMinTurns: get(
            'skillSynthesis.eligibilityMinTurns',
            FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.eligibilityMinTurns'
            ] as number,
          ),
          evictionDecayRate: get(
            'skillSynthesis.evictionDecayRate',
            FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.evictionDecayRate'
            ] as number,
          ),
          generalizationContextThreshold: get(
            'skillSynthesis.generalizationContextThreshold',
            FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.generalizationContextThreshold'
            ] as number,
          ),
          minTrajectoryFidelityRatio: get(
            'skillSynthesis.minTrajectoryFidelityRatio',
            FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.minTrajectoryFidelityRatio'
            ] as number,
          ),
          dedupClusterThreshold: get(
            'skillSynthesis.dedupClusterThreshold',
            FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.dedupClusterThreshold'
            ] as number,
          ),
          minAbstractionEditDistance: get(
            'skillSynthesis.minAbstractionEditDistance',
            FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.minAbstractionEditDistance'
            ] as number,
          ),
          judgeEnabled: get(
            'skillSynthesis.judgeEnabled',
            FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.judgeEnabled'
            ] as boolean,
          ),
          minJudgeScore: get(
            'skillSynthesis.minJudgeScore',
            FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.minJudgeScore'
            ] as number,
          ),
          judgeModel: get(
            'skillSynthesis.judgeModel',
            FILE_BASED_SETTINGS_DEFAULTS['skillSynthesis.judgeModel'] as string,
          ),
          maxPinnedSkills: get(
            'skillSynthesis.maxPinnedSkills',
            FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.maxPinnedSkills'
            ] as number,
          ),
          curatorEnabled: get(
            'skillSynthesis.curatorEnabled',
            FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.curatorEnabled'
            ] as boolean,
          ),
          curatorIntervalHours: get(
            'skillSynthesis.curatorIntervalHours',
            FILE_BASED_SETTINGS_DEFAULTS[
              'skillSynthesis.curatorIntervalHours'
            ] as number,
          ),
        };
        return { settings };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerGetSettings');
        throw error;
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // updateSettings
  // ─────────────────────────────────────────────────────────────────────

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
        for (const [key, value] of entries) {
          await this.workspaceProvider.setConfiguration(
            'ptah',
            `skillSynthesis.${key}`,
            value,
          );
        }
        return { updated: true };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerUpdateSettings');
        throw error;
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // pin
  // ─────────────────────────────────────────────────────────────────────

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
        (this.store as unknown as ExtendedSkillCandidateStore).setPin(
          parsed.id,
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

  // ─────────────────────────────────────────────────────────────────────
  // unpin
  // ─────────────────────────────────────────────────────────────────────

  private registerUnpin(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisUnpinParams,
      SkillSynthesisUnpinResult
    >('skillSynthesis:unpin', async (params) => {
      try {
        const parsed = UnpinSkillParamsSchema.parse(params);
        (this.store as unknown as ExtendedSkillCandidateStore).setPin(
          parsed.id,
          false,
          0,
        );
        return { pinned: false };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerUnpin');
        throw error;
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // runCurator
  // ─────────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────

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
    try {
      this.sentryService.captureException(err, { errorSource });
    } catch {
      /* sentry must never throw */
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────

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
