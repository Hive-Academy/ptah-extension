export function resolveScopeFromKey(
  effectiveKey: string,
  globalKey: string,
): { scope: 'global' | 'app' | 'workspace'; runtime?: string } {
  if (effectiveKey === globalKey) {
    return { scope: 'global' };
  }
  const appMatch = /^app\.([^.]+)\.(.*)$/.exec(effectiveKey);
  if (appMatch) {
    const runtime = appMatch[1];
    const rest = appMatch[2];
    if (rest.startsWith('workspace.')) {
      return { scope: 'workspace', runtime };
    }
    return { scope: 'app', runtime };
  }
  if (effectiveKey.startsWith('workspace.')) {
    return { scope: 'workspace' };
  }
  return { scope: 'global' };
}
