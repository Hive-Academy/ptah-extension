import { Injectable, effect, inject, untracked } from '@angular/core';
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
 * Reacts to `TabManagerService.closedTab` and sends `chat:abort` for the
 * closed tab's session, so closing a tab stops its claude process instead of
 * leaving it alive until app exit. It acts only on a real `close`:
 *   - `forceClose` (pop-out transfer) and `reset` (`/clear`) never end a
 *     session, and a workspace switch never emits `closedTab` at all.
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

  constructor() {
    // A close recorded before this service existed belongs to another
    // lifetime; skip that exact event (by identity) on the first run.
    const preexisting = untracked(() => this.tabManager.closedTab());

    // Known limitation: `closedTab` is a single-value signal, so two closes in
    // the same tick coalesce and only the last reaches this effect. Every
    // current caller awaits one close per tick (recorded follow-up).
    effect(() => {
      const closed = this.tabManager.closedTab();
      if (!closed || closed === preexisting) return;
      untracked(() => this.endSessionIfOrphaned(closed));
    });
  }

  private endSessionIfOrphaned(closed: ClosedTabEvent): void {
    if (closed.kind !== 'close') return;
    if (closed.streamAbortDispatched === true) return;
    const sessionId = closed.sessionId;
    if (typeof sessionId !== 'string' || sessionId.length === 0) return;
    if (this.isStillDisplayed(sessionId)) return;

    const params = { sessionId: sessionId as SessionId };
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
   * closed tab is already removed when this runs (`closeTab` emits, then
   * removes, and effects flush afterwards). The surface check reads the
   * conversation registry, which StreamRouter keeps while any surface remains
   * bound, so it does not depend on effect order between the two consumers.
   */
  private isStillDisplayed(sessionId: string): boolean {
    if (this.tabManager.findTabBySessionId(sessionId) !== null) return true;
    const record = this.conversations.findContainingSession(
      sessionId as SessionId,
    );
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
