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
import {
  ClaudeRpcService,
  VSCodeService,
  ModelStateService,
} from '@ptah-extension/core';
import { createExecutionChatMessage, SessionId } from '@ptah-extension/shared';
import { TabManagerService } from './tab-manager.service';
import { SessionManager } from './session-manager.service';
import { SessionLoaderService } from './chat-store/session-loader.service';
import { MessageValidationService } from './message-validation.service';

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
  private readonly sessionLoader = inject(SessionLoaderService);
  private readonly validator = inject(MessageValidationService);
  private readonly modelState = inject(ModelStateService);

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
   * Validates content before sending, then checks if there's an existing session and routes accordingly.
   *
   * @param content - Message content
   * @param files - Optional file paths to include
   */
  async send(content: string, files?: string[]): Promise<void> {
    // Validate content BEFORE any processing
    const validation = this.validator.validate(content);
    if (!validation.valid) {
      console.warn(
        `[MessageSender] Invalid message content: ${validation.reason}`
      );
      return;
    }

    // Sanitize content (trim whitespace)
    const sanitized = this.validator.sanitize(content);

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
      await this.continueConversation(sanitized, sessionId as SessionId, files);
    } else {
      await this.startNewConversation(sanitized, files);
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
        console.error(
          '[MessageSender] Services not available after initialization'
        );
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

      // Use the tab's existing placeholder session ID (proper UUID v4)
      // This ensures TabManager.resolveSessionId can find the correct tab
      const activeTab = this.tabManager.activeTab();
      const sessionId = activeTab?.placeholderSessionId || this.generateId();

      // Update tab with streaming status immediately
      // TASK_2025_086: Changed from 'draft' to 'streaming' so UI shows content as it arrives
      // Previously, isStreaming() returned false until session:id-resolved, hiding all streaming content
      this.tabManager.updateTab(activeTabId, {
        title: content.substring(0, 50) || 'New Chat',
        status: 'streaming',
        isDirty: false,
      });

      // Update SessionManager state - use new state machine API
      // TASK_2025_086: Use 'draft' state (session not yet confirmed by backend)
      // The 'streaming' is a SessionStatus, not SessionState
      this.sessionManager.setSessionId(sessionId); // Default to 'draft' state
      this.sessionManager.setStatus('streaming'); // Start streaming status so UI shows content

      // Add user message immediately (with empty sessionId - will be updated when resolved)
      const userMessage = createExecutionChatMessage({
        id: this.generateId(),
        role: 'user',
        rawContent: content,
        files,
        sessionId: '' as SessionId, // Will be updated when session:id-resolved arrives
      });

      // Update tab with user message (reuse activeTab from above)
      this.tabManager.updateTab(activeTabId, {
        messages: [...(activeTab?.messages ?? []), userMessage],
        currentMessageId: null, // Reset per-tab message ID for new conversation
      });

      // Session ID will be initialized by StreamingHandler on first event
      // No tracking needed - removed PendingSessionManager

      console.log('[MessageSender] Starting NEW conversation:', {
        tabId: activeTabId,
        // No placeholder sessionId - backend will use SDK's real UUID
      });

      // Call RPC to start NEW chat
      // TASK_2025_092: Use tabId for frontend correlation instead of placeholder sessionId
      const result = await this.claudeRpcService.call('chat:start', {
        prompt: content,
        tabId: activeTabId, // Frontend correlation ID
        name: activeTab?.name, // ✅ Send session name to backend
        workspacePath,
        options: {
          model: this.modelState.currentModel(),
          ...(files ? { files } : {}),
        },
      });

      if (!result.success) {
        console.error('[MessageSender] Failed to start chat:', result.error);
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
        console.error(
          '[MessageSender] Services not available after initialization'
        );
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
        console.warn(
          '[MessageSender] No active tab for continuing conversation'
        );
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
        tabId: activeTabId,
      });

      // Call RPC to CONTINUE existing chat (uses --resume flag)
      // TASK_2025_092: Include tabId for event routing
      const result = await this.claudeRpcService.call('chat:continue', {
        prompt: content,
        sessionId,
        tabId: activeTabId, // For event routing
        name: activeTab?.name, // ✅ Send session name (support late naming)
        workspacePath,
        model: this.modelState.currentModel(),
        files: files ?? [],
      });

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
