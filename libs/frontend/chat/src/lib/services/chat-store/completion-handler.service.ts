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
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 */

import { Injectable, inject } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SessionManager } from '@ptah-extension/chat-streaming';
import { TabState } from '@ptah-extension/chat-types';
import { SessionId } from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class CompletionHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);

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
