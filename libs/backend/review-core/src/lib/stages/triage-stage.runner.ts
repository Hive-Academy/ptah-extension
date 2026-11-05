import { inject, injectable } from 'tsyringe';
import { ReviewLaneRunner, type ReviewLaneResult } from '../lanes/review-lane.runner';
import { buildTriagePrompt } from '../lanes/prompts/triage.prompt';
import { recordPromptTruncation } from '../lanes/prompts/prompt-fence';
import type { ReviewQueueClaim } from '../review-queue.service';
import type { ContextStageResult } from './context-stage.runner';

@injectable()
export class TriageStageRunner {
  constructor(@inject(ReviewLaneRunner) private readonly lanes: ReviewLaneRunner) {}
  run(claim: ReviewQueueClaim, context: ContextStageResult, deadline: number, signal?: AbortSignal): Promise<ReviewLaneResult> {
    const prompt = buildTriagePrompt(context.promptInput);
    recordPromptTruncation(prompt, context.coverage);
    return this.lanes.run({ repo: claim.repo, prKey: `${claim.repo.owner}/${claim.repo.name}#${claim.prNumber}`, attemptId: claim.attemptId,
      attemptRoot: context.attemptRoot, headSha: claim.headSha, kind: 'triage',
      prompt, runDeadlineMs: deadline, signal });
  }
}
