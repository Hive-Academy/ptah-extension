/**
 * CompletionHandlerService - Chat Completion and Error Handling
 *
 * This service is largely deprecated.
 *
 * The chat:complete event is NO LONGER used to control streaming state because
 * it fires multiple times during tool execution (once per message_complete).
 *
 * Streaming finalization is now handled by StreamingHandlerService.handleSessionStats(),
 * which receives the authoritative SESSION_STATS event derived from SDK's type=result message.
 *
 * This service now only handles error events.
 *
 * NOT CURRENTLY REACHABLE (verified TASK_2026_382): nothing injects this class.
 * The live CHAT_ERROR path is `ChatLifecycleService.handleChatError`, wired
 * through `chat-message-handler.service.ts`. This file survives only because
 * deleting it means editing the `chat-store/index.ts` barrel. Its
 * finalize-before-reset ordering below is therefore a CORRECTNESS GUARD on a
 * path that may be revived — it is not what fixes the reported defect, and it
 * never ran for the user who reported it. If this service is ever re-wired,
 * that ordering is the reason a revived error path cannot strand a tree.
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 */

import { Injectable, inject } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  MessageFinalizationService,
  SessionManager,
} from '@ptah-extension/chat-streaming';
import { TabState } from '@ptah-extension/chat-types';
import { SessionId } from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class CompletionHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly finalization = inject(MessageFinalizationService);

  /**
   * Handle chat error signal from backend
   * Called when an error occurs during chat (CLI error, network error, etc.)
   * Routes to correct tab by sessionId for proper multi-tab support.
   * Resets streaming state and optionally displays error.
   */
  handleChatError(data: { sessionId: string; error: string }): void {
    console.error('[CompletionHandlerService] Chat error:', data);
    let targetTabs: readonly TabState[] = [];

    if (data.sessionId) {
      targetTabs = this.tabManager.findTabsBySessionId(
        SessionId.from(data.sessionId),
      );
    }
    if (targetTabs.length === 0) {
      const activeTab = this.tabManager.activeTab();
      if (
        data.sessionId &&
        activeTab?.claudeSessionId &&
        activeTab.claudeSessionId !== data.sessionId
      ) {
        console.warn('[CompletionHandlerService] Error for unknown session', {
          sessionId: data.sessionId,
          activeTabSessionId: activeTab.claudeSessionId,
        });
        return;
      }

      if (!activeTab) {
        console.warn('[CompletionHandlerService] No target tab for chat error');
        return;
      }

      targetTabs = [activeTab];
    }
    for (const tab of targetTabs) {
      // Settle the tree BEFORE claiming the tab is idle. `applyStatusErrorReset`
      // writes `status: 'loaded'` but does not touch `streamingState`, so on its
      // own it leaves a tab whose transcript still renders a live streaming
      // bubble while every "is the tab busy" reader says no (TASK_2026_382 R1).
      //
      // Finalize rather than discard: the text the agent already produced is
      // the user's content, and dropping `streamingState` would delete it. This
      // promotes it into `messages` with its nodes marked `interrupted`, which
      // also clears `streamingState` through `applyFinalizedTurn` /
      // `clearStreamingForLoaded` — so nothing is stranded and nothing is lost.
      //
      // Idempotent by construction: the ordered `idle` / `failed` `turn_state`
      // the broadcaster pushes into the chunk batch BEFORE CHAT_ERROR
      // (`chat-stream-broadcaster.service.ts:317-325`) normally finalizes first,
      // and `finalizeCurrentMessage` early-returns once `streamingState` is
      // null. This is the fallback for the case where that event was dropped or
      // rejected as stale, not a second finalizer competing with it.
      this.finalization.finalizeCurrentMessage(tab.id, true);
      this.tabManager.applyStatusErrorReset(tab.id);
      this.tabManager.markTabIdle(tab.id);
    }
    this.sessionManager.setStatus('loaded');

    console.log(
      '[CompletionHandlerService] Chat state reset due to error for tabs',
      targetTabs.map((t) => t.id),
    );
  }
}
