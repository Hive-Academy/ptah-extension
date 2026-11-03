import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { type IReviewCommandRunner, REVIEW_CONTEXT_TOKENS } from './review-context.ports';

const CheckSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  command: z.string().min(1).max(260),
  args: z.array(z.string().max(1024)).max(100),
  timeoutMs: z.number().int().min(1000).max(600_000),
  needsDependencies: z.boolean(),
}).strict();
export type ReviewCheckDefinition = z.infer<typeof CheckSchema>;
export interface ReviewCheckResult { name: string; status: 'available' | 'unavailable' | 'failed'; reason: string | null; exitCode: number | null; invocation: readonly string[] }

@injectable()
export class ReviewChecksService {
  constructor(@inject(REVIEW_CONTEXT_TOKENS.COMMAND_RUNNER) private readonly commands: IReviewCommandRunner) {}

  async run(src: string, definitionsInput: unknown, dependenciesReady: boolean): Promise<ReviewCheckResult[]> {
    const definitions = z.array(CheckSchema).max(20).parse(definitionsInput);
    const results: ReviewCheckResult[] = [];
    for (const check of definitions) {
      const invocation = ['scripts/verify.mjs', '--exec', '--task', `review-${check.name}`, '--', check.command, ...check.args];
      if (/(^|[^a-z])(build|serve|dev|e2e)([^a-z]|$)/i.test(check.name) ||
          check.args.some((arg) => /^(build|serve|dev|e2e)$/.test(arg))) {
        results.push({ name: check.name, status: 'unavailable', reason: 'Unsafe default check target', exitCode: null, invocation });
        continue;
      }
      if (check.needsDependencies && !dependenciesReady) {
        results.push({ name: check.name, status: 'unavailable', reason: 'Dependencies unavailable', exitCode: null, invocation });
        continue;
      }
      try {
        const result = await this.commands.run('node', invocation, src, check.timeoutMs);
        const status = result.timedOut || result.unavailable ? 'unavailable' : result.exitCode === 0 ? 'available' : 'failed';
        results.push({ name: check.name, status, reason: result.timedOut ? 'Timed out' : result.unavailable ?? (status === 'failed' ? `Exit ${result.exitCode}` : null), exitCode: result.exitCode, invocation });
      } catch (error: unknown) {
        results.push({ name: check.name, status: 'unavailable', reason: error instanceof Error ? error.message : String(error), exitCode: null, invocation });
      }
    }
    return results;
  }
}
