import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { LensOutputSchema } from '@ptah-extension/review-contracts';
import { REVIEW_CORE_TOKENS } from '../../di/tokens';
import type { IReviewRepository, ReviewStageRecord } from '../persistence/review-repository.interface';
import { ReviewLaneRunner, type ReviewLaneResult } from '../lanes/review-lane.runner';
import { buildCorrectnessLifecyclePrompt } from '../lanes/prompts/correctness-lifecycle.prompt';
import { buildContractsCallersPrompt } from '../lanes/prompts/contracts-callers.prompt';
import { buildSecurityPrivacyPrompt } from '../lanes/prompts/security-privacy.prompt';
import { buildHostDiConfigPrompt } from '../lanes/prompts/host-di-config.prompt';
import type { ReviewQueueClaim } from '../review-queue.service';
import type { ContextStageResult } from './context-stage.runner';
import { sanitizeReviewFailureMessage } from '../review-failure-sanitizer';
import { recordPromptTruncation } from '../lanes/prompts/prompt-fence';

const lenses = [
  ['correctness-lifecycle', buildCorrectnessLifecyclePrompt], ['contracts-callers', buildContractsCallersPrompt],
  ['security-privacy', buildSecurityPrivacyPrompt], ['host-di-config', buildHostDiConfigPrompt],
] as const;
export type LensStageResult = { lens: typeof lenses[number][0]; result: ReviewLaneResult }[];
const ResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('partial'), reason: z.string(), limitCheck: z.literal('unavailable').optional() }),
  z.object({ status: z.literal('completed'), family: z.string(), output: LensOutputSchema, limitCheck: z.literal('unavailable').optional() }),
]);

@injectable()
export class LensStageRunner {
  constructor(@inject(ReviewLaneRunner) private readonly lanes: ReviewLaneRunner,
    @inject(REVIEW_CORE_TOKENS.REVIEW_REPOSITORY) private readonly repository: IReviewRepository) {}
  async run(claim: ReviewQueueClaim, context: ContextStageResult, deadline: number, signal?: AbortSignal): Promise<LensStageResult> {
    const results: LensStageResult = [];
    for (const [lens, prompt] of lenses) {
      if (signal?.aborted) break;
      const name = `lens:${lens}`;
      const prior = (await this.repository.getStages(claim.attemptId)).find((row) => row.stage === name && row.ordinal === 0);
      if (prior?.state === 'completed') {
        results.push({ lens, result: ResultSchema.parse(await this.repository.getCheckpoint(claim.attemptId, name, 0)) });
        continue;
      }
      const row: ReviewStageRecord = { attemptId: claim.attemptId, stage: name, ordinal: 0, state: 'running',
        startedAt: new Date().toISOString(), endedAt: null, outcome: null, errorSummary: null, artifactHash: null, artifactPath: null };
      await this.repository.saveStage(row);
      try {
        const builtPrompt = prompt(context.promptInput);
        recordPromptTruncation(builtPrompt, context.coverage);
        const result = await this.lanes.run({ repo: claim.repo, prKey: `${claim.repo.owner}/${claim.repo.name}#${claim.prNumber}`,
          attemptId: claim.attemptId, attemptRoot: context.attemptRoot, headSha: claim.headSha,
          kind: lens, prompt: builtPrompt, runDeadlineMs: deadline, signal });
        if (signal?.aborted) break;
        await this.repository.saveCheckpoint(claim.attemptId, name, 0, result);
        await this.repository.saveStage({ ...row, state: result.status === 'completed' ? 'completed' : 'interrupted',
          endedAt: new Date().toISOString(), outcome: result.status,
          errorSummary: result.status === 'partial' ? sanitizeReviewFailureMessage(
            `${result.limitCheck === 'unavailable' ? 'Ran without a limit check; ' : ''}${result.reason}`) :
            result.limitCheck === 'unavailable' ? 'Ran without a limit check' : null });
        results.push({ lens, result });
      } catch (error: unknown) {
        await this.repository.saveStage({ ...row, state: 'failed', endedAt: new Date().toISOString(),
          errorSummary: sanitizeReviewFailureMessage(error instanceof Error ? error.message : 'Lens failed') });
        throw error;
      }
    }
    return results;
  }
}
