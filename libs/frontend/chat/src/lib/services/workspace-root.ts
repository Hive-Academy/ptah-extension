/** Normalize a workspace root for identity comparisons and map keys. */
export function normalizeWorkspaceRoot(root: string): string {
  const slashed = root.replaceAll('\\', '/').replace(/\/+$/, '');
  // `(\/|$)`: a drive root (`C:\`) has lost its slash above and reads `C:`.
  return /^[a-z]:(\/|$)/i.test(slashed) ? slashed.toLowerCase() : slashed;
}

export function sameWorkspaceRoot(a: string, b: string): boolean {
  return normalizeWorkspaceRoot(a) === normalizeWorkspaceRoot(b);
}
