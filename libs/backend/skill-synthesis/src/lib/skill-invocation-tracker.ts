/**
 * SkillInvocationTracker — records per-session skill invocations and drives
 * the 3-success promotion pipeline.
 *
 * Public API:
 *   - recordInvocation({ skillId, sessionId, succeeded, notes? }):
 *       persists the invocation row and increments success_count /
 *       failure_count atomically. When the candidate's success_count
 *       reaches the configured threshold, automatically delegates to
 *       SkillPromotionService.evaluate().
 *
 * The tracker does NOT decide what counts as "success" — the caller (the
 * RPC handler or the synthesis pipeline) is responsible for that judgment.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SkillCandidateStore } from './skill-candidate.store';
import {
  SkillPromotionService,
  type PromotionDecision,
} from './skill-promotion.service';
import type { CandidateId, SkillSynthesisSettings } from './types';

export interface RecordInvocationInput {
  skillId: CandidateId;
  sessionId: string;
  succeeded: boolean;
  notes?: string;
}

export interface RecordInvocationResult {
  successCount: number;
  failureCount: number;
  /** Populated when this invocation triggered promotion evaluation. */
  promotion: PromotionDecision | null;
}

@injectable()
export class SkillInvocationTracker {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SkillCandidateStore)
    private readonly store: SkillCandidateStore,
    @inject(SkillPromotionService)
    private readonly promotion: SkillPromotionService,
  ) {}

  async recordInvocation(
    input: RecordInvocationInput,
    settings: SkillSynthesisSettings,
    nowFn: () => number = () => Date.now(),
  ): Promise<RecordInvocationResult> {
    const candidate = this.store.findById(input.skillId);
    if (!candidate) {
      throw new Error(
        `[skill-synthesis] recordInvocation: skill ${input.skillId} not found`,
      );
    }
    this.store.recordInvocation({
      skillId: input.skillId,
      sessionId: input.sessionId,
      succeeded: input.succeeded,
      invokedAt: nowFn(),
      notes: input.notes,
    });
    const successCount = input.succeeded
      ? this.store.incrementSuccess(input.skillId)
      : candidate.successCount;
    const failureCount = !input.succeeded
      ? this.store.incrementFailure(input.skillId)
      : candidate.failureCount;

    let promotion: PromotionDecision | null = null;
    if (
      input.succeeded &&
      candidate.status === 'candidate' &&
      successCount >= settings.successesToPromote
    ) {
      try {
        promotion = await this.promotion.evaluate(
          input.skillId,
          settings,
          nowFn,
        );
      } catch (err) {
        this.logger.warn(
          '[skill-synthesis] promotion evaluation failed (non-fatal)',
          {
            skillId: input.skillId,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }
    return { successCount, failureCount, promotion };
  }
}
