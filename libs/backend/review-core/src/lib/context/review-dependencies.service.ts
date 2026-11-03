import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { type IReviewCommandRunner, type IReviewContextFiles, REVIEW_CONTEXT_TOKENS } from './review-context.ports';
import { insideRoot } from './review-worktree.service';

export interface ReviewDependencyResult { status: 'available' | 'unavailable' | 'failed'; reason: string | null; source: string; lockfileSha256: string | null; scriptsDisabled: true; invocation: readonly string[] | null }

@injectable()
export class ReviewDependenciesService {
  constructor(
    @inject(REVIEW_CONTEXT_TOKENS.COMMAND_RUNNER) private readonly commands: IReviewCommandRunner,
    @inject(REVIEW_CONTEXT_TOKENS.FILES) private readonly files: IReviewContextFiles,
  ) {}

  async prepare(src: string, changedLockfiles: readonly string[], allowChangedLockfileInstall: boolean): Promise<ReviewDependencyResult> {
    const path = resolve(src, 'package-lock.json');
    if (!insideRoot(src, path)) throw new Error('Lockfile path escapes source');
    const invocation = ['scripts/verify.mjs', '--exec', '--task', 'review-npm-ci', '--', 'npm', 'ci', '--ignore-scripts'];
    const source = changedLockfiles.length ? 'PR head changed lockfile' : 'PR head unchanged lockfile';
    if (changedLockfiles.length && !allowChangedLockfileInstall) return { status: 'unavailable', reason: 'Changed lockfile requires explicit policy', source, lockfileSha256: null, scriptsDisabled: true, invocation: null };
    if (!await this.files.exists(path)) return { status: 'unavailable', reason: 'package-lock.json missing', source, lockfileSha256: null, scriptsDisabled: true, invocation: null };
    const before = createHash('sha256').update(await this.files.read(path)).digest('hex');
    try {
      const run = await this.commands.run('node', invocation, src, 600_000);
      const after = createHash('sha256').update(await this.files.read(path)).digest('hex');
      if (before !== after) return { status: 'failed', reason: 'Lockfile changed during install', source, lockfileSha256: after, scriptsDisabled: true, invocation };
      const status = run.timedOut || run.unavailable ? 'unavailable' : run.exitCode === 0 ? 'available' : 'failed';
      return { status, reason: run.timedOut ? 'Timed out' : run.unavailable ?? (status === 'failed' ? `Exit ${run.exitCode}` : null), source, lockfileSha256: after, scriptsDisabled: true, invocation };
    } catch (error: unknown) {
      return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error), source, lockfileSha256: before, scriptsDisabled: true, invocation };
    }
  }
}
