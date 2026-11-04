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

const AttemptIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const GitTimeoutMs = 30_000;

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

  async create(repo: RepoIdentity, repoRoot: string, attemptsRoot: string, attemptId: string, headInput: unknown, signal?: AbortSignal): Promise<ReviewAttemptPaths> {
    if (signal?.aborted) throw new Error('Review worktree aborted');
    const headSha = ReviewShaSchema.parse(headInput).toLowerCase();
    const id = AttemptIdSchema.parse(attemptId);
    const root = resolve(attemptsRoot, id);
    const paths = { root, src: resolve(root, 'src'), out: resolve(root, 'out'), meta: resolve(root, 'meta') };
    if (!insideRoot(attemptsRoot, root) || !insideRoot(root, paths.src)) throw new Error('Attempt path escapes root');
    if (await this.files.exists(root)) throw new Error('Attempt already exists');
    await this.files.mkdir(root);
    const added = await this.commands.run(repo, 'git', ['worktree', 'add', '--detach', paths.src, headSha], repoRoot, GitTimeoutMs, signal);
    if (added.exitCode !== 0 || added.timedOut || added.unavailable) throw new Error('Detached worktree creation failed');
    try {
      const actual = await this.git(repo, paths.src, ['rev-parse', 'HEAD'], false, signal);
      if (actual.trim().toLowerCase() !== headSha) throw new Error('Detached worktree HEAD differs from PR head');
      const detached = await this.git(repo, paths.src, ['symbolic-ref', '-q', 'HEAD'], true, signal);
      if (detached.trim()) throw new Error('Review worktree is attached to a branch');
      await this.files.mkdir(paths.out);
      await this.files.mkdir(paths.meta);
      return paths;
    } catch (error: unknown) {
      await this.cleanup(repo, repoRoot, paths).catch((cleanupError: unknown) => {
        this.logger.error('Review worktree cleanup failed', cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)));
      });
      throw error;
    }
  }

  async snapshot(repo: RepoIdentity, src: string, expectedSha: string, signal?: AbortSignal): Promise<ReviewSourceSnapshot> {
    if (signal?.aborted) throw new Error('Review snapshot aborted');
    const headSha = ReviewShaSchema.parse(expectedSha).toLowerCase();
    const actual = await this.git(repo, src, ['rev-parse', 'HEAD'], false, signal);
    if (actual.trim().toLowerCase() !== headSha) throw new Error('Review source HEAD changed');
    const names = (await this.git(repo, src, ['ls-files', '-z'], false, signal)).split('\0').filter(Boolean);
    const hash = createHash('sha256');
    for (const name of names) {
      if (signal?.aborted) throw new Error('Review snapshot aborted');
      ReviewRelativePathSchema.parse(name);
      const path = resolve(src, name);
      if (!insideRoot(src, path)) throw new Error('Tracked path escapes source root');
      hash.update(name).update('\0').update(await this.files.read(path)).update('\0');
    }
    const status = await this.git(repo, src, ['status', '--porcelain', '--untracked-files=all'], false, signal);
    if (status.trim()) throw new Error('Review source is dirty');
    return { headSha, checksum: hash.digest('hex'), files: names };
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
    if (result.timedOut || result.unavailable || (result.exitCode !== 0 && !(allowExitOne && result.exitCode === 1))) {
      throw new Error(`Git ${args[0]} failed`);
    }
    return result.stdout;
  }
}
