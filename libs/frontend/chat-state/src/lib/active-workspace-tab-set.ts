/** A null partition is the VS Code panel's tab set for its configured root. */
export function isActiveWorkspaceTabSet(
  workspacePath: string,
  activeWorkspacePath: string | null,
  workspaceRoot: string | undefined,
  isVSCode: boolean,
): boolean {
  if (!workspacePath.trim()) return false;
  if (activeWorkspacePath !== null)
    return workspacePath === activeWorkspacePath;
  if (!isVSCode || !workspaceRoot?.trim()) return false;
  const normalize = (path: string): string => {
    const slashed = path.replaceAll('\\', '/').replace(/\/+$/, '');
    return /^[a-z]:(\/|$)/i.test(slashed) ? slashed.toLowerCase() : slashed;
  };
  return normalize(workspacePath) === normalize(workspaceRoot);
}
