/**
 * MessageSenderService - Centralized Message Sending Logic (Mediator Pattern)
 *
 * Eliminates 3-level callback indirection by providing direct message sending API.
 * Extracted from ConversationService to create clean separation of concerns.
 *
 * Responsibilities:
 * - Route messages to correct handler (new vs continue conversation)
 * - Check streaming state and queue if necessary
 * - Coordinate with RPC service for backend communication
 *
 * Benefits:
 * - Zero callback indirection (direct method calls)
 * - Clear service responsibility (message sending only)
 * - No circular dependencies (mediator pattern)
 * - Easy to test (mock dependencies)
 *
 * Extracted from ChatStore refactoring (TASK_2025_054) - Batch 3
 */

import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  ChatSessionSummary,
  createExecutionChatMessage,
  SessionId,
} from '@ptah-extension/shared';
import { TabManagerService } from './tab-manager.service';
import { SessionManager } from './session-manager.service';
import { PendingSessionManagerService } from './pending-session-manager.service';
import { SessionLoaderService } from './chat-store/session-loader.service';

/**
 * Centralized service for sending messages
 *
 * Replaces callback-based message sending with direct method calls.
 * This is the mediator that coordinates message flow between components.
 */
@Injectable({ providedIn: 'root' })
export class MessageSenderService {
  // ============================================================================
  // DEPENDENCIES
  // ============================================================================

  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly pendingSessionManager = inject(PendingSessionManagerService);
  private readonly sessionLoader = inject(SessionLoaderService);

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

  // ============================================================================
  // PUBLIC API - Message Sending
  // ============================================================================

  /**
   * Send a message - automatically routes to new or continue conversation
   *
   * This is the main entry point for sending messages.
   * Checks if there's an existing session and routes accordingly.
   *
   * @param content - Message content
   * @param files - Optional file paths to include
   */
  async send(content: string, files?: string[]): Promise<void> {
    const activeTab = this.tabManager.activeTab();
    if (!activeTab) {
      console.warn('[MessageSender] No active tab');
      return;
    }

    const sessionId = activeTab.claudeSessionId;
    const hasExistingSession =
      sessionId &&
      sessionId !== ('' as SessionId) &&
      activeTab.status === 'loaded';

    if (hasExistingSession && sessionId) {
      await this.continueConversation(content, sessionId as SessionId, files);
    } else {
      await this.startNewConversation(content, files);
    }
  }

  /**
   * Send message or queue if streaming
   *
   * Smart routing that checks streaming state:
   * - If streaming: Queue for later (delegated to ConversationService)
   * - If not streaming: Send immediately
   *
   * @param content - Message content
   * @param files - Optional file paths to include
   */
  async sendOrQueue(content: string, files?: string[]): Promise<void> {
    // Check if streaming via active tab status
    const activeTab = this.tabManager.activeTab();
    const isStreaming =
      activeTab?.status === 'streaming' || activeTab?.status === 'resuming';

    if (isStreaming) {
      // Queue for later - delegate to ConversationService via ChatStore
      // We don't queue directly to avoid circular dependency
      console.log('[MessageSender] Streaming active, message will be queued');
      // Note: Queue handling is done by caller (ChatStore/ConversationService)
      // This method just checks the condition
      return;
    } else {
      // Send immediately
      await this.send(content, files);
    }
  }

  // ============================================================================
  // PRIVATE API - Conversation Logic (extracted from ConversationService)
  // ============================================================================

  /**
   * Start a brand new conversation with Claude
   *
   * Extracted from ConversationService.startNewConversation()
   * Creates a new session ID and calls chat:start RPC
   *
   * @param content - Message content
   * @param files - Optional file paths to include
   */
  private async startNewConversation(
    content: string,
    files?: string[]
  ): Promise<void> {
    try {
      // Wait for services to be ready (with timeout)
      const ready = await this.waitForServices(5000);
      if (!ready) {
        console.error(
          '[MessageSender] startNewConversation: Services initialization timeout'
        );
        return;
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error('[MessageSender] Services not available after initialization');
        return;
      }

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[MessageSender] No workspace path available');
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
      this.sessionManager.clearClaudeSessionId(); // Clear previous real ID
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

      // Track this tab for session ID resolution using PendingSessionManager
      // When session:id-resolved arrives, we'll know which tab initiated this conversation
      // This eliminates shared mutable state (no direct Map mutation on SessionLoader)
      this.pendingSessionManager.add(sessionId, activeTabId);

      console.log('[MessageSender] Starting NEW conversation:', {
        sessionId,
        tabId: activeTabId,
      });

      // Call RPC to start NEW chat
      const result = await this.claudeRpcService.call<{ sessionId: string }>(
        'chat:start',
        {
          prompt: content,
          sessionId,
          workspacePath,
          options: files ? { files } : undefined,
        }
      );

      if (!result.success) {
        console.error('[MessageSender] Failed to start chat:', result.error);
        // Clean up pending resolution since chat failed (clears timeout)
        this.pendingSessionManager.remove(sessionId);
        // Update tab status to loaded (failed)
        this.tabManager.updateTab(activeTabId, { status: 'loaded' });
        this.sessionManager.setStatus('loaded');
        this.sessionManager.failSession();
      } else {
        console.log('[MessageSender] New conversation started:', result.data);

        // Refresh sessions list from backend
        this.sessionLoader.loadSessions().catch((err) => {
          console.warn('[MessageSender] Failed to refresh sessions:', err);
        });
      }
    } catch (error) {
      console.error('[MessageSender] Failed to start new conversation:', error);

      // CRITICAL: Clean up pending resolution to prevent memory leak
      // This ensures pendingSessionManager.remove() is called on ALL failure paths
      const placeholderSessionId = this.sessionManager.getCurrentSessionId();
      if (placeholderSessionId) {
        this.pendingSessionManager.remove(placeholderSessionId);
        console.log(
          '[MessageSender] Cleaned up pending resolution after error:',
          placeholderSessionId
        );
      }

      // Update tab status to loaded (error)
      const activeTabId = this.tabManager.activeTabId();
      if (activeTabId) {
        this.tabManager.updateTab(activeTabId, { status: 'loaded' });
      }
      this.sessionManager.setStatus('loaded');
      this.sessionManager.failSession();

      // Rethrow error to preserve error propagation
      throw error;
    }
  }

  /**
   * Continue an existing conversation with Claude
   *
   * Extracted from ConversationService.continueConversation()
   * Uses the current session ID and calls chat:continue with --resume flag
   *
   * @param content - Message content
   * @param sessionId - Existing session ID
   * @param files - Optional file paths to include
   */
  private async continueConversation(
    content: string,
    sessionId: SessionId,
    files?: string[]
  ): Promise<void> {
    try {
      // Wait for services to be ready (with timeout)
      const ready = await this.waitForServices(5000);
      if (!ready) {
        console.error(
          '[MessageSender] continueConversation: Services initialization timeout'
        );
        return;
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error('[MessageSender] Services not available after initialization');
        return;
      }

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[MessageSender] No workspace path available');
        return;
      }

      // Get active tab
      const activeTabId = this.tabManager.activeTabId();
      if (!activeTabId) {
        console.warn('[MessageSender] No active tab for continuing conversation');
        return;
      }

      const activeTab = this.tabManager.activeTab();

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

      // Update tab with user message
      this.tabManager.updateTab(activeTabId, {
        messages: [...(activeTab?.messages ?? []), userMessage],
      });

      console.log('[MessageSender] Continuing EXISTING session:', {
        sessionId,
      });

      // Call RPC to CONTINUE existing chat (uses --resume flag)
      const result = await this.claudeRpcService.call<{ sessionId: string }>(
        'chat:continue',
        {
          prompt: content,
          sessionId,
          workspacePath,
        }
      );

      if (!result.success) {
        console.error('[MessageSender] Failed to continue chat:', result.error);
        this.tabManager.updateTab(activeTabId, { status: 'loaded' });
        this.sessionManager.setStatus('loaded');
      } else {
        console.log('[MessageSender] Conversation continued:', result.data);
        this.sessionManager.setStatus('streaming');
        this.tabManager.updateTab(activeTabId, { status: 'streaming' });
      }
    } catch (error) {
      console.error('[MessageSender] Failed to continue conversation:', error);
      const activeTabId = this.tabManager.activeTabId();
      if (activeTabId) {
        this.tabManager.updateTab(activeTabId, { status: 'loaded' });
      }
      this.sessionManager.setStatus('loaded');
    }
  }
}
