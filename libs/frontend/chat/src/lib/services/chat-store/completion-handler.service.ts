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
import { MessageSenderService } from '../message-sender.service';
import { TabState } from '../chat.types';

@Injectable({ providedIn: 'root' })
export class CompletionHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly streamingHandler = inject(StreamingHandlerService);
  private readonly messageSender = inject(MessageSenderService);

  // Guard signal for preventing recursive auto-send
  private readonly _isAutoSending = signal(false);
  readonly isAutoSending = this._isAutoSending.asReadonly();

  // ============================================================================
  // CALLBACK PATTERN REMOVED (TASK_2025_054 Batch 3)
  // ============================================================================

  // NOTE: ALL callback methods REMOVED
  // MessageSenderService now provides direct message sending without callbacks
  // This eliminates the callback indirection for auto-send

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
      // TASK_2025_093 FIX: DO NOT call finalizeCurrentMessage here!
      // chat:complete should ONLY update UI status, not mutate the event pipeline.
      //
      // Problem: tool_result events arrive AFTER message_complete, so calling
      // finalizeCurrentMessage here sets streamingState: null too early.
      // Subsequent tool_result events create a new streamingState that is never
      // finalized, causing tools to remain stuck in streaming state.
      //
      // Solution: Let streaming state persist. Events continue to accumulate.
      // Finalization happens lazily when user sends next message or session changes.

      // Ensure tab status is reset to loaded (UI allows input)
      this.tabManager.updateTab(targetTabId, { status: 'loaded' });
      this.sessionManager.setStatus('loaded');

      console.log(
        '[CompletionHandlerService] Chat status reset to loaded (streaming state preserved) for tab',
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
   * Uses MessageSenderService directly (TASK_2025_054 Batch 3 - eliminates callback indirection)
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

    console.log('[CompletionHandlerService] Auto-sending queued content', {
      tabId,
      length: queuedContent.length,
    });

    // Set auto-sending flag
    this._isAutoSending.set(true);

    // Auto-send via MessageSenderService (direct call, no callback)
    this.messageSender
      .send(queuedContent)
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
