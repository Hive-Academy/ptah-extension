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
  SkillSynthesisInvocationEntry,
  SkillSynthesisInvocationsParams,
  SkillSynthesisInvocationsResult,
  SkillSynthesisListCandidatesParams,
  SkillSynthesisListCandidatesResult,
  SkillSynthesisPromoteParams,
  SkillSynthesisPromoteResult,
  SkillSynthesisRejectParams,
  SkillSynthesisRejectResult,
  SkillSynthesisStatsParams,
  SkillSynthesisStatsResult,
} from '@ptah-extension/shared';

@injectable()
export class SkillsSynthesisRpcHandlers {
  static readonly METHODS = [
    'skillSynthesis:listCandidates',
    'skillSynthesis:getCandidate',
    'skillSynthesis:promote',
    'skillSynthesis:reject',
    'skillSynthesis:invocations',
    'skillSynthesis:stats',
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
  ) {}

  register(): void {
    this.registerListCandidates();
    this.registerGetCandidate();
    this.registerPromote();
    this.registerReject();
    this.registerInvocations();
    this.registerStats();

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
        const decision = this.synthesis.promote(id);
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
