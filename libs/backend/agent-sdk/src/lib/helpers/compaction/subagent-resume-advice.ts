/**
 * Whether a subagent should be resumed or replaced by a fresh one, from what
 * the subagent budget monitor knows about it.
 */

export type SubagentResumeAdvice = 'fresh' | 'resume';

export interface SubagentResumeAdviceInput {
  readonly stopped: boolean;
  readonly cacheState: 'warm' | 'cold';
  /** Last known context size; `undefined` when the monitor saw no usage. */
  readonly contextTokens: number | undefined;
  /** `compaction.subagentHandoffTokens`. */
  readonly handoffTokens: number;
  readonly budgetReached: boolean;
}

/**
 * Whether to resume a subagent or start a fresh one: `fresh` when it was
 * stopped, its prompt cache is cold, its context reached the handoff size, or
 * it reached its weighted budget; otherwise `resume`.
 */
export function adviseSubagentResume(
  input: SubagentResumeAdviceInput,
): SubagentResumeAdvice {
  if (input.stopped || input.budgetReached || input.cacheState === 'cold') {
    return 'fresh';
  }
  if (
    input.contextTokens !== undefined &&
    input.contextTokens >= input.handoffTokens
  ) {
    return 'fresh';
  }
  return 'resume';
}
