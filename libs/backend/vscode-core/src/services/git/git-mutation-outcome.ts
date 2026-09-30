import type { GitMutationFailureCode } from '@ptah-extension/shared';
import { GitCancelledError, GitTimeoutError } from '../../utils/exec-git';
import type { GitWriteResult } from './git-write-lock';

/** The shape every `GitInfoService` mutation result shares. */
export interface MutationOutcome {
  success: boolean;
  error?: string;
  code?: GitMutationFailureCode;
}

/**
 * A mutation's result from its one write (TASK_2026_576 RC1/RC6): the lock's
 * `LOCKED` with the fixed message, git's own failure text, or success.
 */
export function writeOutcome(
  run: GitWriteResult,
  fallback: string,
): MutationOutcome {
  if (run.code === 'LOCKED') {
    return { success: false, code: 'LOCKED', error: run.message };
  }
  if (run.exitCode === 0) return { success: true };
  // A conflicted stash apply/pop reports on stdout ("CONFLICT (content): …").
  return {
    success: false,
    error: run.stderr.trim() || run.stdout.trim() || fallback,
  };
}

/** A mutation that threw; a timeout or a cancellation keeps its code. */
export function thrownOutcome(error: unknown): MutationOutcome {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof GitTimeoutError) {
    return { success: false, code: 'TIMEOUT', error: message };
  }
  if (error instanceof GitCancelledError) {
    return { success: false, code: 'CANCELLED', error: message };
  }
  return { success: false, error: message };
}
