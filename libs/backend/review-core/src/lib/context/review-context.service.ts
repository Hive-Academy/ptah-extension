import { resolve } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { type IReviewCommandRunner, REVIEW_CONTEXT_TOKENS, ReviewRelativePathSchema } from './review-context.ports';
import { insideRoot } from './review-worktree.service';

const SymbolSchema = z.string().regex(/^[A-Za-z_$][\w$]{0,127}$/);
const ChangedFileSchema = z.array(ReviewRelativePathSchema).max(5000);
const timeoutMs = 30_000;
export interface ReviewCaller { symbol: string; path: string; line: number; outsideDiff: boolean }
export interface ReviewContext { changedPaths: readonly string[]; changedLockfiles: readonly string[]; callers: readonly ReviewCaller[] }

@injectable()
export class ReviewContextService {
  constructor(@inject(REVIEW_CONTEXT_TOKENS.COMMAND_RUNNER) private readonly commands: IReviewCommandRunner) {}

  /** Search the complete checked-out source, including files absent from the diff. */
  async build(src: string, changedPathsInput: unknown, changedSymbolsInput: unknown): Promise<ReviewContext> {
    const changedPaths = ChangedFileSchema.parse(changedPathsInput);
    const symbols = z.array(SymbolSchema).max(200).parse(changedSymbolsInput);
    for (const path of changedPaths) if (!insideRoot(src, resolve(src, path))) throw new Error('Changed path escapes source');
    const changed = new Set(changedPaths);
    const callers: ReviewCaller[] = [];
    for (const symbol of new Set(symbols)) {
      const result = await this.commands.run('git', ['grep', '-n', '-F', '-e', symbol, '--', '*.ts', '*.tsx', '*.js', '*.jsx'], src, timeoutMs);
      if (result.timedOut || result.unavailable || (result.exitCode !== 0 && result.exitCode !== 1)) throw new Error('Caller search unavailable');
      for (const row of result.stdout.split('\n').filter(Boolean)) {
        const match = /^(.+?):(\d+):(.*)$/.exec(row);
        if (!match) continue;
        const path = ReviewRelativePathSchema.parse(match[1]);
        if (!insideRoot(src, resolve(src, path))) throw new Error('Caller path escapes source');
        const line = Number(match[2]);
        if (!Number.isSafeInteger(line) || line < 1) continue;
        callers.push({ symbol, path, line, outsideDiff: !changed.has(path) });
      }
    }
    const changedLockfiles = changedPaths.filter((path) => /(^|\/)(package-lock\.json|npm-shrinkwrap\.json)$/.test(path));
    return { changedPaths, changedLockfiles, callers };
  }
}
