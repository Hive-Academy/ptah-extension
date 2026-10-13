/** Normalize a workspace root for identity comparisons and map keys. */
export function normalizeWorkspaceRoot(root: string): string {
  const slashed = root.replaceAll('\\', '/').replace(/\/+$/, '');
  return /^[a-z]:\//i.test(slashed) ? slashed.toLowerCase() : slashed;
}

export function sameWorkspaceRoot(a: string, b: string): boolean {
  return normalizeWorkspaceRoot(a) === normalizeWorkspaceRoot(b);
}
