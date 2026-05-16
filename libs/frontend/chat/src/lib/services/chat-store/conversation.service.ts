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
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { MessageValidationService } from '../message-validation.service';

@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly validator = inject(MessageValidationService);
  private readonly ptahCliState = inject(PtahCliStateService);
  private readonly injector = inject(Injector); // For lazy injection to avoid circular dependency

  // ============================================================================
  // STATE SIGNALS
  // ============================================================================

  // Guard signal for stopping flag (prevents multiple simultaneous abort calls)
  private readonly _isStopping = signal(false);
  readonly isStopping = this._isStopping.asReadonly();

  // Guard signal for auto-send prevention
  private readonly _isAutoSending = signal(false);
  readonly isAutoSending = this._isAutoSending.asReadonly();

  // Queue restore signal for restoring queued content after abort
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

  // ============================================================================
  // CALLBACK PATTERN REMOVED (TASK_2025_054 Batch 3)
  // ============================================================================

  // NOTE: setSendMessageCallback() and _sendMessageCallback REMOVED
  // MessageSenderService now handles message sending directly without callbacks
  // This eliminates the 3-level callback indirection

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

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

    // Poll claudeRpcService and vscodeService availability with short intervals
    while (!this.claudeRpcService || !this.vscodeService) {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        return false;
      }

      // Wait 50ms before next check
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
    // Has existing session if tab has a real Claude session ID and is in 'loaded' state
    // OR if SessionManager confirms the session is in 'confirmed' state
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
    // Use explicit tabId from options (canvas tile isolation) or fall back to active tab
    const targetTabId = options?.tabId ?? this.tabManager.activeTabId();
    if (!targetTabId) return;

    // Validate content using centralized validation service
    const validation = this.validator.validate(content);
    if (!validation.valid) {
      console.warn(
        `[ConversationService] Invalid queue content: ${validation.reason}`,
      );
      return;
    }

    // Sanitize content (trim whitespace)
    const sanitized = this.validator.sanitize(content);

    const targetTab = this.tabManager.tabs().find((t) => t.id === targetTabId);
    const existingQueue = targetTab?.queuedContent?.trim() ?? '';

    if (existingQueue) {
      // Append with newline separator (options from first message preserved)
      this.tabManager.setQueuedContent(
        targetTabId,
        `${existingQueue}\n${sanitized}`,
      );
    } else if (options) {
      // First content in queue - also store options atomically
      this.tabManager.setQueuedContentAndOptions(
        targetTabId,
        sanitized,
        options,
      );
    } else {
      // First content in queue without options
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
    // Use provided tabId or fall back to active tab
    const targetTabId = tabId ?? this.tabManager.activeTabId();
    if (!targetTabId) return;

    const targetTab = this.tabManager.tabs().find((t) => t.id === targetTabId);
    if (!targetTab) return;

    // Only finalize if tab is still in streaming/resuming state
    if (targetTab.status === 'streaming' || targetTab.status === 'resuming') {
      this.tabManager.applyStatusErrorReset(targetTabId);
    }
  }

  // ============================================================================
  // PUBLIC API (extracted from ChatStore)
  // ============================================================================

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
      // Queue the message instead of sending
      this.queueOrAppendMessage(content);
    } else {
      // Normal send flow
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
      // Wait for services to be ready (with timeout)
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

      // Get or create active tab - tabId is used for event routing
      let activeTabId = this.tabManager.activeTabId();
      if (!activeTabId) {
        activeTabId = this.tabManager.createTab();
        this.tabManager.switchTab(activeTabId);
      }

      // Clear previous node maps to prevent stale references
      this.sessionManager.clearNodeMaps();

      // Update tab with draft status (claudeSessionId stays null until SDK responds)
      // TASK_2025_192: Auto-name session from first message content (not "New Chat")
      // Only auto-name if user hasn't already set a custom name (preserve user renames)
      const currentTab = this.tabManager.activeTab();
      const currentName = currentTab?.name;
      const hasUserName = currentName && currentName !== 'New Chat';
      const autoName = hasUserName
        ? currentName
        : content.substring(0, 50).trim() || 'New Chat';
      // Explicitly nulls claudeSessionId â€” will be set when real UUID arrives.
      this.tabManager.applyNewConversationDraft(activeTabId, autoName);

      // Update SessionManager state - no sessionId yet, just status
      this.sessionManager.setStatus('draft');

      // Add user message immediately (sessionId omitted until resolved by SDK)
      const userMessage = createExecutionChatMessage({
        id: this.generateMessageId(),
        role: 'user',
        rawContent: content,
        files,
        // sessionId omitted: real Claude UUID arrives via SESSION_ID_RESOLVED
      });

      // Update tab with user message
      const activeTab = this.tabManager.activeTab();
      this.tabManager.appendUserMessageForNewTurn(activeTabId, [
        ...(activeTab?.messages ?? []),
        userMessage,
      ]);

      // Call RPC to start NEW chat - using tabId for correlation
      // TASK_2025_170: Pass ptahCliId if a Ptah CLI agent is selected
      const ptahCliId = this.ptahCliState.selectedAgentId() ?? undefined;
      const result = await this.claudeRpcService.call('chat:start', {
        prompt: content,
        tabId: activeTabId, // Frontend correlation ID
        name: autoName, // TASK_2025_192: Send message-derived name to backend
        workspacePath,
        ptahCliId, // TASK_2025_170: Route to Ptah CLI agent adapter
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
        // Set status to 'streaming' after successful chat:start
        // Real sessionId will arrive with first streaming event
        this.tabManager.markStreaming(activeTabId);
        this.sessionManager.setStatus('streaming');

        // Note: Sessions list refresh moved to handleSessionIdResolved() in ChatStore
        // At this point metadata doesn't exist yet, so loadSessions() would miss this session
      }
    } catch (error) {
      console.error(
        '[ConversationService] Failed to start new conversation:',
        error,
      );

      // Update tab status to loaded (error)
      const activeTabId = this.tabManager.activeTabId();
      if (activeTabId) {
        this.tabManager.markLoaded(activeTabId);
      }

      // Rethrow error to preserve error propagation
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
      // Wait for services to be ready (with timeout)
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

      // Use explicit tab if provided (queued message), otherwise fall back to active tab
      const targetTabId = explicitTabId ?? this.tabManager.activeTabId();
      const targetTab = explicitTabId
        ? this.tabManager.tabs().find((t) => t.id === explicitTabId)
        : this.tabManager.activeTab();

      // Get REAL Claude session ID from the TARGET TAB (not global SessionManager)
      // This is critical for multi-tab support - each tab has its own session
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

      // Update SessionManager state
      this.sessionManager.setStatus('resuming');

      // Update tab status
      this.tabManager.markResuming(targetTabId);

      // TASK_2025_093 FIX: Finalize any existing streaming state before starting new turn.
      // This converts the streaming content into a proper message in tab.messages.
      // Without this, the streaming message would persist alongside new messages.
      if (targetTab?.streamingState) {
        const streamingHandler = this.injector.get(StreamingHandlerService);
        streamingHandler.finalizeCurrentMessage(targetTabId);
        // Re-fetch the tab after finalization to get updated messages
        // Note: The tab's messages array now includes the finalized assistant message
      }

      // Re-fetch tab after potential finalization to get updated messages
      const currentTab = this.tabManager
        .tabs()
        .find((t) => t.id === targetTabId);

      // Add user message immediately
      const userMessage = createExecutionChatMessage({
        id: this.generateMessageId(),
        role: 'user',
        rawContent: content,
        files,
        sessionId,
      });

      // Update tab with user message (use currentTab to include finalized messages)
      this.tabManager.setMessages(targetTabId, [
        ...(currentTab?.messages ?? []),
        userMessage,
      ]);

      // Call RPC to CONTINUE existing chat (uses --resume flag)
      // Both sessionId (for SDK) and tabId (for event routing) are required
      // Pass sessionModel so resumed sessions use the original model (not current config)
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
      // Prevent multiple simultaneous abort calls
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

      // ========== HANDLE QUEUED CONTENT BEFORE ABORT ==========
      const activeTab = this.tabManager.activeTab();
      const queuedContent = activeTab?.queuedContent;

      if (queuedContent && queuedContent.trim()) {
        // Include tab ID in restoration signal for validation
        this._queueRestoreSignal.set({
          tabId: activeTab.id,
          content: queuedContent,
        });

        // Clear queue (will be moved to input by ChatInputComponent)
        this.clearQueuedContent();
      }
      // ========== END QUEUE HANDLING ==========

      // Call RPC to abort
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

      // ========== PRESERVE PARTIAL MESSAGE ON ABORT ==========
      // Lazy inject StreamingHandlerService to avoid circular dependency
      // This finalizes any partial streaming content into a persisted message
      const activeTabId = this.tabManager.activeTabId();
      const tab = activeTabId
        ? this.tabManager.tabs().find((t) => t.id === activeTabId)
        : null;

      if (tab?.streamingState) {
        const streamingHandler = this.injector.get(StreamingHandlerService);
        // TASK_2025_098 FIX: Pass isAborted=true to mark nodes as interrupted
        streamingHandler.finalizeCurrentMessage(activeTabId ?? undefined, true);
      } else {
        // No streaming state, just update status
        this.finalizeCurrentMessage();
      }

      // TASK_2025_098 FIX: Clear visual streaming indicator
      // Previously, markTabIdle was only called in completion-handler (chat:complete).
      // On abort, the streaming indicator remained because this was never called.
      if (activeTabId) {
        this.tabManager.markTabIdle(activeTabId);
      }
      // ========== END PRESERVE MESSAGE ==========
    } catch (error) {
      console.error('[ConversationService] Failed to abort message:', error);
    } finally {
      // Always reset stopping flag
      this._isStopping.set(false);
    }
  }

  /**
   * Abort with confirmation dialog when sub-agents are running
   *
   * TASK_2025_185: Shows a warning dialog if sub-agents are actively running,
   * giving the user a chance to cancel the abort. If no agents are running
   * or no session exists, aborts immediately without confirmation.
   *
   * @returns true if aborted, false if user cancelled
   */
  async abortWithConfirmation(): Promise<boolean> {
    // TASK_2025_185: Prevent concurrent invocations (same guard as abortCurrentMessage)
    if (this._isStopping()) {
      return false;
    }

    try {
      // Get session ID from active tab (same pattern as continueConversation)
      const activeTab = this.tabManager.activeTab();
      const sessionId = activeTab?.claudeSessionId;

      if (!sessionId) {
        // No session â€” abort immediately without confirmation
        console.log(
          '[ConversationService] abortWithConfirmation: no session, aborting immediately',
        );
        await this.abortCurrentMessage();
        return true;
      }

      // Check for running agents via RPC
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
        // RPC failed â€” fail-safe: abort immediately without confirmation
        console.warn(
          '[ConversationService] abortWithConfirmation: RPC failed, falling back to immediate abort',
          rpcError,
        );
        await this.abortCurrentMessage();
        return true;
      }

      if (agentCount === 0) {
        // No running agents â€” abort immediately
        console.log(
          '[ConversationService] abortWithConfirmation: no running agents, aborting immediately',
        );
        await this.abortCurrentMessage();
        return true;
      }

      // Agents are running â€” show confirmation dialog
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
      // Unexpected error â€” fail-safe: abort immediately
      console.error(
        '[ConversationService] abortWithConfirmation failed, falling back to immediate abort:',
        error,
      );
      await this.abortCurrentMessage();
      return true;
    }
  }
}
