import { isAbsolute, relative, resolve } from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
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

  async prepare(repo: RepoIdentity, attemptRoot: string, headSha: string, signal?: AbortSignal): Promise<void> {
    const source = await this.source(attemptRoot);
    await this.worktree.snapshot(repo, source, headSha, signal);
  }

  async sourceChecksum(repo: RepoIdentity, attemptRoot: string, headSha: string, signal?: AbortSignal): Promise<string> {
    const source = await this.source(attemptRoot);
    const snapshot = await this.worktree.snapshot(repo, source, headSha, signal);
    return snapshot.checksum;
  }

  async readOutput(attemptRoot: string, name: 'lane-output.json' | 'walkthrough.md'): Promise<string> {
    await this.source(attemptRoot);
    const attempt = await realpath(attemptRoot);
    const out = await realpath(resolve(attemptRoot, 'out'));
    if (relative(attempt, out) !== 'out') throw new Error('Lane output escapes attempt out/');
    const target = await realpath(resolve(out, name));
    const rel = relative(out, target);
    if (rel !== name || isAbsolute(rel)) throw new Error('Lane output escapes attempt out/');
    return readFile(target, 'utf8');
  }
}
