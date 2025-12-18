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

import { Injectable, inject, signal } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  ChatSessionSummary,
  createExecutionChatMessage,
  SessionId,
} from '@ptah-extension/shared';
import { TabManagerService } from '../tab-manager.service';
import { SessionManager } from '../session-manager.service';
import { SessionLoaderService } from './session-loader.service';

import { MessageValidationService } from '../message-validation.service';

@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly sessionLoader = inject(SessionLoaderService);
  private readonly validator = inject(MessageValidationService);

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
   * Generate unique ID for messages/sessions
   */
  private generateId(): string {
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
  private currentSessionId(): string | null {
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
   * If content already queued, append with newline separator
   */
  public queueOrAppendMessage(content: string): void {
    const activeTabId = this.tabManager.activeTabId();
    if (!activeTabId) return;

    // Validate content using centralized validation service
    const validation = this.validator.validate(content);
    if (!validation.valid) {
      console.warn(
        `[ConversationService] Invalid queue content: ${validation.reason}`
      );
      return;
    }

    // Sanitize content (trim whitespace)
    const sanitized = this.validator.sanitize(content);

    const activeTab = this.tabManager.activeTab();
    const existingQueue = activeTab?.queuedContent?.trim() ?? '';

    let newQueuedContent: string;

    if (existingQueue) {
      // Append with newline separator
      newQueuedContent = `${existingQueue}\n${sanitized}`;
      console.log('[ConversationService] Appending to queue', {
        existingLength: existingQueue.length,
        newLength: sanitized.length,
        totalLength: newQueuedContent.length,
      });
    } else {
      // First content in queue
      newQueuedContent = sanitized;
      console.log('[ConversationService] Creating new queue', {
        length: sanitized.length,
      });
    }

    this.tabManager.updateTab(activeTabId, { queuedContent: newQueuedContent });
  }

  /**
   * Clear queued content for active tab
   */
  public clearQueuedContent(): void {
    const activeTabId = this.tabManager.activeTabId();
    if (!activeTabId) return;

    this.tabManager.updateTab(activeTabId, { queuedContent: '' });
    console.log('[ConversationService] Cleared queued content');
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
      this.tabManager.updateTab(targetTabId, {
        status: 'loaded',
        currentMessageId: null,
      });
      console.log('[ConversationService] Finalized message', {
        tabId: targetTabId,
      });
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
    filePaths?: string[]
  ): Promise<void> {
    if (this.isStreaming()) {
      // Queue the message instead of sending
      this.queueOrAppendMessage(content);
      console.log('[ConversationService] Message queued during streaming');
    } else {
      // Normal send flow
      await this.sendMessage(content, filePaths);
      console.log('[ConversationService] Message sent normally');
    }
  }

  /**
   * Start a brand new conversation with Claude
   * Creates a new session ID and calls chat:start
   */
  async startNewConversation(content: string, files?: string[]): Promise<void> {
    try {
      // Wait for services to be ready (with timeout)
      const ready = await this.waitForServices(5000);
      if (!ready) {
        console.error(
          '[ConversationService] startNewConversation: Services initialization timeout'
        );
        return;
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[ConversationService] Services not available after initialization'
        );
        return;
      }

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[ConversationService] No workspace path available');
        return;
      }

      // Get or create active tab
      let activeTabId = this.tabManager.activeTabId();
      if (!activeTabId) {
        activeTabId = this.tabManager.createTab();
        this.tabManager.switchTab(activeTabId);
      }

      // Clear previous node maps to prevent stale references
      this.sessionManager.clearNodeMaps();

      // Generate placeholder session ID for new conversation
      const sessionId = this.generateId();

      // Update tab with draft status
      this.tabManager.updateTab(activeTabId, {
        title: content.substring(0, 50) || 'New Chat',
        status: 'draft',
        isDirty: false,
      });

      // Update SessionManager state - use new state machine API
      this.sessionManager.setSessionId(sessionId, 'draft'); // Start in draft state
      this.sessionManager.setStatus('draft'); // Start in draft status (no real session ID yet)

      // Add user message immediately (with empty sessionId - will be updated when resolved)
      const userMessage = createExecutionChatMessage({
        id: this.generateId(),
        role: 'user',
        rawContent: content,
        files,
        sessionId: '' as SessionId, // Will be updated when session:id-resolved arrives
      });

      // Update tab with user message
      const activeTab = this.tabManager.activeTab();
      this.tabManager.updateTab(activeTabId, {
        messages: [...(activeTab?.messages ?? []), userMessage],
        currentMessageId: null, // Reset per-tab message ID for new conversation
      });

      // Session ID will be initialized by StreamingHandler on first event
      // No tracking needed - removed PendingSessionManager

      console.log('[ConversationService] Starting NEW conversation:', {
        sessionId,
        tabId: activeTabId,
      });

      // Call RPC to start NEW chat
      const result = await this.claudeRpcService.call('chat:start', {
        prompt: content,
        sessionId: sessionId as SessionId,
        workspacePath,
        options: files ? { files } : undefined,
      });

      if (!result.success) {
        console.error(
          '[ConversationService] Failed to start chat:',
          result.error
        );
        // Update tab status to loaded (failed)
        this.tabManager.updateTab(activeTabId, { status: 'loaded' });
      } else {
        console.log(
          '[ConversationService] New conversation started:',
          result.data
        );

        // TASK_2025_087: Set status to 'streaming' after successful chat:start
        // Events will start arriving and StreamingHandlerService will initialize sessionId
        this.tabManager.updateTab(activeTabId, { status: 'streaming' });
        this.sessionManager.setStatus('streaming');

        // Add placeholder session immediately for UI responsiveness
        const now = Date.now();
        const newSession: ChatSessionSummary = {
          id: sessionId,
          name: content.substring(0, 50) || 'New Session',
          createdAt: now,
          lastActivityAt: now,
          messageCount: 1,
          isActive: true,
        };

        // Update sessions list (access internal signal via SessionLoaderService)
        // Note: This is a temporary workaround - ideally SessionLoaderService should expose an addSession method
        // For now, we'll call loadSessions to refresh from backend
        this.sessionLoader.loadSessions().catch((err) => {
          console.warn(
            '[ConversationService] Failed to refresh sessions:',
            err
          );
        });
      }
    } catch (error) {
      console.error(
        '[ConversationService] Failed to start new conversation:',
        error
      );

      // Update tab status to loaded (error)
      const activeTabId = this.tabManager.activeTabId();
      if (activeTabId) {
        this.tabManager.updateTab(activeTabId, { status: 'loaded' });
      }

      // Rethrow error to preserve error propagation
      throw error;
    }
  }

  /**
   * Continue an existing conversation with Claude
   * Uses the current session ID and calls chat:continue with --resume flag
   */
  async continueConversation(content: string, files?: string[]): Promise<void> {
    try {
      // Wait for services to be ready (with timeout)
      const ready = await this.waitForServices(5000);
      if (!ready) {
        console.error(
          '[ConversationService] continueConversation: Services initialization timeout'
        );
        return;
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[ConversationService] Services not available after initialization'
        );
        return;
      }

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[ConversationService] No workspace path available');
        return;
      }

      // Get REAL Claude session ID from the ACTIVE TAB (not global SessionManager)
      // This is critical for multi-tab support - each tab has its own session
      const activeTab = this.tabManager.activeTab();
      const sessionId = activeTab?.claudeSessionId;
      if (!sessionId) {
        console.warn(
          '[ConversationService] No Claude session ID on active tab - starting new conversation'
        );
        return this.startNewConversation(content, files);
      }

      // Get active tab
      const activeTabId = this.tabManager.activeTabId();
      if (!activeTabId) {
        console.warn(
          '[ConversationService] No active tab for continuing conversation'
        );
        return this.startNewConversation(content, files);
      }

      // Update SessionManager state
      this.sessionManager.setStatus('resuming');

      // Update tab status
      this.tabManager.updateTab(activeTabId, { status: 'resuming' });

      // Add user message immediately
      const userMessage = createExecutionChatMessage({
        id: this.generateId(),
        role: 'user',
        rawContent: content,
        files,
        sessionId,
      });

      // Update tab with user message (reuse activeTab from above)
      this.tabManager.updateTab(activeTabId, {
        messages: [...(activeTab?.messages ?? []), userMessage],
      });

      console.log('[ConversationService] Continuing EXISTING session:', {
        sessionId,
      });

      // Call RPC to CONTINUE existing chat (uses --resume flag)
      const result = await this.claudeRpcService.call('chat:continue', {
        prompt: content,
        sessionId: sessionId as SessionId,
        workspacePath,
      });

      if (!result.success) {
        console.error(
          '[ConversationService] Failed to continue chat:',
          result.error
        );
        this.tabManager.updateTab(activeTabId, { status: 'loaded' });
      } else {
        console.log(
          '[ConversationService] Conversation continued:',
          result.data
        );
        this.sessionManager.setStatus('streaming');
        this.tabManager.updateTab(activeTabId, { status: 'streaming' });
      }
    } catch (error) {
      console.error(
        '[ConversationService] Failed to continue conversation:',
        error
      );
      const activeTabId = this.tabManager.activeTabId();
      if (activeTabId) {
        this.tabManager.updateTab(activeTabId, { status: 'loaded' });
      }
    }
  }

  /**
   * Abort current message
   * Handles queued content restoration and calls backend to stop Claude CLI process
   */
  async abortCurrentMessage(): Promise<void> {
    try {
      // Prevent multiple simultaneous abort calls
      if (this._isStopping()) {
        console.log(
          '[ConversationService] Abort already in progress, skipping'
        );
        return;
      }
      this._isStopping.set(true);

      if (!this.claudeRpcService) {
        console.warn('[ConversationService] RPC service not initialized');
        this._isStopping.set(false);
        return;
      }

      const sessionId = this.currentSessionId();
      if (!sessionId) {
        console.warn('[ConversationService] No active session to abort');
        this._isStopping.set(false);
        return;
      }

      // ========== HANDLE QUEUED CONTENT BEFORE ABORT ==========
      const activeTab = this.tabManager.activeTab();
      const queuedContent = activeTab?.queuedContent;

      if (queuedContent && queuedContent.trim()) {
        console.log(
          '[ConversationService] Queued content detected during stop',
          {
            tabId: activeTab?.id,
            length: queuedContent.length,
          }
        );

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
      const result = await this.claudeRpcService.call('chat:abort', {
        sessionId: sessionId as SessionId,
      });

      if (result.success) {
        console.log('[ConversationService] Chat aborted successfully');
      } else {
        console.error(
          '[ConversationService] Failed to abort chat:',
          result.error
        );
      }

      // Finalize current message regardless of RPC result
      this.finalizeCurrentMessage();
    } catch (error) {
      console.error('[ConversationService] Failed to abort message:', error);
    } finally {
      // Always reset stopping flag
      this._isStopping.set(false);
    }
  }
}
