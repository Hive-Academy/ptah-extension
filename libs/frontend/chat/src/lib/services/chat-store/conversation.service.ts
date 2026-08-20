/**
 * ConversationService - Queue and Abort Logic
 *
 * Extracted from ChatStore to handle conversation-related operations:
 * - Queueing/appending content while a turn is streaming
 * - Aborting the current message (with optional sub-agent confirmation)
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 */

import { Injectable, inject, signal, Injector } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import { SessionId } from '@ptah-extension/shared';
import type { SendMessageOptions } from '@ptah-extension/chat-types';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import {
  MessageFinalizationService,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { MessageValidationService } from '../message-validation.service';
import { SessionLoaderService } from './session-loader.service';

@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionLoader = inject(SessionLoaderService);
  private readonly messageFinalization = inject(MessageFinalizationService);
  private readonly validator = inject(MessageValidationService);
  private readonly injector = inject(Injector); // For lazy injection to avoid circular dependency
  private readonly _isStopping = signal(false);
  readonly isStopping = this._isStopping.asReadonly();
  private readonly _isAutoSending = signal(false);
  readonly isAutoSending = this._isAutoSending.asReadonly();
  private readonly _queueRestoreSignal = signal<{
    tabId: string;
    content: string;
  } | null>(null);
  readonly queueRestoreSignal = this._queueRestoreSignal.asReadonly();

  /**
   * Clear the queue restore signal after content has been consumed by ChatInputComponent.
   * Must be called after restoration to prevent the effect from re-firing
   * on every activeTab() change.
   */
  clearQueueRestoreSignal(): void {
    this._queueRestoreSignal.set(null);
  }

  /**
   * Get current session ID from active tab
   */
  private currentSessionId(): SessionId | null {
    return this.tabManager.activeTab()?.claudeSessionId ?? null;
  }

  /**
   * Queue or append message content to active tab
   * If content already queued, append with newline separator.
   * Options (files, images, effort) are stored only for the first queued message;
   * subsequent appends are text-only.
   */
  public queueOrAppendMessage(
    content: string,
    options?: SendMessageOptions,
  ): void {
    const targetTabId = options?.tabId ?? this.tabManager.activeTabId();
    if (!targetTabId) return;
    const validation = this.validator.validate(content);
    if (!validation.valid) {
      console.warn(
        `[ConversationService] Invalid queue content: ${validation.reason}`,
      );
      return;
    }
    const sanitized = this.validator.sanitize(content);

    const targetTab = this.tabManager.tabs().find((t) => t.id === targetTabId);
    const existingQueue = targetTab?.queuedContent?.trim() ?? '';

    if (existingQueue) {
      this.tabManager.setQueuedContent(
        targetTabId,
        `${existingQueue}\n${sanitized}`,
      );
    } else if (options) {
      this.tabManager.setQueuedContentAndOptions(
        targetTabId,
        sanitized,
        options,
      );
    } else {
      this.tabManager.setQueuedContent(targetTabId, sanitized);
    }
  }

  /**
   * Clear queued content and options for a specific tab or the active tab.
   * @param tabId - Optional tab ID. Falls back to active tab if not provided.
   */
  public clearQueuedContent(tabId?: string): void {
    const targetTabId = tabId ?? this.tabManager.activeTabId();
    if (!targetTabId) return;

    this.tabManager.resetQueuedContentAndOptions(targetTabId);
  }

  /**
   * Finalize current message (reset state)
   * @param tabId - Optional tab ID to finalize. Falls back to active tab if not provided.
   */
  private finalizeCurrentMessage(tabId?: string): void {
    const targetTabId = tabId ?? this.tabManager.activeTabId();
    if (!targetTabId) return;

    const targetTab = this.tabManager.tabs().find((t) => t.id === targetTabId);
    if (!targetTab) return;
    if (targetTab.status === 'streaming' || targetTab.status === 'resuming') {
      this.tabManager.applyStatusErrorReset(targetTabId);
    }
  }

  /**
   * Abort current message
   * Handles queued content restoration and calls backend to stop Claude CLI process
   *
   * IMPORTANT: On abort, we finalize any partial streaming content so it's not lost.
   * Uses lazy injection of StreamingHandlerService to avoid circular dependency.
   */
  async abortCurrentMessage(): Promise<void> {
    try {
      if (this._isStopping()) {
        return;
      }
      this._isStopping.set(true);

      if (!this.claudeRpcService) {
        console.warn('[ConversationService] RPC service not initialized');
        this._isStopping.set(false);
        return;
      }

      const sessionId = this.currentSessionId();
      console.log('[ConversationService] Attempting to abort session:', {
        sessionId,
        activeTabId: this.tabManager.activeTabId(),
        claudeSessionId: this.tabManager.activeTab()?.claudeSessionId,
      });
      if (!sessionId) {
        console.warn('[ConversationService] No active session to abort');
        this._isStopping.set(false);
        return;
      }
      const activeTab = this.tabManager.activeTab();
      const queuedContent = activeTab?.queuedContent;

      if (activeTab) {
        this.tabManager.setLastTerminalReason(
          activeTab.id,
          'aborted_streaming',
        );
      }

      if (queuedContent && queuedContent.trim()) {
        this._queueRestoreSignal.set({
          tabId: activeTab.id,
          content: queuedContent,
        });
        this.clearQueuedContent();
      }
      console.log(
        '[ConversationService] Calling chat:abort RPC for session:',
        sessionId,
      );
      const result = await this.claudeRpcService.call('chat:abort', {
        sessionId,
      });

      if (result.success) {
        console.log(
          '[ConversationService] chat:abort succeeded for session:',
          sessionId,
        );
      } else {
        console.error(
          '[ConversationService] Failed to abort chat:',
          result.error,
        );
      }
      const activeTabId = this.tabManager.activeTabId();
      const tab = activeTabId
        ? this.tabManager.tabs().find((t) => t.id === activeTabId)
        : null;

      if (tab?.streamingState) {
        const streamingHandler = this.injector.get(StreamingHandlerService);
        streamingHandler.finalizeCurrentMessage(activeTabId ?? undefined, true);
      } else {
        this.finalizeCurrentMessage();
      }
      const resumableSubagents = result.data?.resumableSubagents;
      if (resumableSubagents && resumableSubagents.length > 0) {
        console.log(
          '[ConversationService] chat:abort returned resumable subagents:',
          resumableSubagents.length,
        );
        this.sessionLoader.setResumableSubagents(
          [...resumableSubagents],
          sessionId,
        );
        if (activeTabId) {
          this.messageFinalization.markAgentsAsInterruptedByToolCallIds(
            activeTabId,
            new Set(resumableSubagents.map((r) => r.toolCallId)),
          );
        }
      }
      if (activeTabId) {
        this.tabManager.markTabIdle(activeTabId);
      }
    } catch (error) {
      console.error('[ConversationService] Failed to abort message:', error);
    } finally {
      this._isStopping.set(false);
    }
  }

  /**
   * Abort with confirmation dialog when sub-agents are running
   *
   * Shows a warning dialog if sub-agents are actively running, giving the
   * user a chance to cancel the abort. If no agents are running or no
   * session exists, aborts immediately without confirmation.
   *
   * @returns true if aborted, false if user cancelled
   */
  async abortWithConfirmation(): Promise<boolean> {
    if (this._isStopping()) {
      return false;
    }

    try {
      const activeTab = this.tabManager.activeTab();
      const sessionId = activeTab?.claudeSessionId;

      if (!sessionId) {
        console.log(
          '[ConversationService] abortWithConfirmation: no session, aborting immediately',
        );
        await this.abortCurrentMessage();
        return true;
      }
      let agentCount = 0;
      let agentTypes = '';

      try {
        const result = await this.claudeRpcService.call('chat:running-agents', {
          sessionId,
        });
        const agents = result.data?.agents ?? [];
        agentCount = agents.length;
        agentTypes = agents.map((a) => a.agentType).join(', ');
      } catch (rpcError) {
        console.warn(
          '[ConversationService] abortWithConfirmation: RPC failed, falling back to immediate abort',
          rpcError,
        );
        await this.abortCurrentMessage();
        return true;
      }

      if (agentCount === 0) {
        console.log(
          '[ConversationService] abortWithConfirmation: no running agents, aborting immediately',
        );
        await this.abortCurrentMessage();
        return true;
      }
      console.log(
        '[ConversationService] abortWithConfirmation: showing confirmation for',
        agentCount,
        'running agents',
      );

      const confirmationDialog = this.injector.get(ConfirmationDialogService);
      const confirmed = await confirmationDialog.confirm({
        title: 'Stop Running Agents?',
        message: `${agentCount} agent(s) are still running (${agentTypes}). Stopping will interrupt their current work and any in-progress tool calls will be lost.`,
        confirmLabel: 'Stop All',
        cancelLabel: 'Keep Running',
        confirmStyle: 'warning',
      });

      if (confirmed) {
        console.log(
          '[ConversationService] abortWithConfirmation: user confirmed, aborting',
        );
        await this.abortCurrentMessage();
        return true;
      }

      console.log(
        '[ConversationService] abortWithConfirmation: user cancelled, keeping agents running',
      );
      return false;
    } catch (error) {
      console.error(
        '[ConversationService] abortWithConfirmation failed, falling back to immediate abort:',
        error,
      );
      await this.abortCurrentMessage();
      return true;
    }
  }
}
