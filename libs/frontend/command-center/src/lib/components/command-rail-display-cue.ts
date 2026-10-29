import type { DisplayDockTabState } from '@ptah-extension/chat';

/** What the rail watches of the Live target's dock entry. */
export interface DisplayDockView {
  readonly tabId: string;
  readonly state: DisplayDockTabState;
  readonly fullscreenArtifactId: string | null;
}

/**
 * Whether the dock change from `previous` to `next` came from a user action
 * in the Live transcript (a chip's `openSurface`, `openArtifact` or
 * `openSummary`, or a fullscreen request), so the rail should show the
 * Display tab. The sync's auto-open is excluded: it always advances
 * `surfaceRevision`, the user opens never do. So is the agent monitor's
 * open, which lands on the Agents tab, and a publication that only clears
 * the selection.
 */
export function isUserDisplayOpen(
  previous: DisplayDockView,
  next: DisplayDockView,
): boolean {
  if (previous.tabId !== next.tabId) return false;
  if (
    next.fullscreenArtifactId !== null &&
    next.fullscreenArtifactId !== previous.fullscreenArtifactId
  ) {
    return true;
  }
  const before = previous.state;
  const after = next.state;
  if (before === after || after.surfaceRevision !== before.surfaceRevision) {
    return false;
  }
  if (!after.open || after.activeTab !== 'displays') return false;
  return (
    !before.open ||
    (after.selection !== null && after.selection !== before.selection)
  );
}
