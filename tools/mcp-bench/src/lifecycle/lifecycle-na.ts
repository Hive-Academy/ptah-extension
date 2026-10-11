/**
 * Small helpers of the lifecycle scenarios: `na` rows and the coverage quote.
 * Kept apart from `lifecycle-scenarios.ts` (700-line ceiling); it takes the
 * result type from there as a type-only import.
 */

import type { LifecycleResult } from './lifecycle-scenarios';

/**
 * `na` rows for the cases of `expected` that this host cannot run at all
 * (attach mode never writes state; the Electron app has no memory seeding
 * hook): the reason is the row's `na`, it is not a failure, and no suite or
 * gate judges it.
 */
export function naScenarios(
  expected: readonly { scenario: string; tool: string }[],
  reason: string,
): LifecycleResult[] {
  return expected.map((item) => ({
    ...item,
    pass: false,
    detail: '',
    na: reason,
  }));
}

/** The scenarios of {@link SESSION_SCENARIOS} that read the seeded memory roots. */
export const MEMORY_SEEDED_SCENARIOS: readonly string[] = [
  'two-workspaces-memory-leak',
  'worktree-memory-scope',
  'worktree-spool-path',
];

/** The `coverage` block of an answer (census, counts, omittedByCap), trimmed; `none` when absent. */
export function coverageOf(text: string): string {
  const start = text.search(/"coverage"\s*:\s*\{/);
  if (start < 0) return 'none in the answer';
  let depth = 0;
  for (let index = text.indexOf('{', start); index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0)
        return text.slice(text.indexOf('{', start), index + 1).slice(0, 400);
    }
  }
  return 'unterminated';
}
