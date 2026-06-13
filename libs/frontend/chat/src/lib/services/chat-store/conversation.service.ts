/**
 * ConversationService - New Conversation and Send Logic
 *
 * Extracted from ChatStore to handle conversation-related operations:
 * - Starting new conversations
 * - Continuing existing conversations
 * - Handling queue vs send logic
 * - Aborting current message
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 */

import { Injectable, inject, signal, Injector } from '@angular/core';
import {
  ClaudeRpcService,
  VSCodeService,
  PtahCliStateService,
} from '@ptah-extension/core';
import { createExecutionChatMessage, SessionId } from '@ptah-extension/shared';
import type { SendMessageOptions } from '@ptah-extension/chat-types';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import {
  MessageFinalizationService,
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { MessageValidationService } from '../message-validation.service';
import { SessionLoaderService } from './session-loader.service';

@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly sessionLoader = inject(SessionLoaderService);
  private readonly messageFinalization = inject(MessageFinalizationService);
  private readonly validator = inject(MessageValidationService);
  private readonly ptahCliState = inject(PtahCliStateService);
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
   * Generate unique ID for messages
   * NOTE: No longer used for session IDs - SDK provides real UUIDs
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Wait for services to be ready with timeout
   * @param timeoutMs - Timeout in milliseconds (default: 5000)
   * @returns Promise<boolean> - true if ready, false if timeout
   */
  private async waitForServices(timeoutMs = 5000): Promise<boolean> {
    const startTime = Date.now();
    while (!this.claudeRpcService || !this.vscodeService) {
      if (Date.now() - startTime > timeoutMs) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return true;
  }

  /**
   * Get current session ID from active tab
   */
  private currentSessionId(): SessionId | null {
    return this.tabManager.activeTab()?.claudeSessionId ?? null;
  }

  /**
   * Check if there's an existing session in active tab
   * Uses new state machine API to check if session is confirmed
   */
  private hasExistingSession(): boolean {
    const tab = this.tabManager.activeTab();
    return !!(
      (tab?.claudeSessionId && tab.status === 'loaded') ||
      this.sessionManager.isSessionConfirmed()
    );
  }

  /**
   * Check if currently streaming
   */
  private isStreaming(): boolean {
    const tab = this.tabManager.activeTab();
    return tab?.status === 'streaming' || tab?.status === 'resuming';
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
   * Send message - routes to continue or start new conversation
   * @param content - Message content
   * @param files - Optional file paths to include
   */
  async sendMessage(content: string, files?: string[]): Promise<void> {
    if (this.hasExistingSession()) {
      return this.continueConversation(content, files);
    } else {
      return this.startNewConversation(content, files);
    }
  }

  /**
   * Smart send or queue routing (Single Responsibility - service handles the logic)
   * Automatically queues if streaming, sends normally if not
   * @param content - Message content
   * @param filePaths - Optional file paths to include
   */
  async sendOrQueueMessage(
    content: string,
    filePaths?: string[],
  ): Promise<void> {
    if (this.isStreaming()) {
      this.queueOrAppendMessage(content);
    } else {
      await this.sendMessage(content, filePaths);
    }
  }

  /**
   * Start a brand new conversation with Claude
   * Uses tabId for frontend correlation - real sessionId comes from SDK
   *
   * Flow:
   * 1. Frontend sends chat:start with tabId (no placeholder sessionId)
   * 2. Backend starts SDK, SDK generates real UUID
   * 3. Backend tags ALL events with tabId + real sessionId
   * 4. Frontend receives first event, stores real sessionId on tab
   */
  async startNewConversation(content: string, files?: string[]): Promise<void> {
    try {
      const ready = await this.waitForServices(5000);
      if (!ready) {
        console.error(
          '[ConversationService] startNewConversation: Services initialization timeout',
        );
        return;
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[ConversationService] Services not available after initialization',
        );
        return;
      }

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[ConversationService] No workspace path available');
        return;
      }
      let activeTabId = this.tabManager.activeTabId();
      if (!activeTabId) {
        activeTabId = this.tabManager.createTab();
        this.tabManager.switchTab(activeTabId);
      }
      this.sessionManager.clearNodeMaps();
      const currentTab = this.tabManager.activeTab();
      const currentName = currentTab?.name;
      const hasUserName = currentName && currentName !== 'New Chat';
      const autoName = hasUserName
        ? currentName
        : content.substring(0, 50).trim() || 'New Chat';
      this.tabManager.applyNewConversationDraft(activeTabId, autoName);
      this.sessionManager.setStatus('draft');
      const userMessage = createExecutionChatMessage({
        id: this.generateMessageId(),
        role: 'user',
        rawContent: content,
        files,
      });
      const activeTab = this.tabManager.activeTab();
      this.tabManager.appendUserMessageForNewTurn(activeTabId, [
        ...(activeTab?.messages ?? []),
        userMessage,
      ]);
      const ptahCliId = this.ptahCliState.selectedAgentId() ?? undefined;
      const result = await this.claudeRpcService.call('chat:start', {
        prompt: content,
        tabId: activeTabId, // Frontend correlation ID
        name: autoName, // Send message-derived name to backend
        workspacePath,
        ptahCliId, // Route to Ptah CLI agent adapter
        options: files ? { files } : undefined,
      });

      if (!result.success) {
        console.error(
          '[ConversationService] Failed to start chat:',
          result.error,
        );
        const errorMessage = createExecutionChatMessage({
          id: this.generateMessageId(),
          role: 'assistant',
          rawContent: result.error || 'Failed to start chat session.',
        });
        const currentTab = this.tabManager.activeTab();
        this.tabManager.setMessagesAndMarkLoaded(activeTabId, [
          ...(currentTab?.messages ?? []),
          errorMessage,
        ]);
      } else {
        this.tabManager.markStreaming(activeTabId);
        this.sessionManager.setStatus('streaming');
      }
    } catch (error) {
      console.error(
        '[ConversationService] Failed to start new conversation:',
        error,
      );
      const activeTabId = this.tabManager.activeTabId();
      if (activeTabId) {
        this.tabManager.markLoaded(activeTabId);
      }
      throw error;
    }
  }

  /**
   * Continue an existing conversation with Claude
   * Uses the real session ID (SDK UUID) for resume, tabId for event routing
   *
   * @param content - Message content to send
   * @param files - Optional file paths to include
   * @param explicitTabId - Optional tab ID to target. When provided (e.g., from sendQueuedMessage),
   *   uses this tab instead of activeTab. Prevents user message being added to the wrong tab
   *   if the user switched tabs before the queued message fires.
   */
  async continueConversation(
    content: string,
    files?: string[],
    explicitTabId?: string,
  ): Promise<void> {
    try {
      const ready = await this.waitForServices(5000);
      if (!ready) {
        console.error(
          '[ConversationService] continueConversation: Services initialization timeout',
        );
        return;
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[ConversationService] Services not available after initialization',
        );
        return;
      }

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[ConversationService] No workspace path available');
        return;
      }
      const targetTabId = explicitTabId ?? this.tabManager.activeTabId();
      const targetTab = explicitTabId
        ? this.tabManager.tabs().find((t) => t.id === explicitTabId)
        : this.tabManager.activeTab();
      const sessionId = targetTab?.claudeSessionId;
      if (!sessionId) {
        console.warn(
          '[ConversationService] No Claude session ID on target tab - starting new conversation',
        );
        return this.startNewConversation(content, files);
      }

      if (!targetTabId) {
        console.warn(
          '[ConversationService] No target tab for continuing conversation',
        );
        return this.startNewConversation(content, files);
      }
      this.sessionManager.setStatus('resuming');
      this.tabManager.markResuming(targetTabId);
      if (targetTab?.streamingState) {
        const streamingHandler = this.injector.get(StreamingHandlerService);
        streamingHandler.finalizeCurrentMessage(targetTabId);
      }
      const currentTab = this.tabManager
        .tabs()
        .find((t) => t.id === targetTabId);
      const userMessage = createExecutionChatMessage({
        id: this.generateMessageId(),
        role: 'user',
        rawContent: content,
        files,
        sessionId,
      });
      this.tabManager.setMessages(targetTabId, [
        ...(currentTab?.messages ?? []),
        userMessage,
      ]);
      const result = await this.claudeRpcService.call('chat:continue', {
        prompt: content,
        sessionId,
        tabId: targetTabId, // For event routing
        workspacePath,
        model: targetTab?.sessionModel ?? undefined,
      });

      if (!result.success) {
        console.error(
          '[ConversationService] Failed to continue chat:',
          result.error,
        );
        const errorMsg = createExecutionChatMessage({
          id: this.generateMessageId(),
          role: 'assistant',
          rawContent: result.error || 'Failed to continue chat session.',
        });
        const updatedTab = this.tabManager.activeTab();
        this.tabManager.setMessagesAndMarkLoaded(targetTabId, [
          ...(updatedTab?.messages ?? []),
          errorMsg,
        ]);
      } else {
        this.sessionManager.setStatus('streaming');
        this.tabManager.markStreaming(targetTabId);
      }
    } catch (error) {
      console.error(
        '[ConversationService] Failed to continue conversation:',
        error,
      );
      const fallbackTabId = explicitTabId ?? this.tabManager.activeTabId();
      if (fallbackTabId) {
        this.tabManager.markLoaded(fallbackTabId);
      }
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
