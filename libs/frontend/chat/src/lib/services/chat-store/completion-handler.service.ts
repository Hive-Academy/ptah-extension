/**
 * CompletionHandlerService - Chat Completion and Error Handling
 *
 * Extracted from ChatStore to handle chat session lifecycle events:
 * - Chat completion (success)
 * - Chat errors
 * - Auto-send of queued content
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 */

import { Injectable, inject, signal } from '@angular/core';
import { TabManagerService } from '../tab-manager.service';
import { SessionManager } from '../session-manager.service';
import { StreamingHandlerService } from './streaming-handler.service';
import { TabState } from '../chat.types';

@Injectable({ providedIn: 'root' })
export class CompletionHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly streamingHandler = inject(StreamingHandlerService);

  // Guard signal for preventing recursive auto-send
  private readonly _isAutoSending = signal(false);
  readonly isAutoSending = this._isAutoSending.asReadonly();

  // Callback for auto-send (set by ChatStore to avoid circular dependency)
  private _continueConversationCallback:
    | ((content: string) => Promise<void>)
    | null = null;

  /**
   * Set the continue conversation callback (called by ChatStore during init)
   */
  setContinueConversationCallback(
    callback: (content: string) => Promise<void>
  ): void {
    this._continueConversationCallback = callback;
  }

  /**
   * Handle chat completion signal from backend
   * Called when Claude CLI process exits (success or error)
   * Routes to correct tab by sessionId for proper multi-tab support.
   * Ensures UI state is reset to 'loaded' regardless of exit code.
   */
  handleChatComplete(data: { sessionId: string; code: number }): void {
    console.log('[CompletionHandlerService] Chat complete:', data);

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
        console.warn(
          '[CompletionHandlerService] Completion for unknown session',
          {
            sessionId: data.sessionId,
            activeTabSessionId: targetTab.claudeSessionId,
          }
        );
        return;
      }
    }

    if (!targetTabId || !targetTab) {
      console.warn(
        '[CompletionHandlerService] No target tab for chat completion'
      );
      return;
    }

    // Only reset if tab is still in streaming/resuming state
    if (
      targetTab.status === 'streaming' ||
      targetTab.status === 'resuming' ||
      targetTab.status === 'draft'
    ) {
      // Finalize any pending message
      this.streamingHandler.finalizeCurrentMessage(targetTabId);

      // Ensure tab status is reset to loaded
      this.tabManager.updateTab(targetTabId, { status: 'loaded' });
      this.sessionManager.setStatus('loaded');

      console.log(
        '[CompletionHandlerService] Chat state reset to loaded for tab',
        targetTabId,
        '(exit code:',
        data.code,
        ')'
      );

      // Auto-send queued content
      this.handleAutoSendQueue(targetTabId, targetTab);
    }
  }

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

    console.log(
      '[CompletionHandlerService] Chat state reset due to error for tab',
      targetTabId
    );
  }

  /**
   * Handle auto-send of queued content after chat completion
   */
  private handleAutoSendQueue(tabId: string, tab: TabState): void {
    // Guard against recursive auto-send
    if (this._isAutoSending()) {
      console.log(
        '[CompletionHandlerService] Auto-send already in progress, skipping'
      );
      return;
    }

    // Check if this tab has queued content
    const queuedContent = tab.queuedContent;
    if (!queuedContent || !queuedContent.trim()) {
      return;
    }

    if (!this._continueConversationCallback) {
      console.warn(
        '[CompletionHandlerService] No continueConversation callback set, cannot auto-send'
      );
      return;
    }

    console.log('[CompletionHandlerService] Auto-sending queued content', {
      tabId,
      length: queuedContent.length,
    });

    // Set auto-sending flag
    this._isAutoSending.set(true);

    // Auto-send via continueConversation (async, don't await)
    this._continueConversationCallback(queuedContent)
      .then(() => {
        // Clear queue only after successful send start
        this.tabManager.updateTab(tabId, { queuedContent: null });
        console.log(
          '[CompletionHandlerService] Auto-send started, queue cleared'
        );
      })
      .catch((error) => {
        console.error(
          '[CompletionHandlerService] Failed to auto-send queued content:',
          error
        );
        // Keep content in queue on error (no data loss)
      })
      .finally(() => {
        // Always reset auto-sending flag
        this._isAutoSending.set(false);
      });
  }
}
