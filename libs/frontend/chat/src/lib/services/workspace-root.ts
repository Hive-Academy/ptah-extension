import { normalizeWorkspaceRoot as normalizeRootKey } from '@ptah-extension/shared';

/**
 * Normalize a workspace root for identity comparisons and map keys.
 *
 * Delegates to the shared `normalizeWorkspaceRoot`, so chat (session stats,
 * change sets, the task reader) and the git dock decide "same root" by ONE
 * rule (TASK_2026_855 review): separators folded, trailing separators
 * dropped, case folded on every platform.
 */
export function normalizeWorkspaceRoot(root: string): string {
  return normalizeRootKey(root);
}

export function sameWorkspaceRoot(a: string, b: string): boolean {
  return normalizeWorkspaceRoot(a) === normalizeWorkspaceRoot(b);
}
