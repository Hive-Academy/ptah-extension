import { computed, inject, type Signal } from '@angular/core';
import {
  SessionMcpStatusRegistry,
  TabManagerService,
  type SessionMcpStatus,
} from '@ptah-extension/chat-state';

/**
 * The newest recorded session key that belongs to the member set, or `null`.
 *
 * `recordedKeys` is `SessionMcpStatusRegistry.sessions()`: `record` re-inserts
 * a key on every write, so walking from the end meets the newest report first.
 */
export function newestWorkspaceSessionKey(
  recordedKeys: readonly string[],
  memberKeys: ReadonlySet<string>,
): string | null {
  for (let index = recordedKeys.length - 1; index >= 0; index--) {
    const key = recordedKeys[index];
    if (memberKeys.has(key)) return key;
  }
  return null;
}

function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}

/**
 * The MCP picture of the newest session OF THE ACTIVE WORKSPACE, or `null`.
 *
 * The registry is root-provided and spans every workspace, while the
 * Marketplace's `listInstalled` read is workspace-scoped; pairing the two
 * unscoped would label another workspace's project servers as claude.ai
 * connectors (plan Revision 3, D-4). A session belongs to the active workspace
 * when its registry key is the `id` or the `claudeSessionId` of a tab in
 * `TabManagerService.tabs()` — the two keys the registry is written under (a
 * push arrives under the tabId until the SDK reports the real UUID). A session
 * whose tab was closed no longer counts.
 *
 * `tabs()` is rewritten on every streaming flush, so the member set compares
 * CONTENTS: a flush that keeps the same keys re-derives nothing downstream. The
 * registry's stored object is returned unchanged, so an unrelated `record`
 * still yields the same reference.
 *
 * Reads signals only: no I/O, no RPC (plan D4). Must run in an injection
 * context.
 */
export function injectWorkspaceSessionStatus(): Signal<SessionMcpStatus | null> {
  const registry = inject(SessionMcpStatusRegistry);
  const tabs = inject(TabManagerService).tabs;
  const members = computed<ReadonlySet<string>>(
    () => {
      const keys = new Set<string>();
      for (const tab of tabs()) {
        keys.add(tab.id);
        if (tab.claudeSessionId !== null) keys.add(tab.claudeSessionId);
      }
      return keys;
    },
    { equal: sameKeys },
  );
  return computed(() => {
    const key = newestWorkspaceSessionKey(registry.sessions(), members());
    return key === null ? null : registry.peek(key);
  });
}
