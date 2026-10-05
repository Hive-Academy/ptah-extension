import { DestroyRef, Injectable, inject, untracked } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  ConversationRegistry,
  TabManagerService,
  TabSessionBinding,
  type ClosedTabEvent,
} from '@ptah-extension/chat-state';
import type { SessionId } from '@ptah-extension/shared';

/**
 * ClosedTabSessionEnderService — ends the backend session of a tab the user
 * closed (TASK_2026_592).
 *
 * Reacts to `TabManagerService.onTabClosed` and sends `chat:abort` for the
 * closed tab's session, so closing a tab stops its claude process instead of
 * leaving it alive until app exit. It acts only on a real `close`:
 *   - `forceClose` (pop-out transfer) and `reset` (`/clear`) never end a
 *     session, and a workspace switch never emits a close event at all.
 *   - A streaming close already sent `chat:abort` through the abort listener
 *     in `MessageSenderService` (`streamAbortDispatched`); a second abort could
 *     overwrite the first one's persisted resume state, so it is skipped.
 *   - A session still shown by another tab (any workspace partition, canvas
 *     tiles included) or by a non-tab surface bound to the same conversation
 *     (setup-wizard / harness via `TabSessionBinding.bindSurface`) is kept.
 *
 * Root singleton, instantiated eagerly by the shells. The RPC is
 * fire-and-forget: `closeTab` never waits for it and a failure is logged,
 * never thrown out of the effect.
 */
@Injectable({ providedIn: 'root' })
export class ClosedTabSessionEnderService {
  private readonly tabManager = inject(TabManagerService);
  private readonly conversations = inject(ConversationRegistry);
  private readonly binding = inject(TabSessionBinding);
  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // `onTabClosed` delivers every event synchronously, so back-to-back closes
    // cannot coalesce before this service evaluates each orphaned session.
    this.destroyRef.onDestroy(
      this.tabManager.onTabClosed((closed) =>
        untracked(() => this.endSessionIfOrphaned(closed)),
      ),
    );
  }

  private endSessionIfOrphaned(closed: ClosedTabEvent): void {
    if (closed.kind !== 'close') return;
    if (closed.streamAbortDispatched === true) return;
    if (typeof closed.sessionId !== 'string' || closed.sessionId.length === 0)
      return;
    const sessionId = closed.sessionId as SessionId;
    if (this.isStillDisplayed(sessionId, closed.tabId)) return;

    const params = { sessionId };
    try {
      this.claudeRpcService.call('chat:abort', params).catch((error) => {
        this.warn(closed.tabId, sessionId, error);
      });
    } catch (error) {
      this.warn(closed.tabId, sessionId, error);
    }
  }

  /**
   * True when another tab or a non-tab surface still shows the session. The
   * closed tab is excluded explicitly, so this remains correct regardless of
   * whether StreamRouter has unbound it yet.
   */
  private isStillDisplayed(
    sessionId: SessionId,
    closedTabId: string,
  ): boolean {
    if (
      this.tabManager
        .findTabsBySessionId(sessionId)
        .some((tab) => tab.id !== closedTabId)
    ) {
      return true;
    }
    const record = this.conversations.findContainingSession(sessionId);
    return record !== null && this.binding.surfacesFor(record.id).length > 0;
  }

  private warn(tabId: string, sessionId: string, error: unknown): void {
    console.warn('[ClosedTabSessionEnder] chat:abort failed on tab close', {
      tabId,
      sessionId,
      error,
    });
  }
}
