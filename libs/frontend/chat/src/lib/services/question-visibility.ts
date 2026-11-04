/** The router owns a question once it supplies targets; raw ids are only a fallback. */
export function questionBelongsToTab(
  request: { readonly tabId?: string; readonly sessionId?: string },
  targets: readonly string[],
  workflowClaimed: boolean,
  tabId: string | null,
  sessionId: string | null,
): boolean {
  if (targets.length > 0) return tabId !== null && targets.includes(tabId);
  if (workflowClaimed) return false;
  return (tabId !== null && (request.tabId === tabId || request.sessionId === tabId)) ||
    (sessionId !== null && request.sessionId === sessionId);
}
