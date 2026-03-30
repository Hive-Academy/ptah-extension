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
  PtahCliStateService,
} from '@ptah-extension/core';
import { createExecutionChatMessage, SessionId } from '@ptah-extension/shared';
import { TabManagerService } from './tab-manager.service';
import { SessionManager } from './session-manager.service';
import { MessageValidationService } from './message-validation.service';
import type { SendMessageOptions } from './chat.types';

// Re-export for consumers that import from message-sender.service
export type { SendMessageOptions } from './chat.types';

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
  private readonly validator = inject(MessageValidationService);
  private readonly modelState = inject(ModelStateService);
  private readonly ptahCliState = inject(PtahCliStateService);

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
   * Validate that a session file exists on disk
   *
   * Prevents "process exited with code 1" errors by checking
   * if the actual .jsonl file exists before attempting to resume.
   *
   * @param sessionId - Session ID to validate
   * @param workspacePath - Workspace path
   * @returns Promise<{ exists: boolean; filePath?: string }>
   */
  private async validateSessionExists(
    sessionId: SessionId,
    workspacePath: string,
  ): Promise<{ exists: boolean; filePath?: string }> {
    try {
      const result = await this.claudeRpcService.call('session:validate', {
        sessionId,
        workspacePath,
      });

      if (result.success && result.data) {
        return result.data;
      }

      console.warn(
        '[MessageSender] Session validation RPC failed',
        result.error,
      );
      return { exists: false };
    } catch (error) {
      console.error('[MessageSender] Session validation error', error);
      return { exists: false };
    }
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
   * @param options - Optional send options (files, images, effort)
   */
  async send(content: string, options?: SendMessageOptions): Promise<void> {
    // Validate content BEFORE any processing
    const validation = this.validator.validate(content);
    if (!validation.valid) {
      console.warn(
        `[MessageSender] Invalid message content: ${validation.reason}`,
      );
      return;
    }

    // Sanitize content (trim whitespace) — slash commands passed through as-is
    const sanitized = this.validator.sanitize(content);

    const activeTab = this.tabManager.activeTab();

    const sessionId = activeTab?.claudeSessionId;
    // A tab has an existing session if it has a valid claudeSessionId.
    // Previously this also required status === 'loaded', but that was too
    // restrictive: after multi-turn streaming the tab may stay in 'streaming'
    // status (SESSION_STATS hasn't arrived yet), causing resume/follow-up
    // messages to mistakenly create a new session instead of continuing.
    const hasExistingSession =
      activeTab && sessionId && sessionId !== ('' as SessionId);

    if (hasExistingSession && sessionId) {
      await this.continueConversation(
        sanitized,
        sessionId as SessionId,
        options,
      );
    } else {
      // No active tab or no existing session — startNewConversation handles tab creation
      await this.startNewConversation(sanitized, options);
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
   * @param options - Optional send options (files, images, effort)
   */
  async sendOrQueue(
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
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
      await this.send(content, options);
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
   * @param options - Optional send options (files, images, effort)
   */
  private async startNewConversation(
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    const files = options?.files;
    const images = options?.images;
    const effort = options?.effort;
    try {
      // Wait for services to be ready (with timeout)
      const ready = await this.waitForServices(5000);
      if (!ready) {
        console.error(
          '[MessageSender] startNewConversation: Services initialization timeout',
        );
        return;
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[MessageSender] Services not available after initialization',
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
      // TASK_2025_192: Auto-name session from first message content (not "New Chat")
      const autoName = content.substring(0, 50).trim() || 'New Chat';
      this.tabManager.updateTab(activeTabId, {
        name: autoName,
        title: autoName,
        status: 'streaming',
        isDirty: false,
      });

      // Show streaming indicator (visual only - no side effects)
      this.tabManager.markTabStreaming(activeTabId);

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
      // Also clear stale streamingState from any previous session on this tab
      // to prevent handleSessionStats from seeing orphaned streaming state
      this.tabManager.updateTab(activeTabId, {
        messages: [...(activeTab?.messages ?? []), userMessage],
        currentMessageId: null, // Reset per-tab message ID for new conversation
        streamingState: null, // Clear stale streaming state from previous session
      });

      // Session ID will be initialized by StreamingHandler on first event
      // No tracking needed - removed PendingSessionManager

      console.log('[MessageSender] Starting NEW conversation:', {
        tabId: activeTabId,
        // No placeholder sessionId - backend will use SDK's real UUID
      });

      // Call RPC to start NEW chat
      // TASK_2025_092: Use tabId for frontend correlation instead of placeholder sessionId
      // TASK_2025_170: Pass ptahCliId if a Ptah CLI agent is selected
      const ptahCliId = this.ptahCliState.selectedAgentId() ?? undefined;
      const result = await this.claudeRpcService.call('chat:start', {
        prompt: content,
        tabId: activeTabId, // Frontend correlation ID
        name: autoName, // Send message-derived name to backend (not stale activeTab reference)
        workspacePath,
        ptahCliId, // TASK_2025_170: Route to Ptah CLI agent adapter
        options: {
          model: this.modelState.currentModel(),
          ...(files ? { files } : {}),
          ...(images && images.length > 0 ? { images } : {}),
          ...(effort ? { effort } : {}), // TASK_2025_184: Effort level
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

        // Note: Sessions list refresh moved to handleSessionIdResolved() in ChatStore
        // At this point metadata doesn't exist yet, so loadSessions() would miss this session
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
   * @param options - Optional send options (files, images, effort)
   */
  private async continueConversation(
    content: string,
    sessionId: SessionId,
    options?: SendMessageOptions,
  ): Promise<void> {
    const files = options?.files;
    const images = options?.images;
    const effort = options?.effort;
    try {
      // Wait for services to be ready (with timeout)
      const ready = await this.waitForServices(5000);
      if (!ready) {
        console.error(
          '[MessageSender] continueConversation: Services initialization timeout',
        );
        return;
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[MessageSender] Services not available after initialization',
        );
        return;
      }

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[MessageSender] No workspace path available');
        return;
      }

      // ✅ VALIDATE: Check if session file actually exists on disk
      const validationResult = await this.validateSessionExists(
        sessionId,
        workspacePath,
      );

      if (!validationResult.exists) {
        console.warn(
          `[MessageSender] Session ${sessionId} file not found on disk - starting new session instead`,
          { sessionId },
        );

        // Clear stale session ID from tab
        const activeTabId = this.tabManager.activeTabId();
        if (activeTabId) {
          this.tabManager.updateTab(activeTabId, {
            claudeSessionId: null,
            status: 'loaded',
          });
        }

        // Start new conversation instead
        await this.startNewConversation(content, options);
        return;
      }

      // Get active tab — if none, fall back to new conversation (handles tab creation)
      const activeTabId = this.tabManager.activeTabId();
      if (!activeTabId) {
        console.warn(
          '[MessageSender] No active tab for continuing conversation — starting new',
        );
        await this.startNewConversation(content, options);
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
        name: activeTab?.name, // Send session name (support late naming)
        workspacePath,
        model: this.modelState.currentModel(),
        files: files ?? [],
        ...(images && images.length > 0 ? { images } : {}),
        ...(effort ? { effort } : {}), // TASK_2025_184: Effort level
      });

      if (!result.success) {
        console.error('[MessageSender] Failed to continue chat:', result.error);
        this.tabManager.updateTab(activeTabId, { status: 'loaded' });
        this.tabManager.markTabIdle(activeTabId);
        this.sessionManager.setStatus('loaded');
      } else {
        console.log('[MessageSender] Conversation continued:', result.data);
        this.sessionManager.setStatus('streaming');
        this.tabManager.updateTab(activeTabId, { status: 'streaming' });
        this.tabManager.markTabStreaming(activeTabId);
      }
    } catch (error) {
      console.error('[MessageSender] Failed to continue conversation:', error);
      const activeTabId = this.tabManager.activeTabId();
      if (activeTabId) {
        this.tabManager.updateTab(activeTabId, { status: 'loaded' });
        this.tabManager.markTabIdle(activeTabId);
      }
      this.sessionManager.setStatus('loaded');
    }
  }
}
