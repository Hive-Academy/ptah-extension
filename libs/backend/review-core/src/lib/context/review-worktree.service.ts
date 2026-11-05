import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import type { RepoIdentity } from '@ptah-extension/review-contracts';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  type IReviewCommandRunner, type IReviewContextFiles, REVIEW_CONTEXT_TOKENS,
  ReviewRelativePathSchema, ReviewShaSchema,
} from './review-context.ports';
import { sanitizeReviewFailureMessage } from '../review-failure-sanitizer';

const AttemptIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const GitTimeoutMs = 60_000;
const WorktreeTimeoutMs = 180_000;
export class ReviewGitTimeoutError extends Error {
  readonly code = 'git-timeout';
  constructor() { super('Git operation timed out'); }
}
export class ReviewGitHeadMissingError extends Error {
  constructor() { super('PR head commit is unavailable after fetch'); }
}
export class ReviewGitWorktreeError extends Error {
  constructor(stderr: string) { super(`Detached worktree creation failed: ${sanitizeReviewFailureMessage(stderr).slice(0, 180)}`); }
}

export interface ReviewSourceSnapshot { headSha: string; checksum: string; files: readonly string[] }
export interface ReviewAttemptPaths { root: string; src: string; out: string; meta: string }

export function insideRoot(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

@injectable()
export class ReviewWorktreeService {
  constructor(
    @inject(REVIEW_CONTEXT_TOKENS.COMMAND_RUNNER) private readonly commands: IReviewCommandRunner,
    @inject(REVIEW_CONTEXT_TOKENS.FILES) private readonly files: IReviewContextFiles,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  async create(repo: RepoIdentity, repoRoot: string, attemptsRoot: string, attemptId: string, headInput: unknown, prNumber: number, signal?: AbortSignal): Promise<ReviewAttemptPaths> {
    if (signal?.aborted) throw new Error('Review worktree aborted');
    if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('Invalid PR number');
    const headSha = ReviewShaSchema.parse(headInput).toLowerCase();
    const id = AttemptIdSchema.parse(attemptId);
    const root = resolve(attemptsRoot, id);
    const paths = { root, src: resolve(root, 'src'), out: resolve(root, 'out'), meta: resolve(root, 'meta') };
    if (!insideRoot(attemptsRoot, root) || !insideRoot(root, paths.src)) throw new Error('Attempt path escapes root');
    if (await this.files.exists(root)) {
      if (await this.files.exists(paths.src)) {
        const removed = await this.commands.run(repo, 'git', ['worktree', 'remove', '--force', paths.src], repoRoot, GitTimeoutMs);
        if (removed.timedOut) throw new ReviewGitTimeoutError();
        if (removed.exitCode !== 0 || removed.unavailable) throw new Error('Stale review worktree removal failed');
      }
      const pruned = await this.commands.run(repo, 'git', ['worktree', 'prune'], repoRoot, GitTimeoutMs);
      if (pruned.timedOut) throw new ReviewGitTimeoutError();
      if (pruned.exitCode !== 0 || pruned.unavailable) throw new Error('Stale review worktree prune failed');
      await this.files.remove(root);
    }
    const headRef = `${headSha}^{commit}`;
    let present = await this.commands.run(repo, 'git', ['cat-file', '-e', headRef], repoRoot, GitTimeoutMs, signal);
    if (present.timedOut) throw new ReviewGitTimeoutError();
    if (present.exitCode !== 0 || present.unavailable) {
      const fetched = await this.commands.run(repo, 'git', ['fetch', '--no-tags', 'origin', `+refs/pull/${prNumber}/head`], repoRoot, WorktreeTimeoutMs, signal);
      if (fetched.timedOut) throw new ReviewGitTimeoutError();
      present = await this.commands.run(repo, 'git', ['cat-file', '-e', headRef], repoRoot, GitTimeoutMs, signal);
      if (present.timedOut) throw new ReviewGitTimeoutError();
      if (present.exitCode !== 0 || present.unavailable) throw new ReviewGitHeadMissingError();
    }
    await this.files.mkdir(root);
    try {
      const added = await this.commands.run(repo, 'git', ['worktree', 'add', '--detach', paths.src, headSha], repoRoot, WorktreeTimeoutMs, signal);
      if (added.timedOut) throw new ReviewGitTimeoutError();
      if (added.exitCode !== 0 || added.unavailable) throw new ReviewGitWorktreeError(added.stderr);
      const actual = await this.git(repo, paths.src, ['rev-parse', 'HEAD'], false, signal);
      if (actual.trim().toLowerCase() !== headSha) throw new Error('Detached worktree HEAD differs from PR head');
      const detached = await this.git(repo, paths.src, ['symbolic-ref', '-q', 'HEAD'], true, signal);
      if (detached.trim()) throw new Error('Review worktree is attached to a branch');
      await this.files.mkdir(paths.out);
      await this.files.mkdir(paths.meta);
      return paths;
    } catch (error: unknown) {
      await this.cleanupFailedCreate(repo, repoRoot, paths).catch((cleanupError: unknown) => {
        // degradation-audit: reported — preserve the original Git failure and log cleanup failure.
        this.logger.error('Review worktree cleanup failed', cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)));
      });
      throw error;
    }
  }

  private async cleanupFailedCreate(repo: RepoIdentity, repoRoot: string, paths: ReviewAttemptPaths): Promise<void> {
    try {
      await this.commands.run(repo, 'git', ['worktree', 'remove', '--force', paths.src], repoRoot, GitTimeoutMs);
    } finally {
      try { await this.files.remove(paths.root); }
      finally { await this.commands.run(repo, 'git', ['worktree', 'prune'], repoRoot, GitTimeoutMs); }
    }
  }

  async snapshot(repo: RepoIdentity, src: string, expectedSha: string, signal?: AbortSignal): Promise<ReviewSourceSnapshot> {
    if (signal?.aborted) throw new Error('Review snapshot aborted');
    const headSha = ReviewShaSchema.parse(expectedSha).toLowerCase();
    const actual = await this.git(repo, src, ['rev-parse', 'HEAD'], false, signal);
    if (actual.trim().toLowerCase() !== headSha) throw new Error('Review source HEAD changed');
    const index = await this.git(repo, src, ['ls-files', '-s', '-z'], false, signal);
    const entries = index.split('\0');
    if (entries.at(-1) !== '') throw new Error('Invalid review index output');
    const names: string[] = [];
    for (const entry of entries.slice(0, -1)) {
      if (signal?.aborted) throw new Error('Review snapshot aborted');
      const match = /^(?:[0-7]{6}) [a-f0-9]{40} 0\t(.+)$/i.exec(entry);
      if (!match) throw new Error('Invalid review index entry');
      const name = match[1];
      ReviewRelativePathSchema.parse(name);
      const path = resolve(src, name);
      if (!insideRoot(src, path)) throw new Error('Tracked path escapes source root');
      names.push(name);
    }
    const status = await this.git(repo, src, ['status', '--porcelain', '--untracked-files=all'], false, signal);
    if (status.trim()) throw new Error('Review source is dirty');
    if (signal?.aborted) throw new Error('Review snapshot aborted');
    const checksum = createHash('sha256').update(headSha).update('\0').update(index).digest('hex');
    return { headSha, checksum, files: names };
  }

  async assertIntegrity(repo: RepoIdentity, src: string, expected: ReviewSourceSnapshot): Promise<void> {
    const actual = await this.snapshot(repo, src, expected.headSha);
    if (actual.checksum !== expected.checksum) throw new Error('Review source checksum changed');
  }

  async cleanup(repo: RepoIdentity, repoRoot: string, paths: ReviewAttemptPaths): Promise<void> {
    if (!insideRoot(paths.root, paths.src)) throw new Error('Invalid cleanup path');
    const result = await this.commands.run(repo, 'git', ['worktree', 'remove', '--force', paths.src], repoRoot, GitTimeoutMs);
    if (result.exitCode !== 0 && await this.files.exists(paths.src)) throw new Error('Review worktree removal failed');
    await this.files.remove(paths.root);
  }

  private async git(repo: RepoIdentity, cwd: string, args: readonly string[], allowExitOne = false, signal?: AbortSignal): Promise<string> {
    const result = await this.commands.run(repo, 'git', args, cwd, GitTimeoutMs, signal);
    if (result.timedOut) throw new ReviewGitTimeoutError();
    if (result.unavailable || (result.exitCode !== 0 && !(allowExitOne && result.exitCode === 1))) {
      throw new Error(`Git ${args[0]} failed`);
    }
    return result.stdout;
  }
}
