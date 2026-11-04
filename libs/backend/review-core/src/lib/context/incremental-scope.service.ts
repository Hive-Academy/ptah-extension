import { injectable } from 'tsyringe';
import { z } from 'zod';
import { ReviewRelativePathSchema, ReviewShaSchema } from './review-context.ports';

const ScopeInputSchema = z.object({
  headSha: ReviewShaSchema,
  previousReviewedHeadSha: ReviewShaSchema.nullable(),
  newCommitPaths: z.array(ReviewRelativePathSchema).max(5000),
  touchedCallers: z.array(z.object({ path: ReviewRelativePathSchema, outsideDiff: z.boolean() }).strict()).max(5000),
  openFailures: z.array(z.object({ id: z.string().min(1).max(128), path: ReviewRelativePathSchema }).strict()).max(1000),
}).strict();

export type IncrementalScopeInput = z.input<typeof ScopeInputSchema>;
export interface IncrementalScope {
  headSha: string;
  previousReviewedHeadSha: string | null;
  changedPaths: string[];
  dependentPaths: string[];
  recheckFailureIds: string[];
  reviewPaths: string[];
  /** Publication may use this to admit only newly verified root findings. */
  publishNewVerifiedRootsOnly: boolean;
}

/** Computes the bounded review window from a durable previous-head snapshot. */
@injectable()
export class IncrementalScopeService {
  plan(input: IncrementalScopeInput): IncrementalScope {
    const parsed = ScopeInputSchema.parse(input);
    const changedPaths = [...new Set(parsed.newCommitPaths)];
    const dependentPaths = [...new Set(parsed.touchedCallers.filter((caller) => caller.outsideDiff).map((caller) => caller.path))];
    const recheckFailureIds = [...new Set(parsed.openFailures.map((failure) => failure.id))];
    const reviewPaths = [...new Set([...changedPaths, ...dependentPaths, ...parsed.openFailures.map((failure) => failure.path)])];
    return { headSha: parsed.headSha, previousReviewedHeadSha: parsed.previousReviewedHeadSha,
      changedPaths, dependentPaths, recheckFailureIds, reviewPaths,
      publishNewVerifiedRootsOnly: parsed.previousReviewedHeadSha !== null };
  }
}
