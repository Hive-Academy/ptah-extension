import type { TabState } from '@ptah-extension/chat-types';

/** Stamp a new per-tab failure identity in the same update as its reason. */
export function withTerminalFailureSeq(
  existing: TabState,
  updates: Partial<TabState>,
): Partial<TabState> {
  if (
    Object.prototype.hasOwnProperty.call(updates, 'lastTerminalReason') &&
    updates.lastTerminalReason &&
    updates.lastTerminalReason !== existing.lastTerminalReason
  ) {
    return {
      ...updates,
      terminalFailureSeq: (existing.terminalFailureSeq ?? 0) + 1,
    };
  }
  return updates;
}
