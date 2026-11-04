import { resolve } from 'node:path';
import { z } from 'zod';
import type { RepoIdentity } from '@ptah-extension/review-contracts';
import { ReviewWorktreeService, type IReviewLaneFiles, type ReviewRoots } from '@ptah-extension/review-core';

const attemptIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Uses the exact detached worktree created by the context stage. */
export class ReviewLaneFiles implements IReviewLaneFiles {
  constructor(
    private readonly worktree: ReviewWorktreeService,
    private readonly roots: () => Promise<ReviewRoots>,
  ) {}

  private async source(attemptRoot: string): Promise<string> {
    const { attemptsRoot } = await this.roots();
    const id = attemptIdSchema.parse(attemptRoot.slice(resolve(attemptsRoot).length + 1));
    if (resolve(attemptsRoot, id) !== resolve(attemptRoot)) throw new Error('Review attempt is outside root');
    return resolve(attemptRoot, 'src');
  }

  async prepare(repo: RepoIdentity, attemptRoot: string, headSha: string): Promise<void> {
    const source = await this.source(attemptRoot);
    await this.worktree.snapshot(repo, source, headSha);
  }

  async sourceChecksum(repo: RepoIdentity, attemptRoot: string, headSha: string): Promise<string> {
    const source = await this.source(attemptRoot);
    const snapshot = await this.worktree.snapshot(repo, source, headSha);
    return snapshot.checksum;
  }
}
