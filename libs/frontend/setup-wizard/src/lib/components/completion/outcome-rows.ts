import type { FileOutcome, GenerationTargetInfo } from '@ptah-extension/shared';

/**
 * Outcome row shape and Library reachability shared by the completion
 * surfaces. Kept apart from the completion components so the parents can use
 * them eagerly while the components themselves load in `@defer` chunks.
 */

/** One processed agent file on a completion surface. */
export interface OutcomeFileRow {
  readonly id: string;
  /** File name shown under `.claude/agents/`, e.g. `tester.md`. */
  readonly fileName: string;
  readonly status: FileOutcome;
  /** Raw failure detail; never rendered, only classified (B5). */
  readonly error?: string;
}

/**
 * Whether Library copy (diverged naming, grade copy, stale notice) applies:
 * only in Electron (VS Code has no Library, D3) and only when the agents went
 * to the root the Library reads. An unknown target shows no Library copy.
 */
export function libraryReachable(
  isElectron: boolean,
  target: GenerationTargetInfo | undefined,
): boolean {
  if (!isElectron || !target) return false;
  return target.chosen === 'harness-root' || target.openedIsHarnessRoot;
}
