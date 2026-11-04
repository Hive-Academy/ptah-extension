import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import type { RepoIdentity } from '@ptah-extension/review-contracts';
import { type IReviewCommandRunner, REVIEW_CONTEXT_TOKENS, ReviewRelativePathSchema } from './review-context.ports';

const CheckSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  command: z.string().min(1).max(260),
  args: z.array(z.string().max(1024)).max(100),
  timeoutMs: z.number().int().min(1000).max(600_000),
  needsDependencies: z.boolean(),
  scope: z.array(ReviewRelativePathSchema).max(80).default([]),
}).strict();
export type ReviewCheckDefinition = z.input<typeof CheckSchema>;
export interface ReviewCheckResult { name: string; status: 'available' | 'unavailable' | 'failed'; reason: string | null;
  exitCode: number | null; invocation: readonly string[]; scope: readonly string[]; diagnostics: string | null; truncated: boolean }

function diagnosticSnippet(value: string): { diagnostics: string | null; truncated: boolean } {
  const redacted = value
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, '[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, '[REDACTED]')
    .replace(/\b(authorization|x-api-key|api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
  return { diagnostics: redacted ? redacted.slice(0, 4000) : null, truncated: redacted.length > 4000 };
}

@injectable()
export class ReviewChecksService {
  constructor(@inject(REVIEW_CONTEXT_TOKENS.COMMAND_RUNNER) private readonly commands: IReviewCommandRunner) {}

  async run(repo: RepoIdentity, src: string, definitionsInput: unknown, dependenciesReady: boolean, signal?: AbortSignal): Promise<ReviewCheckResult[]> {
    const definitions = z.array(CheckSchema).max(20).parse(definitionsInput);
    const results: ReviewCheckResult[] = [];
    for (const check of definitions) {
      if (signal?.aborted) throw new Error('Review checks aborted');
      const invocation = ['scripts/verify.mjs', '--exec', '--task', `review-${check.name}`, '--', check.command, ...check.args];
      if (/(^|[^a-z])(build|serve|dev|e2e)([^a-z]|$)/i.test(check.name) ||
          check.args.some((arg) => /^(build|serve|dev|e2e)$/.test(arg))) {
        results.push({ name: check.name, status: 'unavailable', reason: 'Unsafe default check target', exitCode: null,
          invocation, scope: check.scope, diagnostics: null, truncated: false });
        continue;
      }
      if (check.needsDependencies && !dependenciesReady) {
        results.push({ name: check.name, status: 'unavailable', reason: 'Dependencies unavailable', exitCode: null,
          invocation, scope: check.scope, diagnostics: null, truncated: false });
        continue;
      }
      try {
        const result = await this.commands.run(repo, 'node', invocation, src, check.timeoutMs, signal);
        if (signal?.aborted) throw new Error('Review checks aborted');
        const status = result.timedOut || result.unavailable ? 'unavailable' : result.exitCode === 0 ? 'available' : 'failed';
        const snippet = diagnosticSnippet(`${result.stdout}\n${result.stderr}`.trim());
        results.push({ name: check.name, status, reason: result.timedOut ? 'Timed out or output limit reached' : result.unavailable ?? (status === 'failed' ? `Exit ${result.exitCode}` : null),
          exitCode: result.exitCode, invocation, scope: check.scope, diagnostics: snippet.diagnostics,
          truncated: snippet.truncated || result.timedOut });
      } catch (error: unknown) {
        if (signal?.aborted) throw error;
        results.push({ name: check.name, status: 'unavailable', reason: 'Check invocation failed', exitCode: null,
          invocation, scope: check.scope, diagnostics: null, truncated: false });
      }
    }
    return results;
  }
}
