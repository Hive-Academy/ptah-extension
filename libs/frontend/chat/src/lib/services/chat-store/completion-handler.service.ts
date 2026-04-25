/**
 * CompletionHandlerService - Chat Completion and Error Handling
 *
 * TASK_2025_101: This service is largely deprecated.
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
import { TabManagerService } from '../tab-manager.service';
import { SessionManager } from '../session-manager.service';
import { TabState } from '@ptah-extension/chat-types';

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

    // Find the target tab by session ID (proper multi-tab routing)
    let targetTab: TabState | null = null;
    let targetTabId: string | null = null;

    if (data.sessionId) {
      targetTab = this.tabManager.findTabBySessionId(data.sessionId);
      if (targetTab) {
        targetTabId = targetTab.id;
      }
    }

    // Fall back to active tab if no matching tab found
    if (!targetTab) {
      targetTabId = this.tabManager.activeTabId();
      targetTab = this.tabManager.activeTab();

      // Warn if session ID doesn't match active tab
      if (
        data.sessionId &&
        targetTab?.claudeSessionId &&
        targetTab.claudeSessionId !== data.sessionId
      ) {
        console.warn('[CompletionHandlerService] Error for unknown session', {
          sessionId: data.sessionId,
          activeTabSessionId: targetTab.claudeSessionId,
        });
        return;
      }
    }

    if (!targetTabId) {
      console.warn('[CompletionHandlerService] No target tab for chat error');
      return;
    }

    // Reset streaming state (including per-tab currentMessageId)
    this.tabManager.updateTab(targetTabId, {
      status: 'loaded',
      currentMessageId: null,
    });
    this.sessionManager.setStatus('loaded');

    // Hide streaming indicator (visual only - no side effects)
    this.tabManager.markTabIdle(targetTabId);

    console.log(
      '[CompletionHandlerService] Chat state reset due to error for tab',
      targetTabId,
    );
  }
}
