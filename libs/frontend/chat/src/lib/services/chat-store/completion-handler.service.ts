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

    // Fan out to all tabs bound to this session.
    // Canvas grid: when both tiles share a session, both must reset on error
    // or one tile remains stuck in `streaming` status forever.
    let targetTabs: readonly TabState[] = [];

    if (data.sessionId) {
      targetTabs = this.tabManager.findTabsBySessionId(
        SessionId.from(data.sessionId),
      );
    }

    // Fall back to active tab if no matching tab found
    if (targetTabs.length === 0) {
      const activeTab = this.tabManager.activeTab();

      // Warn if session ID doesn't match active tab
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

    // Reset streaming state for every bound tab.
    for (const tab of targetTabs) {
      this.tabManager.applyStatusErrorReset(tab.id);
      // Hide streaming indicator (visual only - no side effects)
      this.tabManager.markTabIdle(tab.id);
    }

    // Session status is global to the SDK session — set once.
    this.sessionManager.setStatus('loaded');

    console.log(
      '[CompletionHandlerService] Chat state reset due to error for tabs',
      targetTabs.map((t) => t.id),
    );
  }
}
