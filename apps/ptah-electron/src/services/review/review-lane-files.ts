import { isAbsolute, relative, resolve } from 'node:path';
import { mkdir, readFile, realpath, unlink } from 'node:fs/promises';
import { z } from 'zod';
import type { RepoIdentity } from '@ptah-extension/review-contracts';
import { ReviewWorktreeService, type IReviewLaneFiles, type ReviewRoots } from '@ptah-extension/review-core';

const attemptIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Uses the exact detached worktree created by the context stage. */
export class ReviewLaneFiles implements IReviewLaneFiles {
  constructor(
    private readonly worktree: ReviewWorktreeService,
    private readonly roots: (attemptRoot: string) => Promise<ReviewRoots>,
  ) {}

  private async source(attemptRoot: string): Promise<string> {
    const { attemptsRoot } = await this.roots(attemptRoot);
    const id = attemptIdSchema.parse(attemptRoot.slice(resolve(attemptsRoot).length + 1));
    if (resolve(attemptsRoot, id) !== resolve(attemptRoot)) throw new Error('Review attempt is outside root');
    return resolve(attemptRoot, 'src');
  }

  async prepare(repo: RepoIdentity, attemptRoot: string, headSha: string, signal?: AbortSignal): Promise<string> {
    const source = await this.source(attemptRoot);
    const snapshot = await this.worktree.snapshot(repo, source, headSha, signal);
    return snapshot.checksum;
  }

  async sourceChecksum(repo: RepoIdentity, attemptRoot: string, headSha: string, signal?: AbortSignal): Promise<string> {
    const source = await this.source(attemptRoot);
    const snapshot = await this.worktree.snapshot(repo, source, headSha, signal);
    return snapshot.checksum;
  }

  async clearOutput(attemptRoot: string, includeWalkthrough: boolean): Promise<void> {
    await this.source(attemptRoot);
    const attempt = await realpath(attemptRoot);
    const outPath = resolve(attemptRoot, 'out');
    await mkdir(outPath, { recursive: true });
    const out = await realpath(outPath);
    if (relative(attempt, out) !== 'out') throw new Error('Lane output escapes attempt out/');
    // Publication reads the triage walkthrough after all lanes, so later lanes keep it.
    const names = includeWalkthrough ? ['lane-output.json', 'walkthrough.md'] : ['lane-output.json'];
    for (const name of names) {
      try {
        await unlink(resolve(out, name));
      } catch (error: unknown) {
        // fs errors can come from another realm (Jest), so avoid instanceof Error.
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
          continue;
        }
        throw error;
      }
    }
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
