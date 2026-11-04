import type { SessionStatus, TabState } from '@ptah-extension/chat-types';
import type { ClosedTabEvent } from './tab-manager.service';
import type { TabWorkspacePartitionService } from './tab-workspace-partition.service';

/**
 * Tab statuses in which a programmatic close must not run. The user can close
 * these through `TabManagerService.closeTab` (which asks first); a silent
 * programmatic close of a busy tab would kill a running turn or lose work.
 */
const BUSY_STATUSES: ReadonlySet<SessionStatus> = new Set([
  'streaming',
  'resuming',
  'switching',
  'awaiting-background',
  'sleeping',
]);

/** What `closeBackgroundTab` needs from its caller. */
export interface BackgroundTabClose {
  /** The background tab to close. */
  readonly tab: TabState;
  /** The workspace partition that holds it. */
  readonly workspacePath: string;
  /** Partition service; used only for `removeBackgroundTab`. */
  readonly partition: Pick<TabWorkspacePartitionService, 'removeBackgroundTab'>;
  /** `TabManagerService.abortStreamingForTab`: returns true when a stream abort was dispatched. */
  abortStreaming(tabId: string): boolean;
  /** `TabManagerService.emitTabClosed`. */
  emitClosed(event: ClosedTabEvent): void;
}

/**
 * Close one tab parked in a BACKGROUND workspace partition (TASK_2026_863).
 *
 * `TabManagerService.closeTab` searches only the active `_tabs` signal, so a
 * tab that sits in a non-active workspace cannot be closed programmatically —
 * this closes it there without switching workspaces. It mirrors `closeTab`'s
 * side effects in the same order: abort the in-flight stream, unregister the
 * session, remove the tab, emit the `close` event (which the session ender
 * reacts to), and persist through the partition's debounced background save.
 *
 * This is the machine-driven path (the auto-hand-off source closer), so it
 * refuses instead of asking: it returns `false` and changes nothing when the
 * tab is busy (see {@link BUSY_STATUSES}) or dirty. The active workspace's
 * tabs are out of scope — the caller routes those to `closeTab`.
 */
export function closeBackgroundTab(close: BackgroundTabClose): boolean {
  const { tab, workspacePath } = close;
  if (BUSY_STATUSES.has(tab.status)) return false;
  if (tab.isDirty) return false;

  // Abort the in-flight streaming RPC BEFORE the removal so the registered
  // abort listener (in MessageSender) can still resolve the session from the
  // partition and dispatch `chat:abort`. The flag rides the close event so the
  // session ender does not send a second abort for the same session.
  const streamAbortDispatched = close.abortStreaming(tab.id);

  const removed = close.partition.removeBackgroundTab(tab.id, workspacePath);
  if (!removed) return false;

  close.emitClosed({
    tabId: tab.id,
    sessionId: removed.claudeSessionId ?? null,
    kind: 'close',
    streamAbortDispatched,
  });
  return true;
}